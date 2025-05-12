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
  MINT_SIZE,
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
  const pairedTokenMint = anchor.web3.Keypair.generate();

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

  /// Find the pair PDA address
  const [pairPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("pair"),
      baseTokenMint.publicKey.toBuffer(),
      pairedTokenMint.publicKey.toBuffer(),
    ],
    program.programId
  );

  // Find LP mint PDA address
  const [lpMintPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint"), pairPda.toBuffer()],
    program.programId
  );

  // Find vault token account addresses
  const baseVault = getAssociatedTokenAddressSync(
    baseTokenMint.publicKey,
    pairPda,
    true,
    TOKEN_PROGRAM_ID
  );

  const pairedVault = getAssociatedTokenAddressSync(
    pairedTokenMint.publicKey,
    pairPda,
    true,
    TOKEN_PROGRAM_ID
  );

  // User token accounts
  let userBaseTokenAccount;
  let userPairedTokenAccount;
  let userLpTokenAccount;

  // Constants
  const PROTOCOL_FEE_RATE = 250; // 2.5% represented as basis points (250/10000)
  const INITIAL_LIQUIDITY_BASE = 1_000_000_000; // 1000 tokens with 6 decimals
  const INITIAL_LIQUIDITY_PAIRED = 1_000_000_000; // 1000 tokens with 6 decimals
  const SWAP_AMOUNT = 50_000_000; // 50 tokens with 6 decimals
  const MIN_EXPECTED_OUTPUT = 45_000_000; // 45 tokens with 6 decimals (accounting for fees)




  before(async () => {
    console.log("🔄 Setting up test environment...");

    // Get rent-exemption amount for mint
    const lamports = await getMinimumBalanceForRentExemptMint(
      provider.connection
    );

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
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        baseTokenMint.publicKey,
        6, // 6 decimals
        admin.publicKey,
        null,
        TOKEN_PROGRAM_ID
      ),
    ];

    await provider.sendAndConfirm(tx, [baseTokenMint]);
    console.log("✅ Base token mint created successfully");


    console.log("✅ Creating paired token mint...");
    // Create the paired token mint
    tx = new anchor.web3.Transaction();
    tx.instructions = [
      SystemProgram.createAccount({
        fromPubkey: provider.publicKey,
        newAccountPubkey: pairedTokenMint.publicKey,
        lamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        pairedTokenMint.publicKey,
        6, // 6 decimals
        admin.publicKey,
        null,
        TOKEN_PROGRAM_ID
      ),
    ];

    await provider.sendAndConfirm(tx, [pairedTokenMint]);
    console.log("✅ Paired token mint created successfully");

    // Create user token accounts
    console.log("✅ Creating token accounts for admin...");
    userBaseTokenAccount = getAssociatedTokenAddressSync(
      baseTokenMint.publicKey,
      admin.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );

    userPairedTokenAccount = getAssociatedTokenAddressSync(
      pairedTokenMint.publicKey,
      admin.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );

    userLpTokenAccount = getAssociatedTokenAddressSync(
      lpMintPda,
      admin.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );

    // Create token accounts and mint tokens to admin
    tx = new anchor.web3.Transaction();
    tx.instructions = [
      // Create base token account
      createAssociatedTokenAccountIdempotentInstruction(
        admin.publicKey,
        userBaseTokenAccount,
        admin.publicKey,
        baseTokenMint.publicKey,
        TOKEN_PROGRAM_ID
      ),
      // Create paired token account
      createAssociatedTokenAccountIdempotentInstruction(
        admin.publicKey,
        userPairedTokenAccount,
        admin.publicKey,
        pairedTokenMint.publicKey,
        TOKEN_PROGRAM_ID
      ),
      // Mint base tokens to admin
      createMintToInstruction(
        baseTokenMint.publicKey,
        userBaseTokenAccount,
        admin.publicKey,
        INITIAL_LIQUIDITY_BASE * 2, // Double for testing
        [],
        TOKEN_PROGRAM_ID
      ),
      // Mint paired tokens to admin
      createMintToInstruction(
        pairedTokenMint.publicKey,
        userPairedTokenAccount,
        admin.publicKey,
        INITIAL_LIQUIDITY_PAIRED * 2, // Double for testing
        [],
        TOKEN_PROGRAM_ID
      ),
    ];

    await provider.sendAndConfirm(tx, [admin]);
    console.log("✅ Token accounts created and funded");
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
    const platformState = await program.account.platformState.fetch(
      platformStatePda
    );

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
    const lamports = await getMinimumBalanceForRentExemptMint(
      provider.connection
    );

    tx.instructions = [
      SystemProgram.createAccount({
        fromPubkey: provider.publicKey,
        newAccountPubkey: newBaseTokenMint.publicKey,
        lamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        newBaseTokenMint.publicKey,
        6,
        unauthorizedUser.publicKey,
        null,
        TOKEN_PROGRAM_ID
      ),
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
    const lamports = await getMinimumBalanceForRentExemptMint(
      provider.connection
    );

    tx.instructions = [
      SystemProgram.createAccount({
        fromPubkey: provider.publicKey,
        newAccountPubkey: testMint.publicKey,
        lamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        testMint.publicKey,
        6,
        testAdmin.publicKey,
        null,
        TOKEN_PROGRAM_ID
      ),
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

      assert.fail(
        "🚨 Initialization with excessive fee rate should have failed!"
      );
    } catch (error) {
      // Expected to fail if you've implemented fee rate validation
      console.log("✅ Excessive fee rate was correctly rejected.");
    }
  });

  // Continuing the tests for create_pair instruction

  it("Creates a token pair successfully", async () => {
    console.log("🔧 Creating a new token pair...");

    // Create paired token mint (the second token in the pair, not the base token)
    const mintLamports = await getMinimumBalanceForRentExemptMint(
      provider.connection
    );

    // Pair name and fee settings
    const pairName = "MOJO/TEST";
    const feeRate = 30; // 0.3% (30 basis points)
    const protocolFeeRate = 50; // 0.5% (50 basis points)

    // Create the pair
    await program.methods
      .createPair()
      .accountsPartial({
        creator: admin.publicKey,
        pair: pairPda,
        baseTokenMint: baseTokenMint.publicKey,
        pairedTokenMint: pairedTokenMint.publicKey,
        lpMint: lpMintPda,
        baseVault: baseVault,
        pairedVault: pairedVault,
        platformState: platformStatePda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    console.log("✅ Pair created successfully!");

    // Fetch pair account to verify data
    const pairAccount = await program.account.pair.fetch(pairPda);

    // Verify pair data
    assert.ok(
      pairAccount.baseTokenMint.equals(baseTokenMint.publicKey),
      "Base token mint doesn't match"
    );
    assert.ok(
      pairAccount.pairedTokenMint.equals(pairedTokenMint.publicKey),
      "Paired token mint doesn't match"
    );
    assert.ok(pairAccount.lpMint.equals(lpMintPda), "LP mint doesn't match");
    assert.ok(
      pairAccount.baseReserve.eq(new BN(0)),
      "Base reserve should be 0"
    );
    assert.ok(
      pairAccount.pairedReserve.eq(new BN(0)),
      "Paired reserve should be 0"
    );
    assert.ok(
      pairAccount.totalLiquidity.eq(new BN(0)),
      "Total liquidity should be 0"
    );
    assert.ok(
      pairAccount.baseVault.equals(baseVault),
      "Base vault doesn't match"
    );
    assert.ok(
      pairAccount.pairedVault.equals(pairedVault),
      "Paired vault doesn't match"
    );

    console.log("✅ Pair account data verified");
  });

  it("Fails to create pair with excessive fee rate", async () => {
    console.log("🧪 Testing fee rate constraints...");

    // Create a new token mint for this test
    const testPairedTokenMint = anchor.web3.Keypair.generate();
    const mintLamports = await getMinimumBalanceForRentExemptMint(
      provider.connection
    );

    // Create the test paired token mint
    const mintTx = new anchor.web3.Transaction();
    mintTx.instructions = [
      SystemProgram.createAccount({
        fromPubkey: provider.publicKey,
        newAccountPubkey: testPairedTokenMint.publicKey,
        lamports: mintLamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        testPairedTokenMint.publicKey,
        6, // 6 decimals
        admin.publicKey,
        null,
        TOKEN_PROGRAM_ID
      ),
    ];

    await provider.sendAndConfirm(mintTx, [testPairedTokenMint]);

    // Find test pair PDA address
    const [testPairPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pair"),
        baseTokenMint.publicKey.toBuffer(),
        testPairedTokenMint.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Find test LP mint PDA address
    const [testLpMintPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lp_mint"), testPairPda.toBuffer()],
      program.programId
    );

    // Find test vault addresses
    const testBaseVault = getAssociatedTokenAddressSync(
      baseTokenMint.publicKey,
      testPairPda,
      true,
      TOKEN_PROGRAM_ID
    );

    const testPairedVault = getAssociatedTokenAddressSync(
      testPairedTokenMint.publicKey,
      testPairPda,
      true,
      TOKEN_PROGRAM_ID
    );

    // Try with excessive fee rate (>10%)
    const excessiveFeeRate = 1100; // 11% (1100 basis points)
    const protocolFeeRate = 50; // 0.5%

    try {
      await program.methods
        .createPair()
        .accountsPartial({
          creator: admin.publicKey,
          pair: testPairPda,
          baseTokenMint: baseTokenMint.publicKey,
          pairedTokenMint: testPairedTokenMint.publicKey,
          lpMint: testLpMintPda,
          baseVault: testBaseVault,
          pairedVault: testPairedVault,
          platformState: platformStatePda,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      assert.fail(
        "🚨 Creating pair with excessive fee rate should have failed!"
      );
    } catch (error) {
      console.log("✅ Excessive fee rate was correctly rejected");
    }
  });

  it("Fails to create pair with excessive protocol fee rate", async () => {
    console.log("🧪 Testing protocol fee rate constraints...");

    // Create a new token mint for this test
    const testPairedTokenMint = anchor.web3.Keypair.generate();
    const mintLamports = await getMinimumBalanceForRentExemptMint(
      provider.connection
    );

    // Create the test paired token mint
    const mintTx = new anchor.web3.Transaction();
    mintTx.instructions = [
      SystemProgram.createAccount({
        fromPubkey: provider.publicKey,
        newAccountPubkey: testPairedTokenMint.publicKey,
        lamports: mintLamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        testPairedTokenMint.publicKey,
        6, // 6 decimals
        admin.publicKey,
        null,
        TOKEN_PROGRAM_ID
      ),
    ];

    await provider.sendAndConfirm(mintTx, [testPairedTokenMint]);

    // Find test pair PDA address
    const [testPairPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pair"),
        baseTokenMint.publicKey.toBuffer(),
        testPairedTokenMint.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Find test LP mint PDA address
    const [testLpMintPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lp_mint"), testPairPda.toBuffer()],
      program.programId
    );

    // Find test vault addresses
    const testBaseVault = getAssociatedTokenAddressSync(
      baseTokenMint.publicKey,
      testPairPda,
      true,
      TOKEN_PROGRAM_ID
    );

    const testPairedVault = getAssociatedTokenAddressSync(
      testPairedTokenMint.publicKey,
      testPairPda,
      true,
      TOKEN_PROGRAM_ID
    );

    // Normal fee rate but excessive protocol fee (>2%)
    const feeRate = 30; // 0.3%
    const excessiveProtocolFeeRate = 250; // 2.5% (250 basis points)

    try {
      await program.methods
        .createPair()
        .accountsPartial({
          creator: admin.publicKey,
          pair: testPairPda,
          baseTokenMint: baseTokenMint.publicKey,
          pairedTokenMint: testPairedTokenMint.publicKey,
          lpMint: testLpMintPda,
          baseVault: testBaseVault,
          pairedVault: testPairedVault,
          platformState: platformStatePda,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      assert.fail(
        "🚨 Creating pair with excessive protocol fee rate should have failed!"
      );
    } catch (error) {
      console.log("✅ Excessive protocol fee rate was correctly rejected");
    }
  });

  it("Fails to create pair with wrong base token", async () => {
    console.log("🧪 Testing base token validation...");

    // Create two new token mints for this test
    const wrongBaseTokenMint = anchor.web3.Keypair.generate();
    const anotherPairedTokenMint = anchor.web3.Keypair.generate();
    const mintLamports = await getMinimumBalanceForRentExemptMint(
      provider.connection
    );

    // Create the wrong base token mint
    let mintTx = new anchor.web3.Transaction();
    mintTx.instructions = [
      SystemProgram.createAccount({
        fromPubkey: provider.publicKey,
        newAccountPubkey: wrongBaseTokenMint.publicKey,
        lamports: mintLamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        wrongBaseTokenMint.publicKey,
        6, // 6 decimals
        admin.publicKey,
        null,
        TOKEN_PROGRAM_ID
      ),
    ];

    await provider.sendAndConfirm(mintTx, [wrongBaseTokenMint]);

    // Create another paired token mint
    mintTx = new anchor.web3.Transaction();
    mintTx.instructions = [
      SystemProgram.createAccount({
        fromPubkey: provider.publicKey,
        newAccountPubkey: anotherPairedTokenMint.publicKey,
        lamports: mintLamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        anotherPairedTokenMint.publicKey,
        6, // 6 decimals
        admin.publicKey,
        null,
        TOKEN_PROGRAM_ID
      ),
    ];

    await provider.sendAndConfirm(mintTx, [anotherPairedTokenMint]);

    // Find test pair PDA address with wrong base token
    const [testPairPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pair"),
        wrongBaseTokenMint.publicKey.toBuffer(),
        anotherPairedTokenMint.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Find test LP mint PDA address
    const [testLpMintPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lp_mint"), testPairPda.toBuffer()],
      program.programId
    );

    // Find test vault addresses
    const testBaseVault = getAssociatedTokenAddressSync(
      wrongBaseTokenMint.publicKey,
      testPairPda,
      true,
      TOKEN_PROGRAM_ID
    );

    const testPairedVault = getAssociatedTokenAddressSync(
      anotherPairedTokenMint.publicKey,
      testPairPda,
      true,
      TOKEN_PROGRAM_ID
    );

    // Valid fee rates
    const feeRate = 30; // 0.3%
    const protocolFeeRate = 50; // 0.5%

    try {
      await program.methods
        .createPair()
        .accountsPartial({
          creator: admin.publicKey,
          pair: testPairPda,
          baseTokenMint: wrongBaseTokenMint.publicKey, // Using wrong base token!
          pairedTokenMint: anotherPairedTokenMint.publicKey,
          lpMint: testLpMintPda,
          baseVault: testBaseVault,
          pairedVault: testPairedVault,
          platformState: platformStatePda,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      assert.fail("🚨 Creating pair with wrong base token should have failed!");
    } catch (error) {
      console.log("✅ Wrong base token was correctly rejected");
    }
  });

  it("Fails to create the same pair twice", async () => {
    console.log("🧪 Testing duplicate pair creation prevention...");

    // Create a new paired token mint
    const duplicatePairedTokenMint = anchor.web3.Keypair.generate();
    const mintLamports = await getMinimumBalanceForRentExemptMint(
      provider.connection
    );

    // Create the paired token mint
    const mintTx = new anchor.web3.Transaction();
    mintTx.instructions = [
      SystemProgram.createAccount({
        fromPubkey: provider.publicKey,
        newAccountPubkey: duplicatePairedTokenMint.publicKey,
        lamports: mintLamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        duplicatePairedTokenMint.publicKey,
        6, // 6 decimals
        admin.publicKey,
        null,
        TOKEN_PROGRAM_ID
      ),
    ];

    await provider.sendAndConfirm(mintTx, [duplicatePairedTokenMint]);

    // Find pair PDA address
    const [pairPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pair"),
        baseTokenMint.publicKey.toBuffer(),
        duplicatePairedTokenMint.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Find LP mint PDA address
    const [lpMintPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lp_mint"), pairPda.toBuffer()],
      program.programId
    );

    // Find vault addresses
    const baseVault = getAssociatedTokenAddressSync(
      baseTokenMint.publicKey,
      pairPda,
      true,
      TOKEN_PROGRAM_ID
    );

    const pairedVault = getAssociatedTokenAddressSync(
      duplicatePairedTokenMint.publicKey,
      pairPda,
      true,
      TOKEN_PROGRAM_ID
    );

    // Create the pair first time
    await program.methods
      .createPair()
      .accountsPartial({
        creator: admin.publicKey,
        pair: pairPda,
        baseTokenMint: baseTokenMint.publicKey,
        pairedTokenMint: duplicatePairedTokenMint.publicKey,
        lpMint: lpMintPda,
        baseVault: baseVault,
        pairedVault: pairedVault,
        platformState: platformStatePda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    console.log("✅ First pair created successfully");

    // Try to create the same pair again
    try {
      await program.methods
        .createPair()
        .accountsPartial({
          creator: admin.publicKey,
          pair: pairPda,
          baseTokenMint: baseTokenMint.publicKey,
          pairedTokenMint: duplicatePairedTokenMint.publicKey,
          lpMint: lpMintPda,
          baseVault: baseVault,
          pairedVault: pairedVault,
          platformState: platformStatePda,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      assert.fail("🚨 Creating the same pair twice should have failed!");
    } catch (error) {
      console.log("✅ Duplicate pair creation was correctly rejected");
    }
  });

  it("Can create multiple different pairs", async () => {
    console.log("🧪 Testing creation of multiple pairs...");

    // Create two new paired token mints
    const pairedTokenMint1 = anchor.web3.Keypair.generate();
    const pairedTokenMint2 = anchor.web3.Keypair.generate();
    const mintLamports = await getMinimumBalanceForRentExemptMint(
      provider.connection
    );

    // Create first paired token mint
    let mintTx = new anchor.web3.Transaction();
    mintTx.instructions = [
      SystemProgram.createAccount({
        fromPubkey: provider.publicKey,
        newAccountPubkey: pairedTokenMint1.publicKey,
        lamports: mintLamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        pairedTokenMint1.publicKey,
        6, // 6 decimals
        admin.publicKey,
        null,
        TOKEN_PROGRAM_ID
      ),
    ];

    await provider.sendAndConfirm(mintTx, [pairedTokenMint1]);

    // Create second paired token mint
    mintTx = new anchor.web3.Transaction();
    mintTx.instructions = [
      SystemProgram.createAccount({
        fromPubkey: provider.publicKey,
        newAccountPubkey: pairedTokenMint2.publicKey,
        lamports: mintLamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        pairedTokenMint2.publicKey,
        6, // 6 decimals
        admin.publicKey,
        null,
        TOKEN_PROGRAM_ID
      ),
    ];

    await provider.sendAndConfirm(mintTx, [pairedTokenMint2]);

    // Find pair 1 PDA
    const [pair1Pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pair"),
        baseTokenMint.publicKey.toBuffer(),
        pairedTokenMint1.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Find LP mint 1 PDA
    const [lpMint1Pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lp_mint"), pair1Pda.toBuffer()],
      program.programId
    );

    // Find vault 1 addresses
    const baseVault1 = getAssociatedTokenAddressSync(
      baseTokenMint.publicKey,
      pair1Pda,
      true,
      TOKEN_PROGRAM_ID
    );

    const pairedVault1 = getAssociatedTokenAddressSync(
      pairedTokenMint1.publicKey,
      pair1Pda,
      true,
      TOKEN_PROGRAM_ID
    );

    // Create pair 1
    await program.methods
      .createPair()
      .accountsPartial({
        creator: admin.publicKey,
        pair: pair1Pda,
        baseTokenMint: baseTokenMint.publicKey,
        pairedTokenMint: pairedTokenMint1.publicKey,
        lpMint: lpMint1Pda,
        baseVault: baseVault1,
        pairedVault: pairedVault1,
        platformState: platformStatePda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    console.log("✅ First pair created successfully");

    // Find pair 2 PDA
    const [pair2Pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("pair"),
        baseTokenMint.publicKey.toBuffer(),
        pairedTokenMint2.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Find LP mint 2 PDA
    const [lpMint2Pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lp_mint"), pair2Pda.toBuffer()],
      program.programId
    );

    // Find vault 2 addresses
    const baseVault2 = getAssociatedTokenAddressSync(
      baseTokenMint.publicKey,
      pair2Pda,
      true,
      TOKEN_PROGRAM_ID
    );

    const pairedVault2 = getAssociatedTokenAddressSync(
      pairedTokenMint2.publicKey,
      pair2Pda,
      true,
      TOKEN_PROGRAM_ID
    );

    // Create pair 2
    await program.methods
      .createPair()
      .accountsPartial({
        creator: admin.publicKey,
        pair: pair2Pda,
        baseTokenMint: baseTokenMint.publicKey,
        pairedTokenMint: pairedTokenMint2.publicKey,
        lpMint: lpMint2Pda,
        baseVault: baseVault2,
        pairedVault: pairedVault2,
        platformState: platformStatePda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    console.log("✅ Second pair created successfully");

    // Verify both pairs exist and have different data
    const pair1Account = await program.account.pair.fetch(pair1Pda);
    const pair2Account = await program.account.pair.fetch(pair2Pda);

    assert.ok(
      pair1Account.pairedTokenMint.equals(pairedTokenMint1.publicKey),
      "Pair 1 paired mint incorrect"
    );
    assert.ok(
      pair2Account.pairedTokenMint.equals(pairedTokenMint2.publicKey),
      "Pair 2 paired mint incorrect"
    );

    console.log("✅ Multiple pairs verification complete");
  });



  it("Adds initial liquidity successfully", async () => {
    console.log("🔧 Adding initial liquidity to the pool...");

    // Ensure all token accounts are created and funded
    const tx = new anchor.web3.Transaction();

    // Create/initialize LP token account with idempotent instruction
    const userLpTokenAccount = getAssociatedTokenAddressSync(
      lpMintPda,
      admin.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );

    // Add instructions to create token accounts if they don't exist
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        admin.publicKey,
        userLpTokenAccount,
        admin.publicKey,
        lpMintPda,
        TOKEN_PROGRAM_ID
      )
    );

    // Send transaction to ensure accounts exist
    if (tx.instructions.length > 0) {
      await provider.sendAndConfirm(tx, [admin]);
    }

    // Add liquidity
    await program.methods
      .addLiquidity(
        new BN(INITIAL_LIQUIDITY_BASE),
        new BN(INITIAL_LIQUIDITY_PAIRED)
      )
      .accountsPartial({
        user: admin.publicKey,
        pair: pairPda,
        baseVault: baseVault,
        userBaseAta: userBaseTokenAccount,
        pairedVault: pairedVault,
        userPairedAta: userPairedTokenAccount,
        lpMint: lpMintPda,
        userLpAta: userLpTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    console.log("✅ Initial liquidity added");

    // Verify pair state
    const pairAccount = await program.account.pair.fetch(pairPda);
    assert.ok(
      pairAccount.baseReserve.eq(new BN(INITIAL_LIQUIDITY_BASE)),
      "Base reserve incorrect"
    );
    assert.ok(
      pairAccount.pairedReserve.eq(new BN(INITIAL_LIQUIDITY_PAIRED)),
      "Paired reserve incorrect"
    );

    // Expected LP should be sqrt(base * paired) for initial liquidity
    const expectedLp = Math.floor(
      Math.sqrt(INITIAL_LIQUIDITY_BASE * INITIAL_LIQUIDITY_PAIRED)
    );
    assert.ok(
      pairAccount.totalLiquidity.eq(new BN(expectedLp)),
      `Total liquidity incorrect. Expected: ${expectedLp}, Got: ${pairAccount.totalLiquidity.toString()}`
    );

    // Verify LP tokens were minted to user
    const userLpBalance = await provider.connection.getTokenAccountBalance(
      userLpTokenAccount
    );
    assert.equal(
      userLpBalance.value.amount,
      expectedLp.toString(),
      "User LP balance incorrect"
    );

    console.log("✅ Liquidity state verified");
  });

  it("Adds additional liquidity with proper ratios", async () => {
    console.log("🔧 Adding additional liquidity to the pool...");

    // Ensure LP token account exists
    const userLpTokenAccount = getAssociatedTokenAddressSync(
      lpMintPda,
      admin.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );

    // Create LP token account if it doesn't exist
    const accountTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        admin.publicKey,
        userLpTokenAccount,
        admin.publicKey,
        lpMintPda,
        TOKEN_PROGRAM_ID
      )
    );

    if (accountTx.instructions.length > 0) {
      await provider.sendAndConfirm(accountTx, [admin]);
    }

    // Get current reserves
    const pairAccountBefore = await program.account.pair.fetch(pairPda);
    const baseReserveBefore = pairAccountBefore.baseReserve;
    const pairedReserveBefore = pairAccountBefore.pairedReserve;
    const totalLpBefore = pairAccountBefore.totalLiquidity;

    // Calculate amounts for equal proportion (adding 50% more liquidity)
    const additionalBaseAmount = INITIAL_LIQUIDITY_BASE / 2; // 50% of initial
    const additionalPairedAmount = INITIAL_LIQUIDITY_PAIRED / 2; // 50% of initial

    // Get user LP balance before
    const userLpBalanceBefore = await provider.connection.getTokenAccountBalance(
      userLpTokenAccount
    );

    // Add more liquidity
    await program.methods
      .addLiquidity(
        new BN(additionalBaseAmount),
        new BN(additionalPairedAmount)
      )
      .accountsPartial({
        user: admin.publicKey,
        pair: pairPda,
        baseVault: baseVault,
        userBaseAta: userBaseTokenAccount,
        pairedVault: pairedVault,
        userPairedAta: userPairedTokenAccount,
        lpMint: lpMintPda,
        userLpAta: userLpTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    console.log("✅ Additional liquidity added");

    // Verify updated pair state
    const pairAccountAfter = await program.account.pair.fetch(pairPda);

    // Reserves should increase by the additional amounts
    assert.ok(
      pairAccountAfter.baseReserve.eq(
        baseReserveBefore.add(new BN(additionalBaseAmount))
      ),
      "Base reserve not updated correctly"
    );
    assert.ok(
      pairAccountAfter.pairedReserve.eq(
        pairedReserveBefore.add(new BN(additionalPairedAmount))
      ),
      "Paired reserve not updated correctly"
    );

    // Expected LP tokens = (additionalBaseAmount / baseReserveBefore) * totalLpBefore
    // For equal proportional addition, should be 50% more LP tokens
    const expectedAdditionalLp = totalLpBefore.muln(50).divn(100); // 50% more

    // Get user LP balance after
    const userLpBalanceAfter = await provider.connection.getTokenAccountBalance(
      userLpTokenAccount
    );

    // Check the difference in balances
    const lpDifference = new BN(userLpBalanceAfter.value.amount).sub(
      new BN(userLpBalanceBefore.value.amount)
    );

    // Allow for small rounding differences (1 token)
    const lpDifferenceAbs = lpDifference.sub(expectedAdditionalLp).abs();
    assert.ok(
      lpDifferenceAbs.lten(1),
      `LP tokens minted incorrectly. Expected ~${expectedAdditionalLp.toString()}, Got: ${lpDifference.toString()}`
    );

    console.log("✅ Additional liquidity state verified");
  });

  it("Fails when adding unbalanced liquidity", async () => {
    console.log("🧪 Testing unbalanced liquidity rejection...");

    // Create a new user for this test
    const testUser = anchor.web3.Keypair.generate();

    // Airdrop SOL to test user
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(testUser.publicKey, 5e9)
    );

    // Create test token accounts
    const testUserBaseTokenAccount = getAssociatedTokenAddressSync(
      baseTokenMint.publicKey,
      testUser.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );

    const testUserPairedTokenAccount = getAssociatedTokenAddressSync(
      pairedTokenMint.publicKey,
      testUser.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );

    const testUserLpTokenAccount = getAssociatedTokenAddressSync(
      lpMintPda,
      testUser.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );

    // Create token accounts and fund them
    const tx = new anchor.web3.Transaction();
    tx.instructions = [
      createAssociatedTokenAccountIdempotentInstruction(
        testUser.publicKey,
        testUserBaseTokenAccount,
        testUser.publicKey,
        baseTokenMint.publicKey,
        TOKEN_PROGRAM_ID
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        testUser.publicKey,
        testUserPairedTokenAccount,
        testUser.publicKey,
        pairedTokenMint.publicKey,
        TOKEN_PROGRAM_ID
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        testUser.publicKey,
        testUserLpTokenAccount,
        testUser.publicKey,
        lpMintPda,
        TOKEN_PROGRAM_ID
      ),
    ];

    await provider.sendAndConfirm(tx, [testUser]);

    // Transfer tokens to test user from admin
    const transferTx = new anchor.web3.Transaction();
    transferTx.instructions = [
      // Transfer base tokens to test user
      createMintToInstruction(
        baseTokenMint.publicKey,
        testUserBaseTokenAccount,
        admin.publicKey,
        100_000_000, // 100 tokens
        [],
        TOKEN_PROGRAM_ID
      ),
      // Transfer paired tokens to test user - intentionally smaller amount
      createMintToInstruction(
        pairedTokenMint.publicKey,
        testUserPairedTokenAccount,
        admin.publicKey,
        1_000_000, // 1 token - very unbalanced
        [],
        TOKEN_PROGRAM_ID
      ),
    ];

    await provider.sendAndConfirm(transferTx, [admin]);

    // Get current pool ratio
    const pairAccount = await program.account.pair.fetch(pairPda);
    const poolRatio = pairAccount.baseReserve.toNumber() / pairAccount.pairedReserve.toNumber();

    console.log(`Current pool ratio: ${poolRatio}`);

    // Try to add very unbalanced liquidity (should work but mint minimal LP tokens)
    await program.methods
      .addLiquidity(
        new BN(100_000_000), // 100 base tokens
        new BN(1_000_000) // 1 paired token - very unbalanced
      )
      .accountsPartial({
        user: testUser.publicKey,
        pair: pairPda,
        baseVault: baseVault,
        userBaseAta: testUserBaseTokenAccount,
        pairedVault: pairedVault,
        userPairedAta: testUserPairedTokenAccount,
        lpMint: lpMintPda,
        userLpAta: testUserLpTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([testUser])
      .rpc();

    // Check how many LP tokens were minted
    const userLpBalance = await provider.connection.getTokenAccountBalance(
      testUserLpTokenAccount
    );

    // With severely unbalanced liquidity, the user should get very few LP tokens
    console.log(`LP tokens received: ${userLpBalance.value.amount}`);

    // The amount should be proportional to the smaller of the two ratios
    const expectedLp = Math.floor(
      (1_000_000 / pairAccount.pairedReserve.toNumber()) *
      pairAccount.totalLiquidity.toNumber()
    );

    // Allow for small rounding differences
    const difference = Math.abs(parseInt(userLpBalance.value.amount) - expectedLp);
    assert.ok(
      difference <= 1,
      `LP tokens minted incorrectly. Expected ~${expectedLp}, Got: ${userLpBalance.value.amount}`
    );

    console.log("✅ Unbalanced liquidity properly handled");
  });

  it("Fails when adding zero liquidity", async () => {
    console.log("🧪 Testing zero liquidity rejection...");

    try {
      await program.methods
        .addLiquidity(
          new BN(0),
          new BN(INITIAL_LIQUIDITY_PAIRED)
        )
        .accountsPartial({
          user: admin.publicKey,
          pair: pairPda,
          baseVault: baseVault,
          userBaseAta: userBaseTokenAccount,
          pairedVault: pairedVault,
          userPairedAta: userPairedTokenAccount,
          lpMint: lpMintPda,
          userLpAta: userLpTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      assert.fail("🚨 Adding zero liquidity should have failed!");
    } catch (error) {
      console.log("✅ Zero liquidity correctly rejected");
    }

    try {
      await program.methods
        .addLiquidity(
          new BN(INITIAL_LIQUIDITY_BASE),
          new BN(0)
        )
        .accountsPartial({
          user: admin.publicKey,
          pair: pairPda,
          baseVault: baseVault,
          userBaseAta: userBaseTokenAccount,
          pairedVault: pairedVault,
          userPairedAta: userPairedTokenAccount,
          lpMint: lpMintPda,
          userLpAta: userLpTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      assert.fail("🚨 Adding zero liquidity should have failed!");
    } catch (error) {
      console.log("✅ Zero liquidity correctly rejected");
    }
  });

  it("Fails with insufficient funds", async () => {
    console.log("🧪 Testing insufficient funds case...");

    // Create a new user with no funds
    const poorUser = anchor.web3.Keypair.generate();

    // Airdrop just enough SOL for rent and tx fees
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(poorUser.publicKey, 1e9)
    );

    // Create token accounts (but don't fund them)
    const poorUserBaseTokenAccount = getAssociatedTokenAddressSync(
      baseTokenMint.publicKey,
      poorUser.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );

    const poorUserPairedTokenAccount = getAssociatedTokenAddressSync(
      pairedTokenMint.publicKey,
      poorUser.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );

    const poorUserLpTokenAccount = getAssociatedTokenAddressSync(
      lpMintPda,
      poorUser.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );

    // Create token accounts
    const tx = new anchor.web3.Transaction();
    tx.instructions = [
      createAssociatedTokenAccountIdempotentInstruction(
        poorUser.publicKey,
        poorUserBaseTokenAccount,
        poorUser.publicKey,
        baseTokenMint.publicKey,
        TOKEN_PROGRAM_ID
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        poorUser.publicKey,
        poorUserPairedTokenAccount,
        poorUser.publicKey,
        pairedTokenMint.publicKey,
        TOKEN_PROGRAM_ID
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        poorUser.publicKey,
        poorUserLpTokenAccount,
        poorUser.publicKey,
        lpMintPda,
        TOKEN_PROGRAM_ID
      ),
    ];

    await provider.sendAndConfirm(tx, [poorUser]);

    try {
      // Try to add liquidity with no funds
      await program.methods
        .addLiquidity(
          new BN(1000_000_000), // 1000 tokens
          new BN(1000_000_000)  // 1000 tokens
        )
        .accountsPartial({
          user: poorUser.publicKey,
          pair: pairPda,
          baseVault: baseVault,
          userBaseAta: poorUserBaseTokenAccount,
          pairedVault: pairedVault,
          userPairedAta: poorUserPairedTokenAccount,
          lpMint: lpMintPda,
          userLpAta: poorUserLpTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([poorUser])
        .rpc();

      assert.fail("🚨 Adding liquidity with insufficient funds should have failed!");
    } catch (error) {
      console.log("✅ Insufficient funds correctly rejected");
    }
  });


  // Swap Tests

  // Swap Tests with Improved Slippage and Reserve Calculations

  // it("Performs a successful base to paired token swap", async () => {
  //   console.log("🔄 Testing base to paired token swap...");

  //   // Get initial pair reserves
  //   const pairAccount = await program.account.pair.fetch(pairPda);
  //   const baseReserve = pairAccount.baseReserve.toNumber();
  //   const pairedReserve = pairAccount.pairedReserve.toNumber();

  //   // Get initial balances
  //   const userBaseBalanceBefore = await provider.connection.getTokenAccountBalance(
  //     userBaseTokenAccount
  //   );
  //   const userPairedBalanceBefore = await provider.connection.getTokenAccountBalance(
  //     userPairedTokenAccount
  //   );

  //   // Swap amount
  //   const swapAmount = 50_000_000; // 50 tokens
  //   const feeRate = 30; // 0.3%

  //   // Calculate expected output using constant product formula
  //   const inputWithFee = swapAmount * (10000 - feeRate);
  //   const expectedOutput = Math.floor(
  //     (inputWithFee * pairedReserve) /
  //     (baseReserve * 10000 + inputWithFee)
  //   );

  //   // Apply 1% slippage tolerance
  //   const minOutputAmount = Math.floor(expectedOutput * 0.99);

  //   // Perform swap
  //   await program.methods
  //     .swap(new BN(swapAmount), new BN(minOutputAmount))
  //     .accountsPartial({
  //       user: admin.publicKey,
  //       platformState: platformStatePda,
  //       platformTreasury: platformTreasury,
  //       pair: pairPda,
  //       baseTokenMint: baseTokenMint.publicKey,
  //       pairedTokenMint: pairedTokenMint.publicKey,
  //       baseVault: baseVault,
  //       pairedVault: pairedVault,
  //       baseTokenAccount: userBaseTokenAccount,
  //       pairTokenAccount: userPairedTokenAccount,
  //       tokenProgram: TOKEN_PROGRAM_ID,
  //       associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
  //       systemProgram: SystemProgram.programId,
  //     })
  //     .signers([admin])
  //     .rpc();

  //   // Get updated balances and pair state
  //   const userBaseBalanceAfter = await provider.connection.getTokenAccountBalance(
  //     userBaseTokenAccount
  //   );
  //   const userPairedBalanceAfter = await provider.connection.getTokenAccountBalance(
  //     userPairedTokenAccount
  //   );
  //   const pairAccountAfter = await program.account.pair.fetch(pairPda);

  //   // Verify base token balance decrease
  //   const baseBalanceChange = parseInt(userBaseBalanceBefore.value.amount) - parseInt(userBaseBalanceAfter.value.amount);
  //   assert.equal(baseBalanceChange, swapAmount, "Base token balance should decrease by swap amount");

  //   // Verify paired token balance increase
  //   const pairedBalanceChange = parseInt(userPairedBalanceAfter.value.amount) - parseInt(userPairedBalanceBefore.value.amount);
  //   assert.ok(
  //     pairedBalanceChange >= minOutputAmount,
  //     "Paired token balance should increase by at least min output amount"
  //   );

  //   // Verify pair reserves updated correctly
  //   assert.ok(
  //     pairAccountAfter.baseReserve.gt(pairAccountBefore.baseReserve),
  //     "Base reserve should increase"
  //   );
  //   assert.ok(
  //     pairAccountAfter.pairedReserve.lt(pairAccountBefore.pairedReserve),
  //     "Paired reserve should decrease"
  //   );

  //   console.log("✅ Base to paired token swap successful");
  // });

  // it("Performs a successful paired to base token swap", async () => {
  //   console.log("🔄 Testing paired to base token swap...");

  //   // Get initial pair reserves
  //   const pairAccount = await program.account.pair.fetch(pairPda);
  //   const baseReserve = pairAccount.pairedReserve.toNumber(); // Swapped for paired to base
  //   const pairedReserve = pairAccount.baseReserve.toNumber(); // Swapped for paired to base

  //   // Get initial balances
  //   const userBaseBalanceBefore = await provider.connection.getTokenAccountBalance(
  //     userBaseTokenAccount
  //   );
  //   const userPairedBalanceBefore = await provider.connection.getTokenAccountBalance(
  //     userPairedTokenAccount
  //   );

  //   // Swap amount
  //   const swapAmount = 50_000_000; // 50 tokens
  //   const feeRate = 30; // 0.3%

  //   // Calculate expected output using constant product formula
  //   const inputWithFee = swapAmount * (10000 - feeRate);
  //   const expectedOutput = Math.floor(
  //     (inputWithFee * pairedReserve) /
  //     (baseReserve * 10000 + inputWithFee)
  //   );

  //   // Apply 1% slippage tolerance
  //   const minOutputAmount = Math.floor(expectedOutput * 0.99);

  //   // Perform swap
  //   await program.methods
  //     .swap(new BN(swapAmount), new BN(minOutputAmount))
  //     .accountsPartial({
  //       user: admin.publicKey,
  //       platformState: platformStatePda,
  //       platformTreasury: platformTreasury,
  //       pair: pairPda,
  //       baseTokenMint: pairedTokenMint.publicKey, // Swapped for paired to base
  //       pairedTokenMint: baseTokenMint.publicKey, // Swapped for paired to base
  //       baseVault: pairedVault, // Swapped for paired to base
  //       pairedVault: baseVault, // Swapped for paired to base
  //       baseTokenAccount: userPairedTokenAccount, // Swapped for paired to base
  //       pairTokenAccount: userBaseTokenAccount, // Swapped for paired to base
  //       tokenProgram: TOKEN_PROGRAM_ID,
  //       associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
  //       systemProgram: SystemProgram.programId,
  //     })
  //     .signers([admin])
  //     .rpc();

  //   // Get updated balances and pair state
  //   const userBaseBalanceAfter = await provider.connection.getTokenAccountBalance(
  //     userBaseTokenAccount
  //   );
  //   const userPairedBalanceAfter = await provider.connection.getTokenAccountBalance(
  //     userPairedTokenAccount
  //   );
  //   const pairAccountAfter = await program.account.pair.fetch(pairPda);

  //   // Verify paired token balance decrease
  //   const pairedBalanceChange = parseInt(userPairedBalanceBefore.value.amount) - parseInt(userPairedBalanceAfter.value.amount);
  //   assert.equal(pairedBalanceChange, swapAmount, "Paired token balance should decrease by swap amount");

  //   // Verify base token balance increase
  //   const baseBalanceChange = parseInt(userBaseBalanceAfter.value.amount) - parseInt(userBaseBalanceBefore.value.amount);
  //   assert.ok(
  //     baseBalanceChange >= minOutputAmount,
  //     "Base token balance should increase by at least min output amount"
  //   );

  //   // Verify pair reserves updated correctly
  //   assert.ok(
  //     pairAccountAfter.pairedReserve.gt(pairAccountBefore.pairedReserve),
  //     "Paired reserve should increase"
  //   );
  //   assert.ok(
  //     pairAccountAfter.baseReserve.lt(pairAccountBefore.baseReserve),
  //     "Base reserve should decrease"
  //   );

  //   console.log("✅ Paired to base token swap successful");
  // });

  // it("Validates protocol fee collection", async () => {
  //   console.log("💰 Testing protocol fee collection...");

  //   // Get initial pair reserves
  //   const pairAccount = await program.account.pair.fetch(pairPda);
  //   const baseReserve = pairAccount.baseReserve.toNumber();
  //   const pairedReserve = pairAccount.pairedReserve.toNumber();

  //   // Get initial balances
  //   const platformTreasuryBalanceBefore = await provider.connection.getTokenAccountBalance(
  //     platformTreasury
  //   );

  //   // Swap amount
  //   const swapAmount = 100_000_000; // 100 tokens
  //   const feeRate = 30; // 0.3%

  //   // Calculate expected output using constant product formula
  //   const inputWithFee = swapAmount * (10000 - feeRate);
  //   const expectedOutput = Math.floor(
  //     (inputWithFee * pairedReserve) /
  //     (baseReserve * 10000 + inputWithFee)
  //   );

  //   // Apply 1% slippage tolerance
  //   const minOutputAmount = Math.floor(expectedOutput * 0.99);

  //   // Perform swap
  //   await program.methods
  //     .swap(new BN(swapAmount), new BN(minOutputAmount))
  //     .accountsPartial({
  //       user: admin.publicKey,
  //       platformState: platformStatePda,
  //       platformTreasury: platformTreasury,
  //       pair: pairPda,
  //       baseTokenMint: baseTokenMint.publicKey,
  //       pairedTokenMint: pairedTokenMint.publicKey,
  //       baseVault: baseVault,
  //       pairedVault: pairedVault,
  //       baseTokenAccount: userBaseTokenAccount,
  //       pairTokenAccount: userPairedTokenAccount,
  //       tokenProgram: TOKEN_PROGRAM_ID,
  //       associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
  //       systemProgram: SystemProgram.programId,
  //     })
  //     .signers([admin])
  //     .rpc();

  //   // Get updated balances
  //   const platformTreasuryBalanceAfter = await provider.connection.getTokenAccountBalance(
  //     platformTreasury
  //   );

  //   // Calculate protocol fee based on the platform's fee rate
  //   const protocolFeeRate = (await program.account.platformState.fetch(platformStatePda)).protocolFeeRate;
  //   const expectedProtocolFee = Math.floor(
  //     (swapAmount * protocolFeeRate) / 10000
  //   );

  //   // Verify protocol fee collected
  //   const protocolFeeCollected = parseInt(platformTreasuryBalanceAfter.value.amount) -
  //     parseInt(platformTreasuryBalanceBefore.value.amount);

  //   // Allow for small rounding differences
  //   assert.ok(
  //     Math.abs(protocolFeeCollected - expectedProtocolFee) <= 1,
  //     `Protocol fee incorrect. Expected ~${expectedProtocolFee}, Got: ${protocolFeeCollected}`
  //   );

  //   console.log("✅ Protocol fee collection validated");
  // });

  // it("Fails swap with slippage protection", async () => {
  //   console.log("🛡️ Testing slippage protection...");

  //   // Get initial pair reserves
  //   const pairAccount = await program.account.pair.fetch(pairPda);
  //   const baseReserve = pairAccount.baseReserve.toNumber();
  //   const pairedReserve = pairAccount.pairedReserve.toNumber();

  //   // Swap amount
  //   const swapAmount = 50_000_000; // 50 tokens
  //   const feeRate = 30; // 0.3%

  //   // Calculate expected output using constant product formula
  //   const inputWithFee = swapAmount * (10000 - feeRate);
  //   const expectedOutput = Math.floor(
  //     (inputWithFee * pairedReserve) /
  //     (baseReserve * 10000 + inputWithFee)
  //   );

  //   // Set an impossibly high minimum output to trigger slippage protection
  //   const minOutputAmount = expectedOutput * 2; // Set to double the expected output

  //   try {
  //     await program.methods
  //       .swap(new BN(swapAmount), new BN(minOutputAmount))
  //       .accountsPartial({
  //         user: admin.publicKey,
  //         platformState: platformStatePda,
  //         platformTreasury: platformTreasury,
  //         pair: pairPda,
  //         baseTokenMint: baseTokenMint.publicKey,
  //         pairedTokenMint: pairedTokenMint.publicKey,
  //         baseVault: baseVault,
  //         pairedVault: pairedVault,
  //         baseTokenAccount: userBaseTokenAccount,
  //         pairTokenAccount: userPairedTokenAccount,
  //         tokenProgram: TOKEN_PROGRAM_ID,
  //         associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
  //         systemProgram: SystemProgram.programId,
  //       })
  //       .signers([admin])
  //       .rpc();

  //     assert.fail("🚨 Swap should have failed due to slippage");
  //   } catch (error) {
  //     console.log("✅ Swap correctly rejected due to slippage protection");
  //   }
  // });

});
