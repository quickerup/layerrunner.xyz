// TEST FIXTURE ONLY — not part of the Layer Runners product, never deploy
// this to any real network. A generic TEP-74 jetton (borrowed from a
// sibling project) used purely to stand in for "some approved jetton" and
// for a test-only LYR-equivalent in lyr-sale.tolk's sandbox tests. Real
// LYR is already a deployed mainnet jetton; this is not it.
//
// SODA Jetton Master — TEP-74 registry contract for the SODA token.
// Tracks total supply, holds TEP-64 metadata, and is the only address
// permitted to mint (until mint authority is revoked). Mint is hard-capped
// by an on-chain max_supply set at deploy time — minting past it is
// rejected regardless of admin/mintable state.
//
// DRAFT — not audited. See docs/CONTRACTS.md (Layer 1).
//
// TBD before mainnet (per docs/CONTRACTS.md and the whitepaper's Open
// Decisions Register): the actual maximum SODA supply NUMBER (the cap
// mechanism itself is implemented — see max_supply below), complete
// genesis allocation, and the final mint-authority termination mechanism.
// This draft implements a simple one-way revoke (mintable -> 0,
// permanent); the whitepaper leaves open whether mint authority should
// instead transfer to a timelocked contract rather than being revoked
// outright — that is a policy decision, not something this file should
// decide.

tolk 1.4.2

import "./jetton-utils"

// ----------------------------------------------------------------
//  Storage: total_supply, max_supply (fixed cap — whitepaper's "Fixed
//  max supply — no perpetual minting"), mintable(0/1), admin_address,
//  content (TEP-64 metadata cell), jetton_wallet_code (shared by every
//  wallet). max_supply is deliberately NOT part of get_jetton_data()'s
//  return shape — that get-method's 5-tuple is fixed by TEP-74; query
//  the cap separately via get_max_supply().
// ----------------------------------------------------------------
fun loadStorage(): (int, int, int, address, cell, cell) {
    var ds = contract.getData().beginParse();
    val totalSupply     = ds.loadCoins();
    val maxSupply        = ds.loadCoins();
    val mintable         = ds.loadUint(1);
    val adminAddress     = ds.loadAddress();
    val content           = ds.loadRef();
    val jettonWalletCode = ds.loadRef();
    return (totalSupply, maxSupply, mintable, adminAddress, content, jettonWalletCode);
}

fun saveStorage(totalSupply: int, maxSupply: int, mintable: int, adminAddress: address, content: cell, jettonWalletCode: cell) {
    contract.setData(
        beginCell()
            .storeCoins(totalSupply)
            .storeCoins(maxSupply)
            .storeUint(mintable, 1)
            .storeAddress(adminAddress)
            .storeRef(content)
            .storeRef(jettonWalletCode)
            .endCell()
    );
}

