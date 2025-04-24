use anchor_lang::prelude::*;

#[error_code]
pub enum AmmError {
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[msg("Trading is paused")]
    TradingPaused,
    #[msg("Invalid zero amount")]
    ZeroAmount,
    #[msg("Arithmetic error")]
    MathError,
    #[msg("Swap cooldown not expired")]
    SwapCooldown,
    #[msg("Invalid token pair")]
    InvalidPair,
    #[msg("Invalid fee configuration")]
    InvalidFeeConfig,
}