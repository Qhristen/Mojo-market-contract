use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Pair {
    pub base_token_mint: Pubkey,    // MOJO mint
    pub paired_token_mint: Pubkey,  // Player token mint
    pub lp_mint: Pubkey,      // LP token mint
    pub base_reserve: u64,    // MOJO reserves
    pub paired_reserve: u64,  // Player token reserves
    pub total_liquidity: u64, // Total LP tokens minted
    pub bump: u8,
    pub last_swap_time: i64,
    // pub protocol_fee_rate: u16, // Swap fee (e.g., 30 = 0.3%)
    pub base_vault: Pubkey,
    pub paired_vault: Pubkey,
}
