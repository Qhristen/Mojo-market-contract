use crate::{error::AmmError, state::Pair};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{mint_to, transfer, MintTo, Transfer},
    token_interface::{Mint, TokenAccount, TokenInterface},
};

#[derive(Accounts)]
#[instruction(base_amount: u64, paired_amount: u64)]
pub struct AddLiquidity<'info> {
    /// The user adding liquidity
    #[account(mut)]
    pub user: Signer<'info>,

    /// The Pair state for the MOJO/paired token pool
    #[account(
        mut,
        seeds = [b"pair", pair.base_token_mint.as_ref(), pair.paired_token_mint.as_ref()],
        bump = pair.bump,
        has_one = base_vault,
        has_one = paired_vault,
        has_one = lp_mint,
    )]
    pub pair: Account<'info, Pair>,

    /// Vault holding base token (MOJO)
    #[account(mut, address = pair.base_vault)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// User's base token ATA
    #[account(
        mut,
        associated_token::mint = pair.base_token_mint,
        associated_token::authority = user,
    )]
    pub user_base_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Vault holding paired token
    #[account(mut, address = pair.paired_vault)]
    pub paired_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// User's paired token ATA
    #[account(
        mut,
        associated_token::mint = pair.paired_token_mint,
        associated_token::authority = user,
    )]
    pub user_paired_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// LP token mint for this pool
    #[account(mut, address = pair.lp_mint)]
    pub lp_mint: InterfaceAccount<'info, Mint>,

    /// User's LP token ATA
    #[account(
        mut,
        associated_token::mint = pair.lp_mint,
        associated_token::authority = user,
    )]
    pub user_lp_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Token program

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> AddLiquidity<'info> {
    pub fn add_liquidity(&mut self, base_amount: u64, paired_amount: u64) -> Result<()> {
        // Load current reserves and total supply
        let base_reserve = self.pair.base_reserve;
        let paired_reserve = self.pair.paired_reserve;
        let total_lp = self.pair.total_liquidity;

        // Calculate liquidity to mint
        let minted_lp = if total_lp == 0 {
            // Initial liquidity: sqrt(base_amount * paired_amount)
            let product = (base_amount as u128)
                .checked_mul(paired_amount as u128)
                .ok_or(AmmError::MathOverflow)?;
            let sqrt = integer_sqrt(product);
            sqrt as u64
        } else {
            // Proportional liquidity
            let lp_from_base = (base_amount as u128)
                .checked_mul(total_lp as u128)
                .ok_or(AmmError::MathOverflow)?
                .checked_div(base_reserve as u128)
                .ok_or(AmmError::MathOverflow)?;
            let lp_from_paired = (paired_amount as u128)
                .checked_mul(total_lp as u128)
                .ok_or(AmmError::MathOverflow)?
                .checked_div(paired_reserve as u128)
                .ok_or(AmmError::MathOverflow)?;
            let min_lp = std::cmp::min(lp_from_base, lp_from_paired);
            min_lp as u64
        };

        require!(minted_lp > 0, AmmError::InsufficientLiquidityMinted);

        // Transfer base tokens from user to vault
        let cpi_accounts_base = Transfer {
            from: self.user_base_ata.to_account_info(),
            to: self.base_vault.to_account_info(),
            authority: self.user.to_account_info(),
        };
        let cpi_program = self.token_program.to_account_info();
        let cpi_ctx_base = CpiContext::new(cpi_program.clone(), cpi_accounts_base);
        transfer(cpi_ctx_base, base_amount)?;

        // Transfer paired tokens from user to vault
        let cpi_accounts_paired = Transfer {
            from: self.user_paired_ata.to_account_info(),
            to: self.paired_vault.to_account_info(),
            authority: self.user.to_account_info(),
        };
        let cpi_ctx_paired = CpiContext::new(cpi_program.clone(), cpi_accounts_paired);
        transfer(cpi_ctx_paired, paired_amount)?;

        // Mint LP tokens to user
        let seeds = &[
            b"pair",
            self.pair.base_token_mint.as_ref(),
            self.pair.paired_token_mint.as_ref(),
            &[self.pair.bump],
        ];
        let signer = &[&seeds[..]];
        let cpi_accounts_mint = MintTo {
            mint: self.lp_mint.to_account_info(),
            to: self.user_lp_ata.to_account_info(),
            authority: self.pair.to_account_info(),
        };
        let cpi_ctx_mint = CpiContext::new_with_signer(
            self.token_program.to_account_info(),
            cpi_accounts_mint,
            signer,
        );
        mint_to(cpi_ctx_mint, minted_lp)?;

        // Update reserves and total liquidity
        self.pair.base_reserve = base_reserve
            .checked_add(base_amount)
            .ok_or(AmmError::MathOverflow)?;
        self.pair.paired_reserve = paired_reserve
            .checked_add(paired_amount)
            .ok_or(AmmError::MathOverflow)?;
        self.pair.total_liquidity = total_lp
            .checked_add(minted_lp)
            .ok_or(AmmError::MathOverflow)?;

        Ok(())
    }
}

/// Integer square root for u128
fn integer_sqrt(value: u128) -> u128 {
    if value < 2 {
        return value;
    }
    // Babylonian method
    let mut x0 = value / 2 + 1;
    let mut x1 = (x0 + value / x0) / 2;
    while x1 < x0 {
        x0 = x1;
        x1 = (x0 + value / x0) / 2;
    }
    x0
}
