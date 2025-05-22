use anchor_lang::prelude::*;

use super::PairMeta;

#[account]
#[derive(InitSpace)]
pub struct Pair {
    pub meta: PairMeta,
    pub reserves: Reserves,
    pub vaults: Vaults,
    pub created_by: Creator,          // DAO or Admin
    pub created_at: i64,
    pub bump: u8,
}

#[derive(InitSpace, AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum Creator {
    DaoProposal(Pubkey),  // Proposal that created this pair
    Admin,                // Created directly by admin
}


#[account]
#[derive(InitSpace)]
pub struct Reserves {
    pub base: u64,
    pub paired: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Vaults {
    pub base: Pubkey,
    pub paired: Pubkey,
    pub lp_mint: Pubkey,
}