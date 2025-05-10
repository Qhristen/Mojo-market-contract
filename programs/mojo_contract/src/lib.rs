use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("AMGoaF1FYy6qijdYnLwqQmpxe7eQTVwAy2SvTQbHQcER");

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

    pub fn pause_platform(ctx: Context<PausePlatform>, pause: bool) -> Result<()> {
        ctx.accounts.pause_platform(pause)?;
        Ok(())
    }

    pub fn create_pair(ctx: Context<CreatePair>) -> Result<()> {
        ctx.accounts.create_pair(ctx.bumps.pair)?;
        Ok(())
    }

    pub fn add_liquidity(
        ctx: Context<AddLiquidity>,
        base_amount: u64,
        paired_amount: u64,
    ) -> Result<()> {
        ctx.accounts.add_liquidity(base_amount, paired_amount)?;

        Ok(())
    }

    pub fn remove_liquidity(
        ctx: Context<RemoveLiquidity>,
        lp_amount: u64,
        min_base: u64,
        min_paired: u64,
    ) -> Result<()> {
        ctx.accounts
            .remove_liquidity(lp_amount, min_base, min_paired)?;
        Ok(())
    }

    pub fn resume_plaform(ctx: Context<ResumePlatform>) -> Result<()> {
        ctx.accounts.resume_platform()?;

        Ok(())
    }

    pub fn update_fee_rate(ctx: Context<UpdateFeeRate>, new_fee_rate: u16) -> Result<()> {
        ctx.accounts.update_fee_rate(new_fee_rate)?;
        Ok(())
    }

    pub fn withdraw_platform_fees(ctx: Context<WithdrawPlatformFees>, amount: u64) -> Result<()> {
        ctx.accounts.withdraw_fees(amount)?;

        Ok(())
    }
}
