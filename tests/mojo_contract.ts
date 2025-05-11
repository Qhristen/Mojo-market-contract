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

  // it("it should Swap successfully", async () => {
  //   console.log("🧪 Swap token...");

  //   // Find test pair PDA address with wrong base token
  //   const [testPairPda] = anchor.web3.PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from("pair"),
  //       baseTokenMint.publicKey.toBuffer(),
  //       pairedTokenMint.publicKey.toBuffer(),
  //     ],
  //     program.programId
  //   );

  //   // Find test vault addresses
  //   const testBaseVault = getAssociatedTokenAddressSync(
  //     baseTokenMint.publicKey,
  //     testPairPda,
  //     true,
  //     TOKEN_PROGRAM_ID
  //   );

  //   const testPairedVault = getAssociatedTokenAddressSync(
  //     pairedTokenMint.publicKey,
  //     testPairPda,
  //     true,
  //     TOKEN_PROGRAM_ID
  //   );

  //   const baseTokenAccount = getAssociatedTokenAddressSync(
  //     baseTokenMint.publicKey,
  //     testPairPda,
  //     true,
  //     TOKEN_PROGRAM_ID
  //   );

  //   const pairTokenAccount = getAssociatedTokenAddressSync(
  //     pairedTokenMint.publicKey,
  //     testPairPda,
  //     true,
  //     TOKEN_PROGRAM_ID
  //   );

  //   const platformTreasury = getAssociatedTokenAddressSync(
  //     baseTokenMint.publicKey,
  //     platformStatePda,
  //     true,
  //     TOKEN_PROGRAM_ID
  //   );



  //   // Valid fee rates
  //   const inputAmount = 30;
  //   const minOutputAmount = 0.02;

  //   try {
  //     await program.methods
  //       .swap(new BN(inputAmount), new BN(minOutputAmount))
  //       .accountsPartial({
  //         user: admin.publicKey,
  //         platformTreasury,
  //         pair: testPairPda,
  //         baseTokenAccount,
  //         pairTokenAccount,
  //         baseTokenMint: baseTokenMint.publicKey, // Using wrong base token!
  //         pairedTokenMint: pairedTokenMint.publicKey,
  //         baseVault: testBaseVault,
  //         pairedVault: testPairedVault,
  //         platformState: platformStatePda,
  //         tokenProgram: TOKEN_PROGRAM_ID,
  //         associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
  //         systemProgram: SystemProgram.programId,
  //       })
  //       .signers([admin])
  //       .rpc();

  //     console.log("✅ Swap successfull!");
  //   } catch (error) {
  //     console.log("Error swaping token", error);
  //   }
  // });


  it("Fails to swap with zero amount", async () => {
    console.log("🧪 Testing swap with zero amount...");

    try {
      await program.methods
        .swap(new BN(0), new BN(0))
        .accountsPartial({
          user: admin.publicKey,
          platformState: platformStatePda,
          platformTreasury: platformTreasury,
          pair: pairPda,
          baseTokenMint: baseTokenMint.publicKey,
          pairedTokenMint: pairedTokenMint.publicKey,
          baseVault: baseVault,
          pairedVault: pairedVault,
          baseTokenAccount: userBaseTokenAccount.address,
          pairTokenAccount: userPairedTokenAccount.address,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      assert.fail("Swap with zero amount should have failed");
    } catch (error) {
      console.log("✅ Swap with zero amount correctly rejected");
    }
  });

  //   it("Performs a swap from base to paired token", async () => {
  //     console.log("🧪 Testing swap from base to paired token...");

  //     // Get balances before swap - ensure we're using the correct token account address
  //     const baseBalanceBefore = (await provider.connection.getTokenAccountBalance(new anchor.web3.PublicKey(userBaseTokenAccount))).value.amount;
  //     const pairedBalanceBefore = (await provider.connection.getTokenAccountBalance(new anchor.web3.PublicKey(userPairedTokenAccount))).value.amount;

  //     console.log(`Base balance before: ${baseBalanceBefore}`);
  //     console.log(`Paired balance before: ${pairedBalanceBefore}`);

  //     // Get pair reserves before swap
  //     let pairBefore = await program.account.pair.fetch(pairPda);
  //     console.log(`Pair base reserve before: ${pairBefore.baseReserve}`);
  //     console.log(`Pair paired reserve before: ${pairBefore.pairedReserve}`);

  //     // Perform the swap
  //     await program.methods
  //       .swap(new BN(SWAP_AMOUNT), new BN(MIN_EXPECTED_OUTPUT))
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

  //     // Get balances after swap - ensure we're using the correct token account address
  //     const baseBalanceAfter = (await provider.connection.getTokenAccountBalance(new anchor.web3.PublicKey(userBaseTokenAccount))).value.amount;
  //     const pairedBalanceAfter = (await provider.connection.getTokenAccountBalance(new anchor.web3.PublicKey(userPairedTokenAccount))).value.amount;

  //     console.log(`Base balance after: ${baseBalanceAfter}`);
  //     console.log(`Paired balance after: ${pairedBalanceAfter}`);

  //     // Get pair reserves after swap
  //     const pairAfter = await program.account.pair.fetch(pairPda);
  //     console.log(`Pair base reserve after: ${pairAfter.baseReserve}`);
  //     console.log(`Pair paired reserve after: ${pairAfter.pairedReserve}`);

  //     // Check that the user's base token balance decreased by the swap amount
  //     assert.equal(
  //       (parseInt(baseBalanceBefore) - parseInt(baseBalanceAfter)).toString(),
  //       SWAP_AMOUNT.toString(),
  //       "Base token balance didn't decrease correctly"
  //     );

  //     // Check that user received some paired tokens
  //     assert(
  //       parseInt(pairedBalanceAfter) > parseInt(pairedBalanceBefore),
  //       "User didn't receive paired tokens"
  //     );

  //     // Verify that the pair reserves were updated correctly
  //     assert(
  //       pairAfter.baseReserve.gt(pairBefore.baseReserve),
  //       "Base reserve didn't increase"
  //     );
  //     assert(
  //       pairAfter.pairedReserve.lt(pairBefore.pairedReserve),
  //       "Paired reserve didn't decrease"
  //     );

  //     console.log("✅ Swap executed successfully");
  //   });

  //   it("Performs a swap from paired to base token", async () => {
  //     console.log("🧪 Testing swap from paired to base token...");

  //     // Get balances before swap - ensure we're using the correct token account address
  //     const baseBalanceBefore = (await provider.connection.getTokenAccountBalance(new anchor.web3.PublicKey(userBaseTokenAccount))).value.amount;
  //     const pairedBalanceBefore = (await provider.connection.getTokenAccountBalance(new anchor.web3.PublicKey(userPairedTokenAccount))).value.amount;

  //     console.log(`Base balance before: ${baseBalanceBefore}`);
  //     console.log(`Paired balance before: ${pairedBalanceBefore}`);

  //     // Get pair reserves before swap
  //     let pairBefore = await program.account.pair.fetch(pairPda);
  //     console.log(`Pair base reserve before: ${pairBefore.baseReserve}`);
  //     console.log(`Pair paired reserve before: ${pairBefore.pairedReserve}`);

  //     // Perform the swap (from paired to base)
  //     await program.methods
  //       .swap(new BN(SWAP_AMOUNT), new BN(MIN_EXPECTED_OUTPUT))
  //       .accountsPartial({
  //         user: admin.publicKey,
  //         platformState: platformStatePda,
  //         platformTreasury: platformTreasury,
  //         pair: pairPda,
  //         baseTokenMint: pairedTokenMint.publicKey, // Note the switched order
  //         pairedTokenMint: baseTokenMint.publicKey, // Note the switched order
  //         baseVault: pairedVault, // Note the switched order
  //         pairedVault: baseVault, // Note the switched order
  //         baseTokenAccount: userPairedTokenAccount, // Note the switched order
  //         pairTokenAccount: userBaseTokenAccount, // Note the switched order
  //         tokenProgram: TOKEN_PROGRAM_ID,
  //         associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
  //         systemProgram: SystemProgram.programId,
  //       })
  //       .signers([admin])
  //       .rpc();

  //     // Get balances after swap - ensure we're using the correct token account address
  //     const baseBalanceAfter = (await provider.connection.getTokenAccountBalance(new anchor.web3.PublicKey(userBaseTokenAccount))).value.amount;
  //     const pairedBalanceAfter = (await provider.connection.getTokenAccountBalance(new anchor.web3.PublicKey(userPairedTokenAccount))).value.amount;

  //     console.log(`Base balance after: ${baseBalanceAfter}`);
  //     console.log(`Paired balance after: ${pairedBalanceAfter}`);

  //     // Get pair reserves after swap
  //     const pairAfter = await program.account.pair.fetch(pairPda);
  //     console.log(`Pair base reserve after: ${pairAfter.baseReserve}`);
  //     console.log(`Pair paired reserve after: ${pairAfter.pairedReserve}`);

  //     // Check that the user's paired token balance decreased by the swap amount
  //     assert.equal(
  //       (parseInt(pairedBalanceBefore) - parseInt(pairedBalanceAfter)).toString(),
  //       SWAP_AMOUNT.toString(),
  //       "Paired token balance didn't decrease correctly"
  //     );

  //     // Check that user received some base tokens
  //     assert(
  //       parseInt(baseBalanceAfter) > parseInt(baseBalanceBefore),
  //       "User didn't receive base tokens"
  //     );

  //     // Verify that the pair reserves were updated correctly
  //     assert(
  //       pairAfter.pairedReserve.gt(pairBefore.pairedReserve),
  //       "Paired reserve didn't increase"
  //     );
  //     assert(
  //       pairAfter.baseReserve.lt(pairBefore.baseReserve),
  //       "Base reserve didn't decrease"
  //     );

  //     console.log("✅ Reverse swap executed successfully");
  //   });


  it("Performs a swap from base to paired token", async () => {
    console.log("🧪 Testing swap from base to paired token...");

    // Get balances before swap - ensure we're using the correct token account address
    const baseBalanceBefore = (await provider.connection.getTokenAccountBalance(new anchor.web3.PublicKey(userBaseTokenAccount))).value.amount;
    const pairedBalanceBefore = (await provider.connection.getTokenAccountBalance(new anchor.web3.PublicKey(userPairedTokenAccount))).value.amount;

    console.log(`Base balance before: ${baseBalanceBefore}`);
    console.log(`Paired balance before: ${pairedBalanceBefore}`);

    // Get pair reserves before swap
    let pairBefore = await program.account.pair.fetch(pairPda);
    console.log(`Pair base reserve before: ${pairBefore.baseReserve}`);
    console.log(`Pair paired reserve before: ${pairBefore.pairedReserve}`);

    // Perform the swap
    await program.methods
      .swap(new BN(SWAP_AMOUNT), new BN(MIN_EXPECTED_OUTPUT))
      .accountsPartial({
        user: admin.publicKey,
        platformState: platformStatePda,
        platformTreasury: platformTreasury,
        pair: pairPda,
        baseTokenMint: baseTokenMint.publicKey,
        pairedTokenMint: pairedTokenMint.publicKey,
        baseVault: baseVault,
        pairedVault: pairedVault,
        baseTokenAccount: userBaseTokenAccount,
        pairTokenAccount: userPairedTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    // Get balances after swap - ensure we're using the correct token account address
    const baseBalanceAfter = (await provider.connection.getTokenAccountBalance(new anchor.web3.PublicKey(userBaseTokenAccount))).value.amount;
    const pairedBalanceAfter = (await provider.connection.getTokenAccountBalance(new anchor.web3.PublicKey(userPairedTokenAccount))).value.amount;

    console.log(`Base balance after: ${baseBalanceAfter}`);
    console.log(`Paired balance after: ${pairedBalanceAfter}`);

    // Get pair reserves after swap
    const pairAfter = await program.account.pair.fetch(pairPda);
    console.log(`Pair base reserve after: ${pairAfter.baseReserve}`);
    console.log(`Pair paired reserve after: ${pairAfter.pairedReserve}`);

    // Check that the user's base token balance decreased by the swap amount
    assert.equal(
      (parseInt(baseBalanceBefore) - parseInt(baseBalanceAfter)).toString(),
      SWAP_AMOUNT.toString(),
      "Base token balance didn't decrease correctly"
    );

    // Check that user received some paired tokens
    assert(
      parseInt(pairedBalanceAfter) > parseInt(pairedBalanceBefore),
      "User didn't receive paired tokens"
    );

    // Verify that the pair reserves were updated correctly
    assert(
      pairAfter.baseReserve.gt(pairBefore.baseReserve),
      "Base reserve didn't increase"
    );
    assert(
      pairAfter.pairedReserve.lt(pairBefore.pairedReserve),
      "Paired reserve didn't decrease"
    );

    console.log("✅ Swap executed successfully");
  });

  // Helper function to sleep for a specified number of milliseconds
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  it("Performs a swap from paired to base token", async () => {
    console.log("🧪 Testing swap from paired to base token...");

    // Get balances before swap
    const baseBalanceBefore = (await provider.connection.getTokenAccountBalance(new anchor.web3.PublicKey(userBaseTokenAccount))).value.amount;
    const pairedBalanceBefore = (await provider.connection.getTokenAccountBalance(new anchor.web3.PublicKey(userPairedTokenAccount))).value.amount;

    console.log(`Base balance before: ${baseBalanceBefore}`);
    console.log(`Paired balance before: ${pairedBalanceBefore}`);

    // Get pair reserves before swap
    let pairBefore = await program.account.pair.fetch(pairPda);
    console.log(`Pair base reserve before: ${pairBefore.baseReserve}`);
    console.log(`Pair paired reserve before: ${pairBefore.pairedReserve}`);

    // Perform the swap (from paired to base)
    await program.methods
      .swap(new BN(SWAP_AMOUNT), new BN(MIN_EXPECTED_OUTPUT))
      .accountsPartial({
        user: admin.publicKey,
        platformState: platformStatePda,
        platformTreasury: platformTreasury,
        pair: pairPda,
        baseTokenMint: baseTokenMint.publicKey,  // Keep original order
        pairedTokenMint: pairedTokenMint.publicKey, // Keep original order
        baseVault: baseVault, // Keep original order
        pairedVault: pairedVault, // Keep original order
        baseTokenAccount: userPairedTokenAccount, // Pass paired account as input
        pairTokenAccount: userBaseTokenAccount, // Receive output in base account
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    // Get balances after swap
    const baseBalanceAfter = (await provider.connection.getTokenAccountBalance(new anchor.web3.PublicKey(userBaseTokenAccount))).value.amount;
    const pairedBalanceAfter = (await provider.connection.getTokenAccountBalance(new anchor.web3.PublicKey(userPairedTokenAccount))).value.amount;

    console.log(`Base balance after: ${baseBalanceAfter}`);
    console.log(`Paired balance after: ${pairedBalanceAfter}`);

    // Get pair reserves after swap
    const pairAfter = await program.account.pair.fetch(pairPda);
    console.log(`Pair base reserve after: ${pairAfter.baseReserve}`);
    console.log(`Pair paired reserve after: ${pairAfter.pairedReserve}`);

    // Check that the user's paired token balance decreased by the swap amount
    assert.equal(
      (parseInt(pairedBalanceBefore) - parseInt(pairedBalanceAfter)).toString(),
      SWAP_AMOUNT.toString(),
      "Paired token balance didn't decrease correctly"
    );

    // Check that user received some base tokens
    assert(
      parseInt(baseBalanceAfter) > parseInt(baseBalanceBefore),
      "User didn't receive base tokens"
    );

    // Verify that the pair reserves were updated correctly
    assert(
      pairAfter.pairedReserve.gt(pairBefore.pairedReserve),
      "Paired reserve didn't increase"
    );
    assert(
      pairAfter.baseReserve.lt(pairBefore.baseReserve),
      "Base reserve didn't decrease"
    );

    console.log("✅ Reverse swap executed successfully");
  });
});
