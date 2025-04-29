use anchor_lang::prelude::*;
use crate::{error::AmmError, state::PlatformState};

#[derive(Accounts)]
pub struct UpdateFeeRate<'info> {
    #[account(
        mut,
    )]
    pub platform_state: Account<'info, PlatformState>,

    #[account(constraint = admin.key() == platform_state.admin @ AmmError::Unauthorized)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> UpdateFeeRate<'info>{
    pub fn update_fee_rate(&mut self, new_fee_rate: u16)->Result<()>{

        // Update the protocol fee rate
        self.platform_state.protocol_fee_rate = new_fee_rate;

        msg!("Protocol fee rate updated to: {}bps", new_fee_rate);
        
        Ok(())
    }
}