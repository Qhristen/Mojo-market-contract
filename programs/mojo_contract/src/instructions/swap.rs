//NEW SWAP FUNCTION
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{transfer, Transfer},
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{error::AmmError, Pair, PlatformState};

#[derive(Accounts)]
pub struct Swap<'info> {
    /// The platform state contains global configuration
    #[account(
        seeds = [b"platform-state"],
        bump = platform_state.bump,
        constraint = !platform_state.is_paused @ AmmError::TradingPaused,
    )]
    pub platform_state: Account<'info, PlatformState>,

    /// The user performing the swap
    #[account(mut)]
    pub user: Signer<'info>,

    /// The pair (pool) being swapped with
    #[account(
        mut,
        seeds = [b"pair", pair.base_token_mint.as_ref(), pair.paired_token_mint.as_ref()],
        bump = pair.bump,
        has_one = base_vault,
        has_one = paired_vault,
        constraint = pair.total_liquidity > 0 @ AmmError::InsufficientLiquidity,
    )]
    pub pair: Account<'info, Pair>,

    /// Base token mint (MOJO)
    pub base_token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Paired token mint
    pub paired_token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Vault holding base tokens (MOJO)
    #[account(
        mut,
        address = pair.base_vault,
        constraint = base_vault.mint == pair.base_token_mint
    )]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Vault holding paired tokens
    #[account(
        mut,
        address = pair.paired_vault,
        constraint = paired_vault.mint == pair.paired_token_mint
    )]
    pub paired_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// User's base token (MOJO) account
    #[account(
        mut,
        associated_token::mint = base_token_mint,
        associated_token::authority = user,
    )]
    pub user_base_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// User's paired token account
    #[account(
        mut,
        associated_token::mint = paired_token_mint,
        associated_token::authority = user,
    )]
    pub user_paired_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Platform fee collector account
    #[account(
        mut,
        address = platform_state.fee_collector,
    )]
    pub fee_collector: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> Swap<'info> {
    pub fn swap(&mut self, amount_in: u64, min_amount_out: u64, is_base_input: bool) -> Result<()> {
        require!(
            self.pair.total_liquidity > 0,
            AmmError::InsufficientLiquidity
        );
        require!(amount_in > 0, AmmError::ZeroAmount);
        require!(!self.platform_state.is_paused, AmmError::TradingPaused);

        let clock = Clock::get()?;
        self.pair.last_swap_time = clock.unix_timestamp;

        let base_reserve = self.pair.base_reserve;
        let paired_reserve = self.pair.paired_reserve;

        let (
            input_reserve,
            output_reserve,
            input_vault,
            output_vault,
            input_account,
            output_account,
        ) = if is_base_input {
            (
                base_reserve,
                paired_reserve,
                &self.base_vault,
                &self.paired_vault,
                &self.user_base_ata,
                &self.user_paired_ata,
            )
        } else {
            (
                paired_reserve,
                base_reserve,
                &self.paired_vault,
                &self.base_vault,
                &self.user_paired_ata,
                &self.user_base_ata,
            )
        };

        // --- MOJO -> Paired Token swap ---
        if is_base_input {
            let protocol_fee = amount_in
                .checked_mul(self.platform_state.protocol_fee_rate as u64)
                .ok_or(AmmError::MathOverflow)?
                .checked_div(10_000)
                .ok_or(AmmError::MathOverflow)?;

            let amount_in_after_fee = amount_in
                .checked_sub(protocol_fee)
                .ok_or(AmmError::MathOverflow)?;

            let k = (input_reserve as u128)
                .checked_mul(output_reserve as u128)
                .ok_or(AmmError::MathOverflow)?;

            let new_input_reserve = (input_reserve as u128)
                .checked_add(amount_in_after_fee as u128)
                .ok_or(AmmError::MathOverflow)?;

            let new_output_reserve = k
                .checked_div(new_input_reserve)
                .ok_or(AmmError::MathOverflow)?;

            let output_amount = (output_reserve as u128)
                .checked_sub(new_output_reserve)
                .ok_or(AmmError::MathOverflow)? as u64;

            require!(output_amount >= min_amount_out, AmmError::SlippageExceeded);

            // Transfer input MOJO from user → base_vault
            transfer(
                CpiContext::new(
                    self.token_program.to_account_info(),
                    Transfer {
                        from: input_account.to_account_info(),
                        to: input_vault.to_account_info(),
                        authority: self.user.to_account_info(),
                    },
                ),
                amount_in,
            )?;

            // Transfer output tokens from vault → user
            let signer_seeds = &[
                b"pair",
                self.pair.base_token_mint.as_ref(),
                self.pair.paired_token_mint.as_ref(),
                &[self.pair.bump],
            ];
            transfer(
                CpiContext::new_with_signer(
                    self.token_program.to_account_info(),
                    Transfer {
                        from: output_vault.to_account_info(),
                        to: output_account.to_account_info(),
                        authority: self.pair.to_account_info(),
                    },
                    &[signer_seeds],
                ),
                output_amount,
            )?;

            // Transfer MOJO fee to fee_collector
            if protocol_fee > 0 {
                transfer(
                    CpiContext::new_with_signer(
                        self.token_program.to_account_info(),
                        Transfer {
                            from: input_vault.to_account_info(),
                            to: self.fee_collector.to_account_info(),
                            authority: self.pair.to_account_info(),
                        },
                        &[signer_seeds],
                    ),
                    protocol_fee,
                )?;
            }

            self.pair.base_reserve = base_reserve
                .checked_add(amount_in_after_fee)
                .ok_or(AmmError::MathOverflow)?;
            self.pair.paired_reserve = paired_reserve
                .checked_sub(output_amount)
                .ok_or(AmmError::MathOverflow)?;
        }
        // --- Paired Token -> MOJO swap ---
        else {
            let k = (input_reserve as u128)
                .checked_mul(output_reserve as u128)
                .ok_or(AmmError::MathOverflow)?;

            let new_input_reserve = (input_reserve as u128)
                .checked_add(amount_in as u128)
                .ok_or(AmmError::MathOverflow)?;

            let new_output_reserve = k
                .checked_div(new_input_reserve)
                .ok_or(AmmError::MathOverflow)?;

            let gross_output_amount = (output_reserve as u128)
                .checked_sub(new_output_reserve)
                .ok_or(AmmError::MathOverflow)? as u64;

            let protocol_fee = gross_output_amount
                .checked_mul(self.platform_state.protocol_fee_rate as u64)
                .ok_or(AmmError::MathOverflow)?
                .checked_div(10_000)
                .ok_or(AmmError::MathOverflow)?;

            let amount_out_after_fee = gross_output_amount
                .checked_sub(protocol_fee)
                .ok_or(AmmError::MathOverflow)?;

            require!(
                amount_out_after_fee >= min_amount_out,
                AmmError::SlippageExceeded
            );

            // Transfer input paired token from user → paired_vault
            transfer(
                CpiContext::new(
                    self.token_program.to_account_info(),
                    Transfer {
                        from: input_account.to_account_info(),
                        to: input_vault.to_account_info(),
                        authority: self.user.to_account_info(),
                    },
                ),
                amount_in,
            )?;

            let signer_seeds = &[
                b"pair",
                self.pair.base_token_mint.as_ref(),
                self.pair.paired_token_mint.as_ref(),
                &[self.pair.bump],
            ];

            // Transfer MOJO to user (minus fee)
            transfer(
                CpiContext::new_with_signer(
                    self.token_program.to_account_info(),
                    Transfer {
                        from: output_vault.to_account_info(),
                        to: output_account.to_account_info(),
                        authority: self.pair.to_account_info(),
                    },
                    &[signer_seeds],
                ),
                amount_out_after_fee,
            )?;

            // Transfer MOJO fee to fee_collector
            if protocol_fee > 0 {
                transfer(
                    CpiContext::new_with_signer(
                        self.token_program.to_account_info(),
                        Transfer {
                            from: output_vault.to_account_info(),
                            to: self.fee_collector.to_account_info(),
                            authority: self.pair.to_account_info(),
                        },
                        &[signer_seeds],
                    ),
                    protocol_fee,
                )?;
            }

            self.pair.paired_reserve = paired_reserve
                .checked_add(amount_in)
                .ok_or(AmmError::MathOverflow)?;
            self.pair.base_reserve = base_reserve
                .checked_sub(gross_output_amount)
                .ok_or(AmmError::MathOverflow)?;
        }

        Ok(())
    }
}
