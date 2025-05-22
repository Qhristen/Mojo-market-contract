use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct PlatformState {
    pub base_token_mint: Pubkey,
    pub admin: Pubkey,
    pub fee_collector: Pubkey,
    pub dao_config: Option<DaoConfigInfo>,
    pub security: PlatformSecurity,
    pub stats: PlatformStats,
    pub platform_fee_bps: u16, // Basis points (1% = 100)
    pub bump: u8,
    pub version: u8,
}

#[derive(InitSpace, AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct PlatformSecurity {
    pub is_paused: bool,
    pub last_pause_time: i64,
    pub pause_count: u32,
}

#[derive(InitSpace, AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct PlatformStats {
    pub pair_count: u64,
    pub total_volume: u64,
    pub total_fees: u64,
}

#[derive(InitSpace, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DaoConfigInfo {
    pub dao_program: Pubkey,
    pub governance_token_mint: Pubkey,
    pub proposal_count: u64,
}

#[event]
pub struct PlatformInitialized {
    pub timestamp: i64,
    pub admin: Pubkey,
    pub base_token: Pubkey,
}

const CURRENT_VERSION: u8 = 1;

#[account]
#[derive(InitSpace)]
pub struct DaoConfig {
    pub governance_mint: Pubkey, // Governance token
    pub admin: Pubkey,           // Multisig address
    pub proposal_count: u64,
    pub params: DaoParams, // Packed governance parameters
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct DaoParams {
    pub voting_period: i64,     // Seconds
    pub quorum_percent: u8,     // 0-100
    pub approval_threshold: u8, // 0-100
    pub min_proposal_deposit: u64,
    pub fee_share_bps: u16, // Protocol fee %
}
