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

    #[msg("Fee rate cannot exceed 10%")]
    FeeTooHigh,
    #[msg("Protocol fee rate cannot exceed 2%")]
    ProtocolFeeTooHigh,
    #[msg("Base token must be the platform's base token (MOJO)")]
    InvalidBaseToken,
    #[msg("Invalid paired token")]
    InvalidPairedToken,

    #[msg("Unauthorized access")]
    Unauthorized,

    #[msg("Token mint mismatch")]
    TokenMintMismatch,
    #[msg("Invalid amount")]
    InvalidAmount,

    #[msg("Platform is already paused")]
    AlreadyPaused,
    #[msg("Platform is not paused")]
    NotPaused,
    #[msg("Invalid pause transition")]
    InvalidPauseState,

    #[msg("Insufficient liquidity minted")]
    InsufficientLiquidityMinted,
    #[msg("Insufficient liquidity")]
    InsufficientLiquidity,
    #[msg("Math overflow occurred")]
    MathOverflow,
    #[msg("Invalid fee collector mint")]
    InvalidFeeCollectorMint,
}
