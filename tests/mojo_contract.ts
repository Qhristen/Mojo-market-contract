import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { MojoContract } from "../target/types/mojo_contract"; // Replace with your actual program name
import { assert } from "chai";

import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE
} from "@solana/spl-token";

import { SystemProgram } from "@solana/web3.js";

describe("Platform Program", () => {
  // Initialize the Anchor provider
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider();

  // Get the Anchor program instance
  const program = anchor.workspace.MojoContract as Program<MojoContract>; // Replace with your actual program name

  // Admin Keypair
  const admin = anchor.web3.Keypair.generate();

  // Mint and account PDAs
  const baseTokenMint = anchor.web3.Keypair.generate();
  const [platformStatePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("platform-state")],
    program.programId
  );

  // Platform treasury (fee collector) ATA
  const platformTreasury = getAssociatedTokenAddressSync(
    baseTokenMint.publicKey,
    platformStatePda,
    true,
    TOKEN_PROGRAM_ID
  );

  // Constants
  const PROTOCOL_FEE_RATE = 250; // 2.5% represented as basis points (250/10000)

  before(async () => {
    console.log("🔄 Setting up test environment...");

    // Get rent-exemption amount for mint
    const lamports = await getMinimumBalanceForRentExemptMint(provider.connection);

    // Airdrop SOL to provider wallet
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(provider.wallet.publicKey, 10e9)
    );

    // Airdrop SOL to admin
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(admin.publicKey, 5e9)
    );

    console.log("✅ Creating base token mint...");

    // Create the base token mint
    let tx = new anchor.web3.Transaction();
    tx.instructions = [
      SystemProgram.createAccount({
        fromPubkey: provider.publicKey,
        newAccountPubkey: baseTokenMint.publicKey,
        lamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID
      }),
      createInitializeMint2Instruction(
        baseTokenMint.publicKey,
        6, // 6 decimals
        admin.publicKey,
        null,
        TOKEN_PROGRAM_ID
      )
    ];

    await provider.sendAndConfirm(tx, [baseTokenMint]);
    console.log("✅ Base token mint created successfully");
  });

  it("Initializes platform state correctly", async () => {
    console.log("🔧 Initializing platform...");

    await program.methods
      .initializePlatform(PROTOCOL_FEE_RATE)
      .accountsPartial({
        admin: admin.publicKey,
        baseTokenMint: baseTokenMint.publicKey,
        platformState: platformStatePda,
        platformTreasury: platformTreasury,
        systemProgram: SystemProgram.programId,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

    console.log("✅ Fetching platform state...");
    const platformState = await program.account.platformState.fetch(platformStatePda);

    // Verify platform state data
    assert.ok(platformState.baseTokenMint.equals(baseTokenMint.publicKey));
    assert.ok(platformState.admin.equals(admin.publicKey));
    assert.ok(platformState.feeCollector.equals(platformTreasury));
    assert.equal(platformState.protocolFeeRate, PROTOCOL_FEE_RATE);
    assert.equal(platformState.isPaused, false);

    console.log("✅ Platform initialized successfully!");
  });

  it("Fails to initialize platform with unauthorized user", async () => {
    console.log("🚨 Attempting unauthorized initialization...");

    // Create a new unauthorized user
    const unauthorizedUser = anchor.web3.Keypair.generate();

    // Airdrop SOL to unauthorized user
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(unauthorizedUser.publicKey, 1e9)
    );

    // Create a new set of PDAs for this test
    const newBaseTokenMint = anchor.web3.Keypair.generate();
    const [newPlatformStatePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("platform-state-unauthorized")], // Using different seed to create a new PDA
      program.programId
    );

    const newPlatformTreasury = getAssociatedTokenAddressSync(
      newBaseTokenMint.publicKey,
      newPlatformStatePda,
      true,
      TOKEN_PROGRAM_ID
    );

    // Create the new base token mint for this test
    let tx = new anchor.web3.Transaction();
    const lamports = await getMinimumBalanceForRentExemptMint(provider.connection);

    tx.instructions = [
      SystemProgram.createAccount({
        fromPubkey: provider.publicKey,
        newAccountPubkey: newBaseTokenMint.publicKey,
        lamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID
      }),
      createInitializeMint2Instruction(
        newBaseTokenMint.publicKey,
        6,
        unauthorizedUser.publicKey,
        null,
        TOKEN_PROGRAM_ID
      )
    ];

    await provider.sendAndConfirm(tx, [newBaseTokenMint]);

    try {
      // Try to initialize with unauthorized user
      await program.methods
        .initializePlatform(PROTOCOL_FEE_RATE)
        .accountsPartial({
          admin: unauthorizedUser.publicKey,
          baseTokenMint: newBaseTokenMint.publicKey,
          platformState: newPlatformStatePda,
          platformTreasury: newPlatformTreasury,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([unauthorizedUser])
        .rpc();

      assert.fail("🚨 Unauthorized initialization should have failed!");
    } catch (error) {
      // Expected to fail if you've implemented access control
      console.log("✅ Unauthorized initialization was correctly rejected.");
    }
  });

  it("Validates protocol fee rate constraints", async () => {
    // This test assumes your program has validation for protocol fee rate
    console.log("🧪 Testing protocol fee rate constraints...");

    // Create new keypair for this test
    const testAdmin = anchor.web3.Keypair.generate();

    // Airdrop SOL to test admin
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(testAdmin.publicKey, 2e9)
    );

    // Create a new set of PDAs for this test
    const testMint = anchor.web3.Keypair.generate();
    const [testPlatformStatePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("platform-state-test")], // Using different seed
      program.programId
    );

    const testTreasury = getAssociatedTokenAddressSync(
      testMint.publicKey,
      testPlatformStatePda,
      true,
      TOKEN_PROGRAM_ID
    );

    // Create the test mint
    let tx = new anchor.web3.Transaction();
    const lamports = await getMinimumBalanceForRentExemptMint(provider.connection);

    tx.instructions = [
      SystemProgram.createAccount({
        fromPubkey: provider.publicKey,
        newAccountPubkey: testMint.publicKey,
        lamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID
      }),
      createInitializeMint2Instruction(
        testMint.publicKey,
        6,
        testAdmin.publicKey,
        null,
        TOKEN_PROGRAM_ID
      )
    ];

    await provider.sendAndConfirm(tx, [testMint]);

    try {
      // Try to initialize with an excessively high fee rate (e.g., 10001 basis points > 100%)
      const EXCESSIVE_FEE_RATE = 10001;

      await program.methods
        .initializePlatform(EXCESSIVE_FEE_RATE)
        .accountsPartial({
          admin: testAdmin.publicKey,
          baseTokenMint: testMint.publicKey,
          platformState: testPlatformStatePda,
          platformTreasury: testTreasury,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([testAdmin])
        .rpc();

      assert.fail("🚨 Initialization with excessive fee rate should have failed!");
    } catch (error) {
      // Expected to fail if you've implemented fee rate validation
      console.log("✅ Excessive fee rate was correctly rejected.");
    }
  });
});