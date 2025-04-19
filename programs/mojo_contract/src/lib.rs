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

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
    
    Ok(())
    }
}
