use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Pair {
    pub base_mint: Pubkey,       // MOJO mint
    pub paired_mint: Pubkey,     // Player token mint
    pub lp_mint: Pubkey,         // LP token mint
    pub base_reserve: u64,       // MOJO reserves
    pub paired_reserve: u64,     // Player token reserves
    pub fee_rate: u16,           // Swap fee (e.g., 30 = 0.3%)
    pub total_liquidity: u64,    // Total LP tokens minted
}