// ----------------------------------------------------------------
//  mint — project-specific (TEP-74 does not standardize minting).
//  Admin-only, and only while mintable = 1. Deploys the destination's
//  wallet (if it doesn't exist yet) and credits it via internal_transfer,
//  in one message, using the standard "init:Maybe present, stored as ref"
//  message encoding used by every jetton minter on TON.
// ----------------------------------------------------------------
fun handleMint(sender: address, msgValue: int, inMsgBody: slice) {
    var (totalSupply, maxSupply, mintable, adminAddress, content, jettonWalletCode) = loadStorage();
    assert(sender.bitsEqual(adminAddress), ERR_NOT_ADMIN);
    assert(mintable == 1, ERR_MINT_DISABLED);

    val queryId = inMsgBody.loadUint(64);
    val toAddress = inMsgBody.loadAddress();
    val jettonAmount = inMsgBody.loadCoins();
    val forwardTonAmount = inMsgBody.loadCoins();
    assert(jettonAmount > 0, ERR_INSUFFICIENT_FUNDS);
    assert(totalSupply + jettonAmount <= maxSupply, ERR_EXCEEDS_MAX_SUPPLY);

    val masterAddress = contract.getAddress();
    val walletData = calculateJettonWalletData(toAddress, masterAddress, jettonWalletCode);
    val walletAddress = calculateJettonWalletAddress(toAddress, masterAddress, jettonWalletCode);

    // StateInit cell: split_depth:none, special:none, code:present(ref), data:present(ref), library:none.
    val stateInitCell = beginCell()
        .storeUint(0, 2)
        .storeUint(1, 1)
        .storeRef(jettonWalletCode)
        .storeUint(1, 1)
        .storeRef(walletData)
        .storeUint(0, 1)
        .endCell();

    val internalTransferBody = beginCell()
        .storeUint(OP_INTERNAL_TRANSFER, 32)
        .storeUint(queryId, 64)
        .storeCoins(jettonAmount)
        .storeAddress(masterAddress) // from = master; there is no prior wallet, this mints from nothing
        .storeAddress(adminAddress) // response/excess recipient
        .storeCoins(forwardTonAmount)
        .storeForwardPayload(beginCell().endCell())
        .endCell();

    sendRawMessage(
        beginCell()
            .storeUint(0x18, 6) // bounceable — bounce restores totalSupply, see handleBounce
            .storeAddress(walletAddress)
            .storeCoins(0)
            .storeUint(0, 1 + 4 + 4 + 64 + 32) // extracurrency + ihr_fee + fwd_fee + created_lt/at
            .storeUint(1, 1) // init:Maybe = present
            .storeUint(1, 1) // init: Either = stored as ref
            .storeUint(1, 1) // body: Either = stored as ref
            .storeRef(stateInitCell)
            .storeRef(internalTransferBody)
            .endCell(),
        64 // carry the remaining value of the inbound admin message
    );

    totalSupply += jettonAmount;
    saveStorage(totalSupply, maxSupply, mintable, adminAddress, content, jettonWalletCode);
}

// ----------------------------------------------------------------
//  burn_notification#7bdd97de — from a genuine SODA wallet only,
//  verified by recomputing its deterministic address from the claimed
//  owner. Decreases total_supply.
// ----------------------------------------------------------------
fun handleBurnNotification(sender: address, inMsgBody: slice) {
    var (totalSupply, maxSupply, mintable, adminAddress, content, jettonWalletCode) = loadStorage();

    val queryId = inMsgBody.loadUint(64);
    val jettonAmount = inMsgBody.loadCoins();
    val fromAddress = inMsgBody.loadAddress();
    val responseDestination = inMsgBody.loadAddress();

    val expectedWallet = calculateJettonWalletAddress(fromAddress, contract.getAddress(), jettonWalletCode);
    assert(sender.bitsEqual(expectedWallet), ERR_NOT_VALID_SENDER);
    assert(totalSupply >= jettonAmount, ERR_INSUFFICIENT_FUNDS);

    totalSupply -= jettonAmount;
    saveStorage(totalSupply, maxSupply, mintable, adminAddress, content, jettonWalletCode);

    val excessesBody = beginCell()
        .storeUint(OP_EXCESSES, 32)
        .storeUint(queryId, 64)
        .endCell();

    sendRawMessage(
        beginCell()
            .storeUint(0x10, 6) // non-bounceable, informational only
            .storeAddress(responseDestination)
            .storeCoins(0)
            .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1)
            .storeUint(1, 1)
            .storeRef(excessesBody)
            .endCell(),
        64
    );
}

// ----------------------------------------------------------------
//  provide_wallet_address#2c76b973 / take_wallet_address#d1735400 —
//  standard TEP-74 address-discovery pair, open to anyone.
// ----------------------------------------------------------------
fun handleProvideWalletAddress(sender: address, inMsgBody: slice) {
    var (totalSupply, maxSupply, mintable, adminAddress, content, jettonWalletCode) = loadStorage();

    val queryId = inMsgBody.loadUint(64);
    val ownerAddress = inMsgBody.loadAddress();
    val includeAddress = inMsgBody.loadUint(1);

    val walletAddress = calculateJettonWalletAddress(ownerAddress, contract.getAddress(), jettonWalletCode);

    var responseBodyCell: cell;
    if (includeAddress == 1) {
        val ownerCell = beginCell().storeAddress(ownerAddress).endCell();
        responseBodyCell = beginCell()
            .storeUint(OP_TAKE_WALLET_ADDRESS, 32)
            .storeUint(queryId, 64)
            .storeAddress(walletAddress)
            .storeUint(1, 1)
            .storeRef(ownerCell)
            .endCell();
    } else {
        responseBodyCell = beginCell()
            .storeUint(OP_TAKE_WALLET_ADDRESS, 32)
            .storeUint(queryId, 64)
            .storeAddress(walletAddress)
            .storeUint(0, 1)
            .endCell();
    }

    sendRawMessage(
        beginCell()
            .storeUint(0x10, 6) // non-bounceable, informational only
            .storeAddress(sender)
            .storeCoins(0)
            .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1)
            .storeUint(1, 1)
            .storeRef(responseBodyCell)
            .endCell(),
        64
    );
}

