// instructions/initialize_platform.rs
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{error::AmmError, state::PlatformState, PlatformInitialized, PlatformSecurity, PlatformStats};

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
    pub platform: Account<'info, PlatformState>,

    /// Protocol fee collector (must be base token account)
    #[account(
        mut,
        constraint = fee_collector.owner == platform.key() @ AmmError::InvalidFeeCollector
    )]
    pub fee_collector: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> InitializePlatform<'info> {
    pub fn initialize_platform(&mut self,platform_fee_bps: u16, bumps: &InitializePlatformBumps) -> Result<()> {
        let clock = Clock::get()?;

        self.platform.set_inner(PlatformState {
            base_token_mint: self.base_token_mint.key(),
            admin: self.admin.key(),
            platform_fee_bps,
            fee_collector: self.fee_collector.key(),
            dao_config: None,
            security: PlatformSecurity {
                is_paused: false,
                last_pause_time: clock.unix_timestamp,
                pause_count: 0,
            },
            stats: PlatformStats {
                pair_count: 0,
                total_volume: 0,
                total_fees: 0,
            },
            bump: bumps.platform,
            version: 1,
        });

         // Validate fee collector account
        require!(
            self.fee_collector.mint == self.base_token_mint.key(),
            AmmError::InvalidFeeCollector
        );

        emit!(PlatformInitialized {
            timestamp: clock.unix_timestamp,
            admin: self.admin.key(),
            base_token: self.base_token_mint.key(),
        });
        Ok(())
    }
}
