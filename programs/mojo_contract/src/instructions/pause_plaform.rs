use anchor_lang::prelude::*;

use crate::{error::AmmError, PlatformPauseChanged, PlatformState};

#[derive(Accounts)]
pub struct PausePlatform<'info> {
    /// Platform configuration (PDA)
    #[account(
        mut,
        seeds = [b"platform-state"],
        bump = platform.bump,
        has_one = admin // Ensures platform.admin == admin.key()
    )]
    pub platform: Account<'info, PlatformState>,

    /// Platform admin (must match platform.admin)
    #[account(mut)]
    pub admin: Signer<'info>,

    /// System program for clock access
    pub system_program: Program<'info, System>,
}

impl<'info> PausePlatform<'info> {
    pub fn pause_platform(&mut self, pause: bool) -> Result<()> {
        let platform = &mut self.platform;

        // Additional security check (redundant with has_one but explicit)
        require!(
            platform.admin == self.admin.key(),
            AmmError::Unauthorized
        );

        // Validate state transition
        if pause {
            require!(!platform.is_paused, AmmError::AlreadyPaused);
        } else {
            require!(platform.is_paused, AmmError::NotPaused);
        }

        platform.is_paused = pause;

        // Emit event if using event system
        emit!(PlatformPauseChanged {
            admin: self.admin.key(),
            paused: pause,
            timestamp: Clock::get()?.unix_timestamp
        });

        Ok(())
    }
}

