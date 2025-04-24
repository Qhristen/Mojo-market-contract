// instructions/initialize_platform.rs
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::state::PlatformState;

#[derive(Accounts)]
pub struct InitializePlatform<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    pub base_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = admin,
        space = 8 + PlatformState::INIT_SPACE,
        seeds = [b"platform-state"],
        bump
    )]
    pub platform_state: Account<'info, PlatformState>,

    // Treasury/fee collector ATA
    #[account(
        init,
        payer = admin,
        associated_token::mint = base_token_mint,
        associated_token::authority = platform_state,
    )]
    pub platform_treasury: Box<InterfaceAccount<'info, TokenAccount>>,

    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> InitializePlatform<'info> {
    pub fn initialize_platform(
        &mut self,
        protocol_fee_rate: u16,
        bumps: &InitializePlatformBumps,
    ) -> Result<()> {
        self.platform_state.set_inner(PlatformState {
            base_token_mint: self.base_token_mint.key(),
            admin: self.admin.key(),
            fee_collector: self.platform_treasury.key(),
            is_paused: false,
            protocol_fee_rate,
            bump: bumps.platform_state,
        });
        Ok(())
    }
}
