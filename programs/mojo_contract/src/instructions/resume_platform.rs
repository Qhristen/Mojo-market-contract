use anchor_lang::prelude::*;
use crate::{error::AmmError, state::PlatformState};

#[derive(Accounts)]
pub struct ResumePlatform<'info> {
    #[account(constraint = admin.key() == platform_state.admin @ AmmError::Unauthorized)]
    pub admin: Signer<'info>,

    #[account(
        mut
    )]
    pub platform_state: Account<'info, PlatformState>,
    pub system_program: Program<'info, System>,
}

impl<'info> ResumePlatform<'info> {
    pub fn resume_platform(&mut self) -> Result<()> {
        self.platform_state.is_paused = true;
        Ok(())
    }    
}