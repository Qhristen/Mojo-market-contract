use crate::{error::AmmError, state::Pair};
use anchor_lang::prelude::*;
use anchor_spl::{
    token::{burn, transfer, Burn, Transfer},
    token_interface::{Mint, TokenAccount, TokenInterface},
};

/// Instruction to remove liquidity from a MOJO/paired-token pool
#[derive(Accounts)]
#[instruction(lp_amount: u64, min_base: u64, min_paired: u64)]
pub struct RemoveLiquidity<'info> {
    /// The user removing liquidity
    #[account(mut)]
    pub user: Signer<'info>,

    /// The Pair state for the MOJO/paired token pool
    #[account(
        mut,
        seeds = [b"pair", pair.base_token_mint.as_ref(), pair.paired_token_mint.as_ref()],
        bump = pair.bump,
        has_one = base_vault,
        has_one = paired_vault,
        has_one = lp_mint,
    )]
    pub pair: Account<'info, Pair>,

    /// Vault holding base token (MOJO)
    #[account(mut, address = pair.base_vault)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// User's base token ATA
    #[account(
        mut,
        associated_token::mint = pair.base_token_mint,
        associated_token::authority = user,
    )]
    pub user_base_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Vault holding paired token
    #[account(mut, address = pair.paired_vault)]
    pub paired_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// User's paired token ATA
    #[account(
        mut,
        associated_token::mint = pair.paired_token_mint,
        associated_token::authority = user,
    )]
    pub user_paired_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// LP token mint for this pool
    #[account(mut, address = pair.lp_mint)]
    pub lp_mint: Box<InterfaceAccount<'info, Mint>>,

    /// User's LP token ATA
    #[account(
        mut,
        associated_token::mint = pair.lp_mint,
        associated_token::authority = user,
    )]
    pub user_lp_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Token program
    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> RemoveLiquidity<'info> {
    pub fn remove_liquidity(
        &mut self,
        lp_amount: u64,
        min_base: u64,
        min_paired: u64,
    ) -> Result<()> {
        require!(lp_amount > 0, AmmError::InvalidAmount);

        let base_reserve = self.pair.base_reserve;
        let paired_reserve = self.pair.paired_reserve;
        let total_lp = self.pair.total_liquidity;

        // Calculate amounts to return
        let base_amount = (lp_amount as u128)
            .checked_mul(base_reserve as u128)
            .ok_or(AmmError::MathOverflow)?
            .checked_div(total_lp as u128)
            .ok_or(AmmError::MathOverflow)? as u64;
        let paired_amount = (lp_amount as u128)
            .checked_mul(paired_reserve as u128)
            .ok_or(AmmError::MathOverflow)?
            .checked_div(total_lp as u128)
            .ok_or(AmmError::MathOverflow)? as u64;

        require!(base_amount >= min_base, AmmError::SlippageExceeded);
        require!(paired_amount >= min_paired, AmmError::SlippageExceeded);

        // Burn LP tokens from user
        let cpi_program = self.token_program.to_account_info();
        burn(
            CpiContext::new(
                cpi_program.clone(),
                Burn {
                    mint: self.lp_mint.to_account_info(),
                    from: self.user_lp_ata.to_account_info(),
                    authority: self.user.to_account_info(),
                },
            ),
            lp_amount,
        )?;

        // Transfer base and paired tokens to user
        let seeds = &[
            b"pair",
            self.pair.base_token_mint.as_ref(),
            self.pair.paired_token_mint.as_ref(),
            &[self.pair.bump],
        ];
        let signer = &[&seeds[..]];
        // Base
        transfer(
            CpiContext::new_with_signer(
                cpi_program.clone(),
                Transfer {
                    from: self.base_vault.to_account_info(),
                    to: self.user_base_ata.to_account_info(),
                    authority: self.pair.to_account_info(),
                },
                signer,
            ),
            base_amount,
        )?;
        // Paired
        transfer(
            CpiContext::new_with_signer(
                cpi_program.clone(),
                Transfer {
                    from: self.paired_vault.to_account_info(),
                    to: self.user_paired_ata.to_account_info(),
                    authority: self.pair.to_account_info(),
                },
                signer,
            ),
            paired_amount,
        )?;

        // Update reserves and total liquidity
        self.pair.base_reserve = base_reserve
            .checked_sub(base_amount)
            .ok_or(AmmError::MathOverflow)?;
        self.pair.paired_reserve = paired_reserve
            .checked_sub(paired_amount)
            .ok_or(AmmError::MathOverflow)?;
        self.pair.total_liquidity = total_lp
            .checked_sub(lp_amount)
            .ok_or(AmmError::MathOverflow)?;

        Ok(())
    }
}
