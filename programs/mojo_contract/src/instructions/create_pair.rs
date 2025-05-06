use crate::state::Pair;
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{error::AmmError, PlatformState};

#[derive(Accounts)]
pub struct CreatePair<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        seeds = [b"pair", base_token_mint.key().as_ref(), paired_token_mint.key().as_ref()],
        bump,
        space = 8 + Pair::INIT_SPACE,
    )]
    pub pair: Account<'info, Pair>,

    pub base_token_mint: Box<InterfaceAccount<'info, Mint>>,
    pub paired_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = creator,
        seeds = [b"lp_mint", pair.key().as_ref()],
        bump,
        mint::decimals = 9,
        mint::authority = pair,
    )]
    pub lp_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = creator,
        associated_token::mint = base_token_mint,
        associated_token::authority = pair,
    )]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = creator,
        associated_token::mint = paired_token_mint,
        associated_token::authority = pair,
    )]
    pub paired_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"platform-state"],
        bump,
    )]
    pub platform_state: Account<'info, PlatformState>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

impl<'info> CreatePair<'info> {
    pub fn create_pair(
        &mut self,
        pair_name: String,
        bump: u8,
    ) -> Result<()> {

        // Check that base token is the platform's base token (MOJO)
        require!(
            self.base_token_mint.key() == self.platform_state.base_token_mint,
            AmmError::InvalidBaseToken
        );

        // Initialize pair state
        self.pair.set_inner(Pair {
            base_token_mint: self.base_token_mint.key(),
            paired_token_mint: self.paired_token_mint.key(),
            lp_mint: self.lp_mint.key(),
            base_reserve: 0,
            paired_reserve: 0,
            total_liquidity: 0,
            bump,
            last_swap_time: Clock::get()?.unix_timestamp,
            base_vault: self.base_vault.key(),
            paired_vault: self.paired_vault.key(),
        });

        msg!("Created new pair: {}", pair_name);

        Ok(())
    }
}
