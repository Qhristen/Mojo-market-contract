use anchor_lang::prelude::*;

use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface, TransferChecked, transfer_checked};

use crate::{error::AmmError, Pair, PlatformState};

#[derive(Accounts)]
pub struct Swap<'info> {
     // Platform configuration
     #[account(has_one = base_token_mint)]
    pub platform: Account<'info, PlatformState>,

    #[account(
        mut,
        seeds = [b"pair", base_token_mint.key().as_ref(), paired_token_mint.key().as_ref()],
        bump = pair.bump,
        has_one = base_token_mint,
        has_one = paired_token_mint,
    )]
    pub pair: Account<'info, Pair>,

    pub base_token_mint: Box<InterfaceAccount<'info, Mint>>,
    pub paired_token_mint: Box<InterfaceAccount<'info, Mint>>,

    // Vaults
    #[account(
        mut,
        address = pair.base_vault,
        constraint = base_vault.mint == base_token_mint.key()
    )]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    
    #[account(
        mut,
        address = pair.paired_vault,
        constraint = paired_vault.mint == paired_token_mint.key()
    )]
    pub paired_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    // Protocol fee account (PDA-derived)
    #[account(
        mut,
        seeds = [b"protocol_fee", input_token_account.mint.as_ref()],
        bump,
        constraint = protocol_fee_vault.mint == input_token_account.mint
    )]
    pub protocol_fee_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    // Input/Output token accounts
    #[account(
        mut,
        constraint = input_token_account.mint == base_token_mint.key() || 
                     input_token_account.mint == paired_token_mint.key()
    )]
    pub input_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub output_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub input_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub output_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}


impl<'info> Swap<'info> {
    pub fn swap(&mut self,  input_amount: u64, min_output_amount: u64) -> Result<()> {
      
        let clock = Clock::get()?;
        let pair = &mut self.pair;
        let fee_rate = pair.fee_rate;
        let base_token_mint =  pair.base_token_mint;
        
        // 1. Validation checks
        require!(input_amount > 0, AmmError::ZeroAmount);
        require!(!self.platform.is_paused, AmmError::TradingPaused);
        // require!(platform.protocol_fee_ratio <= 10000, AmmError::InvalidFeeConfig);
        require!(
            clock.unix_timestamp - pair.last_swap_time > 1,
            AmmError::SwapCooldown
        );

        // 2. Determine swap direction and reserves
        let is_base_input = self.input_token_account.mint == base_token_mint;
        let input_reserve = if is_base_input { pair.base_reserve } else { pair.paired_reserve };
        let output_reserve = if is_base_input { pair.paired_reserve } else { pair.base_reserve };

        // 3. Calculate fees
        let total_fee = input_amount
            .checked_mul(fee_rate as u64)
            .ok_or(AmmError::MathError)?
            .checked_div(10000)
            .ok_or(AmmError::MathError)?;

        let protocol_fee = total_fee
            .checked_mul(self.platform.protocol_fee_rate as u64)
            .ok_or(AmmError::MathError)?
            .checked_div(10000)
            .ok_or(AmmError::MathError)?;

        let liquidity_fee = total_fee.checked_sub(protocol_fee)
            .ok_or(AmmError::MathError)?;

        let input_amount_after_fee = input_amount.checked_sub(total_fee)
            .ok_or(AmmError::MathError)?;

        // 4. Calculate output using x*y=k formula
        let numerator = input_amount_after_fee
            .checked_mul(output_reserve)
            .ok_or(AmmError::MathError)?;
        
        let denominator = input_reserve
            .checked_add(input_amount_after_fee)
            .ok_or(AmmError::MathError)?;
        
        let output_amount = numerator
            .checked_div(denominator)
            .ok_or(AmmError::MathError)?;

        // 5. Slippage protection
        require!(
            output_amount >= min_output_amount,
            AmmError::SlippageExceeded
        );

        // 6. Update reserves with liquidity fee
        let new_input_reserve = input_reserve
            .checked_add(input_amount_after_fee.checked_add(liquidity_fee).ok_or(AmmError::MathError)?)
            .ok_or(AmmError::MathError)?;
        let new_output_reserve = output_reserve
            .checked_sub(output_amount)
            .ok_or(AmmError::MathError)?;

        if is_base_input {
            pair.base_reserve = new_input_reserve;
            pair.paired_reserve = new_output_reserve;
        } else {
            pair.paired_reserve = new_input_reserve;
            pair.base_reserve = new_output_reserve;
        }

        // Transfer input tokens from user to vault
        let transfer_input_ctx = CpiContext::new(
            self.token_program.to_account_info(),
            TransferChecked {
                from: self.input_token_account.to_account_info(),
                mint: self.paired_token_mint.to_account_info(),
                to: if is_base_input {
                    self.base_vault.to_account_info()
                } else {
                    self.paired_vault.to_account_info()
                },
                authority: self.user.to_account_info(),
            },
        );
        transfer_checked(transfer_input_ctx, input_amount, self.paired_token_mint.decimals)?;

          // Transfer protocol fee to protocol's account
          let signer_seeds: &[&[&[u8]]] = &[&[
            b"pair",
            pair.base_token_mint.as_ref(),
            pair.paired_token_mint.as_ref(),
            &[pair.bump],
        ]];
        
        let protocol_fee_transfer_ctx = CpiContext::new_with_signer(
            self.token_program.to_account_info(),
            TransferChecked {
                from: if is_base_input {
                    self.paired_vault.to_account_info()
                } else {
                    self.base_vault.to_account_info()
                },
                mint: self.base_token_mint.to_account_info(),
                to: self.protocol_fee_vault.to_account_info(),
                authority: pair.to_account_info(),
            },
            signer_seeds,
        );
        transfer_checked(protocol_fee_transfer_ctx, protocol_fee, self.base_token_mint.decimals)?;

        // Transfer output tokens to user
        let output_transfer_ctx = CpiContext::new_with_signer(
            self.token_program.to_account_info(),
            TransferChecked {
                from: if is_base_input {
                    self.base_vault.to_account_info()
                } else {
                    self.paired_vault.to_account_info()
                },
                mint: self.base_token_mint.to_account_info(),
                to: self.output_token_account.to_account_info(),
                authority: pair.to_account_info(),
            },
            signer_seeds,
        );
        transfer_checked(output_transfer_ctx, output_amount, self.base_token_mint.decimals)?;


        Ok(())
    }
}