// ----------------------------------------------------------------
//  Admin-only management ops (project-specific, not part of TEP-74).
// ----------------------------------------------------------------
fun handleSetAdmin(sender: address, inMsgBody: slice) {
    var (totalSupply, maxSupply, mintable, adminAddress, content, jettonWalletCode) = loadStorage();
    assert(sender.bitsEqual(adminAddress), ERR_NOT_ADMIN);

    val newAdmin = inMsgBody.loadAddress();
    saveStorage(totalSupply, maxSupply, mintable, newAdmin, content, jettonWalletCode);
}

fun handleRevokeMint(sender: address, inMsgBody: slice) {
    var (totalSupply, maxSupply, mintable, adminAddress, content, jettonWalletCode) = loadStorage();
    assert(sender.bitsEqual(adminAddress), ERR_NOT_ADMIN);

    saveStorage(totalSupply, maxSupply, 0, adminAddress, content, jettonWalletCode);
}

// ----------------------------------------------------------------
//  Bounce recovery for mint: if the wallet deploy/internal_transfer
//  bounces, restore total_supply so it never overstates real balances.
// ----------------------------------------------------------------
fun handleBounce(inMsgBody: slice) {
    inMsgBody.loadUint(32); // 0xFFFFFFFF bounce prefix
    val op = inMsgBody.loadUint(32);
    if (op == OP_INTERNAL_TRANSFER) {
        inMsgBody.loadUint(64); // queryId
        val amount = inMsgBody.loadCoins();
        var (totalSupply, maxSupply, mintable, adminAddress, content, jettonWalletCode) = loadStorage();
        totalSupply -= amount;
        saveStorage(totalSupply, maxSupply, mintable, adminAddress, content, jettonWalletCode);
    }
}

// ----------------------------------------------------------------
//  Main entry point
// ----------------------------------------------------------------
fun onInternalMessage(myBalance: int, msgValue: int, inMsgFull: cell, inMsgBody: slice) {
    if (inMsgBody.isEmpty()) { return; } // plain TON transfer / top-up

    var msg = inMsgFull.beginParse();
    val flags = msg.loadUint(4);
    if ((flags & 1) != 0) {
        handleBounce(inMsgBody);
        return;
    }

    val sender = msg.loadAddress();
    val op = inMsgBody.loadUint(32);

    if (op == OP_MINT) {
        handleMint(sender, msgValue, inMsgBody);
    } else if (op == OP_BURN_NOTIFICATION) {
        handleBurnNotification(sender, inMsgBody);
    } else if (op == OP_PROVIDE_WALLET_ADDRESS) {
        handleProvideWalletAddress(sender, inMsgBody);
    } else if (op == OP_SET_ADMIN) {
        handleSetAdmin(sender, inMsgBody);
    } else if (op == OP_REVOKE_MINT) {
        handleRevokeMint(sender, inMsgBody);
    } else {
        throw ERR_INVALID_OP;
    }
}

// ----------------------------------------------------------------
//  Get methods
// ----------------------------------------------------------------
get fun get_jetton_data(): (int, int, address, cell, cell) {
    val (totalSupply, maxSupply, mintable, adminAddress, content, jettonWalletCode) = loadStorage();
    return (totalSupply, mintable, adminAddress, content, jettonWalletCode);
}

get fun get_max_supply(): int {
    val (totalSupply, maxSupply, mintable, adminAddress, content, jettonWalletCode) = loadStorage();
    return maxSupply;
}

get fun get_wallet_address(ownerAddress: address): address {
    val (totalSupply, maxSupply, mintable, adminAddress, content, jettonWalletCode) = loadStorage();
    return calculateJettonWalletAddress(ownerAddress, contract.getAddress(), jettonWalletCode);
}
