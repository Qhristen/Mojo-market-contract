use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("HrEj3FFzTt965KGmU4krw1y7oeS1QUSA468Pkw7S2cgM");

#[program]
pub mod mojo_contract {
    use super::*;

    pub fn swap(ctx: Context<Swap>, input_amount: u64, min_output_amount: u64) -> Result<()> {
        ctx.accounts.swap(input_amount, min_output_amount)?;
        Ok(())
    }

    pub fn initialize_platform(
        ctx: Context<InitializePlatform>,
        protocol_fee_rate: u16,
    ) -> Result<()> {
        ctx.accounts
            .initialize_platform(protocol_fee_rate, &ctx.bumps)
    }

    pub fn create_pair(
        ctx: Context<CreatePair>,
        pair_name: String,
        fee_rate: u16,
        protocol_fee_rate: u16,
    ) -> Result<()> {
        ctx.accounts
            .create_pair(pair_name, fee_rate, protocol_fee_rate, ctx.bumps.pair)?;
        Ok(())
    }

    pub fn pause_plaform(
        ctx: Context<PausePlatform>,
    ) -> Result<()> {
        ctx.accounts.pause_platform();
        
        Ok(())
    }

    pub fn resume_plaform(
        ctx: Context<ResumePlatform>,
    ) -> Result<()> {
        ctx.accounts.resume_platform();
        
        Ok(())
    }

    pub fn update_fee_rate(
        ctx: Context<UpdateFeeRate>,
        new_fee_rate: u16,
    ) -> Result<()> {
        ctx.accounts.update_fee_rate(new_fee_rate)?;
        Ok(())
    }

    pub fn withdraw_platform_fees(
        ctx: Context<WithdrawPlatformFees>,
        amount: u64,
    ) -> Result<()> {
        ctx.accounts.withdraw_fees(amount)?;
        Ok(())
    }
}
