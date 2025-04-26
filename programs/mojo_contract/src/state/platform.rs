use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct PlatformState {  
    pub base_token_mint: Pubkey, // MOJO mint address  
    pub admin: Pubkey,           // Platform admin  
    pub fee_collector: Pubkey,   // Fee destination  
    pub is_paused: bool,         // Emergency stop  
    pub protocol_fee_rate: u16,
    pub bump: u8,
}  


#[event]
pub struct PlatformPauseChanged {
    pub admin: Pubkey,
    pub paused: bool,
    pub timestamp: i64,
}