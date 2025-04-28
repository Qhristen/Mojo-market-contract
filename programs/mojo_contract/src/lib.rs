pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

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

    pub fn pause_platform(ctx: Context<PausePlatform>, pause: bool) -> Result<()> {
        ctx.accounts.pause_platform(pause)?;
        Ok(())
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

    pub fn add_liquidity(
        ctx: Context<AddLiquidity>,
        base_amount: u64,
        paired_amount: u64,
    ) -> Result<()> {
        ctx.accounts.add_liquidity(base_amount, paired_amount)?;
        Ok(())
    }
}
