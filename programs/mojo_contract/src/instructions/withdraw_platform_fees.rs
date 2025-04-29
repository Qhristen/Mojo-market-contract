use anchor_lang::prelude::*;
use anchor_spl::{token::{transfer_checked, TransferChecked}, token_interface::{Mint, TokenAccount, TokenInterface}};
use crate::{error::AmmError, state::PlatformState};

#[derive(Accounts)]
pub struct WithdrawPlatformFees<'info> {
    #[account(constraint = admin.key() == platform_state.admin @ AmmError::Unauthorized)]
    pub admin: Signer<'info>,

    #[account(
        has_one = admin
    )]
    pub platform_state: Account<'info, PlatformState>,

    // The protocol fee vault that holds the fees
    #[account(
        mut,
        seeds = [b"protocol_fee", token_mint.key().as_ref()],
        bump,
    )]
    pub protocol_fee_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    
    // The token mint for which we're withdrawing fees
    pub token_mint: InterfaceAccount<'info, Mint>,

    // The destination for the fee withdrawal
    #[account(
        mut,
        constraint = fee_destination.mint == protocol_fee_vault.mint @ AmmError::TokenMintMismatch
    )]
    pub fee_destination: Box<InterfaceAccount<'info, TokenAccount>>,

    // Required programs
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
impl<'info> WithdrawPlatformFees<'info> {
    pub fn withdraw_fees(&mut self, amount: u64) -> Result<()> {
        // Ensure the amount is valid
        if amount <= 0 {
            return Err(AmmError::InvalidAmount.into());
        }

        // Transfer the fees from the protocol fee vault to the fee destination
        let cpi_accounts = TransferChecked {
                    from: self.protocol_fee_vault.to_account_info(),
                    mint: self.token_mint.to_account_info(),
                    to: self.fee_destination.to_account_info(),
                    authority: self.protocol_fee_vault.to_account_info(),
                };


        let vault_mint = &self.protocol_fee_vault.mint;
        let seeds = [
            b"protocol_fee",
            vault_mint.as_ref(),
        ];
        let signer = &[&seeds[..]];

        let cpi_program = self.token_program.to_account_info();
        
        let cpi_ctx = CpiContext::new_with_signer(
                cpi_program,
                cpi_accounts,
                signer,
            );
        
        transfer_checked(cpi_ctx, amount, self.token_mint.decimals)?;

        Ok(())
    }
}