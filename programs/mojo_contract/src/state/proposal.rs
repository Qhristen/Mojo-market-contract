use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Proposal {
    pub id: u64,
    pub pair_meta: PairMeta,          // Reusable pair data
    pub state: ProposalState,
    pub votes: VoteTally,
    pub exec_context: ExecContext,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
// #[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PairMeta {
    pub base_mint: Pubkey,
    pub paired_mint: Pubkey,
    pub proposed_fee_bps: u16,        // Fee rate for pair
}

#[account]
#[derive(InitSpace)]
// #[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct VoteTally {
    pub for_votes: u64,
    pub against_votes: u64,
    pub abstain_votes: u64,
}

#[account]
#[derive(InitSpace)]
pub struct ExecContext {
    pub created_pair: Option<Pubkey>, // Populated on execution
    pub executed_at: Option<i64>,
}

#[derive(InitSpace, AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum ProposalState {
    Draft,
    Active,
    Succeeded,
    Defeated,
    Executed,
}