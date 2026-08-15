// TEST FIXTURE ONLY — not part of the Layer Runners product, never deploy
// this to any real network. Paired with test-jetton-master.tolk.
//
// Jetton Wallet — TEP-74. One instance per holder, deployed by the
// jetton's Master (on mint) or by a sending wallet (on first transfer to a
// new owner). Holds that holder's balance only; all supply-level
// accounting lives on the master. Despite the filename, this contract is
// jetton-agnostic (it only ever reads jettonMasterAddress from its own
// storage, never hardcodes SODA) and this same compiled code is reused for
// every TEP-74 jetton in this codebase — SODA (soda-jetton-master.tolk)
// and LP pool shares (lp-jetton-master.tolk) both deploy wallets from this
// file. Kept as one file rather than duplicated per jetton type.
//
// DRAFT — not audited. See docs/CONTRACTS.md (Layer 1) and the whitepaper's
// bounce-handling security note this contract implements:
//
//   internal_transfer is sent bounceable (0x18), carrying the destination
//   wallet's StateInit so a transfer to a brand-new owner auto-deploys
//   their wallet rather than bouncing. If the destination still rejects
//   it (wrong sender, insufficient gas, etc.), the bounce lands back here
//   in onInternalMessage's bounced branch, which credits the balance
//   back. Without this, a failed internal_transfer would silently destroy
//   the sender's balance without the tokens arriving anywhere — the exact
//   bug class flagged in docs/CONTRACTS.md as "non-negotiable to get right
//   before testnet." burn sends the analogous bounceable burn_notification
//   to the master and is restored the same way if the master rejects it.

tolk 1.4.2

import "./jetton-utils"

// ----------------------------------------------------------------
//  Storage: balance, owner, master. Wallet code is identical across
//  every SODA wallet — read via contract.getCode() when needed, never
//  stored, so it can't drift from the deployed code.
// ----------------------------------------------------------------
fun loadStorage(): (int, address, address) {
    var ds = contract.getData().beginParse();
    val balance              = ds.loadCoins();
    val ownerAddress         = ds.loadAddress();
    val jettonMasterAddress  = ds.loadAddress();
    return (balance, ownerAddress, jettonMasterAddress);
}

fun saveStorage(balance: int, ownerAddress: address, jettonMasterAddress: address) {
    contract.setData(
        beginCell()
            .storeCoins(balance)
            .storeAddress(ownerAddress)
            .storeAddress(jettonMasterAddress)
            .endCell()
    );
}

// ----------------------------------------------------------------
//  transfer#0f8a7ea5 — owner-initiated. Sends internal_transfer to the
//  destination's wallet, carrying that wallet's StateInit (code + initial
//  data) so it auto-deploys on first receipt if it doesn't exist yet —
//  same "init:Maybe present, stored as ref" encoding the Master's mint
//  handler uses. A transfer to a brand-new owner (never minted to, never
//  transferred to before) now works, not just a top-up of an existing
//  wallet.
// ----------------------------------------------------------------
fun handleTransfer(sender: address, msgValue: int, inMsgBody: slice) {
    var (balance, ownerAddress, jettonMasterAddress) = loadStorage();
    assert(sender.bitsEqual(ownerAddress), ERR_NOT_OWNER);

    val queryId = inMsgBody.loadUint(64);
    val jettonAmount = inMsgBody.loadCoins();
    val destination = inMsgBody.loadAddress();
    val responseDestination = inMsgBody.loadAddress();
    val hasCustomPayload = inMsgBody.loadUint(1);
    if (hasCustomPayload == 1) {
        inMsgBody.loadRef(); // custom_payload: read and discarded in this draft
    }
    val forwardTonAmount = inMsgBody.loadCoins();
    val forwardPayload = inMsgBody.loadForwardPayload();

    assert(jettonAmount > 0, ERR_INSUFFICIENT_FUNDS);
    assert(balance >= jettonAmount, ERR_INSUFFICIENT_FUNDS);

    val fwdCount = forwardTonAmount > 0 ? 2 : 1;
    assert(msgValue > forwardTonAmount + fwdCount * GAS_CONSUMPTION, ERR_INSUFFICIENT_GAS);

    balance -= jettonAmount;
    saveStorage(balance, ownerAddress, jettonMasterAddress);

    val walletCode = contract.getCode();
    val destWalletData = calculateJettonWalletData(destination, jettonMasterAddress);
    val destWalletAddress = calculateJettonWalletAddress(destination, jettonMasterAddress, walletCode);

    // StateInit cell: split_depth:none, special:none, code:present(ref), data:present(ref), library:none.
    val stateInitCell = beginCell()
        .storeUint(0, 2)
        .storeUint(1, 1)
        .storeRef(walletCode)
        .storeUint(1, 1)
        .storeRef(destWalletData)
        .storeUint(0, 1)
        .endCell();

    val internalTransferBody = beginCell()
        .storeUint(OP_INTERNAL_TRANSFER, 32)
        .storeUint(queryId, 64)
        .storeCoins(jettonAmount)
        .storeAddress(ownerAddress)
        .storeAddress(responseDestination)
        .storeCoins(forwardTonAmount)
        .storeForwardPayload(forwardPayload)
        .endCell();

    sendRawMessage(
        beginCell()
            .storeUint(0x18, 6) // bounceable — see bounce-recovery note above
            .storeAddress(destWalletAddress)
            .storeCoins(0)
            .storeUint(0, 1 + 4 + 4 + 64 + 32) // extracurrency + ihr_fee + fwd_fee + created_lt/at
            .storeUint(1, 1) // init:Maybe = present
            .storeUint(1, 1) // init: Either = stored as ref
            .storeUint(1, 1) // body: Either = stored as ref
            .storeRef(stateInitCell)
            .storeRef(internalTransferBody)
            .endCell(),
        64 // carry the remaining value of the inbound message
    );
}

// ----------------------------------------------------------------
//  internal_transfer#178d4519 — from the Master (mint) or a sibling
//  wallet of the same jetton (verified by recomputing its deterministic
//  address from the claimed `from` address; only the Master or a
//  genuine sibling wallet can credit this wallet).
// ----------------------------------------------------------------
fun handleInternalTransfer(sender: address, msgValue: int, inMsgBody: slice) {
    var (balance, ownerAddress, jettonMasterAddress) = loadStorage();

    val queryId = inMsgBody.loadUint(64);
    val jettonAmount = inMsgBody.loadCoins();
    val fromAddress = inMsgBody.loadAddress();
    val responseAddress = inMsgBody.loadAddress();
    val forwardTonAmount = inMsgBody.loadCoins();
    val forwardPayload = inMsgBody.loadForwardPayload();

    val isFromMaster = sender.bitsEqual(jettonMasterAddress);
    val expectedSiblingWallet = calculateJettonWalletAddress(fromAddress, jettonMasterAddress, contract.getCode());
    val isFromSiblingWallet = sender.bitsEqual(expectedSiblingWallet);
    assert(isFromMaster || isFromSiblingWallet, ERR_NOT_VALID_SENDER);

    balance += jettonAmount;
    saveStorage(balance, ownerAddress, jettonMasterAddress);

    if (forwardTonAmount > 0) {
        val notificationBody = beginCell()
            .storeUint(OP_TRANSFER_NOTIFICATION, 32)
            .storeUint(queryId, 64)
            .storeCoins(jettonAmount)
            .storeAddress(fromAddress)
            .storeForwardPayload(forwardPayload)
            .endCell();

        sendRawMessage(
            beginCell()
                .storeUint(0x10, 6) // non-bounceable — must not re-enter wallet accounting on failure
                .storeAddress(ownerAddress)
                .storeCoins(forwardTonAmount)
                .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1)
                .storeUint(1, 1)
                .storeRef(notificationBody)
                .endCell(),
            1 // pay transfer fees separately, don't consume the forward amount
        );
    } else {
        // No notification requested: return any leftover value to the response
        // address as `excesses`, matching TEP-74. Simplification in this draft:
        // when forwardTonAmount > 0, leftover dust after notification is not
        // separately refunded and stays on this wallet's balance.
        val excessesBody = beginCell()
            .storeUint(OP_EXCESSES, 32)
            .storeUint(queryId, 64)
            .endCell();

        sendRawMessage(
            beginCell()
                .storeUint(0x10, 6)
                .storeAddress(responseAddress)
                .storeCoins(0)
                .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1)
                .storeUint(1, 1)
                .storeRef(excessesBody)
                .endCell(),
            64
        );
    }
}

// ----------------------------------------------------------------
//  burn#595f07bc — owner-initiated. Sends bounceable burn_notification
//  to the Master; if the Master rejects it, the bounce branch below
//  restores the balance (same reasoning as transfer's internal_transfer).
// ----------------------------------------------------------------
fun handleBurn(sender: address, msgValue: int, inMsgBody: slice) {
    var (balance, ownerAddress, jettonMasterAddress) = loadStorage();
    assert(sender.bitsEqual(ownerAddress), ERR_NOT_OWNER);

    val queryId = inMsgBody.loadUint(64);
    val jettonAmount = inMsgBody.loadCoins();
    val responseDestination = inMsgBody.loadAddress();
    val hasCustomPayload = inMsgBody.loadUint(1);
    if (hasCustomPayload == 1) {
        inMsgBody.loadRef(); // custom_payload: read and discarded in this draft
    }

    assert(jettonAmount > 0, ERR_INSUFFICIENT_FUNDS);
    assert(balance >= jettonAmount, ERR_INSUFFICIENT_FUNDS);
    assert(msgValue > GAS_CONSUMPTION, ERR_INSUFFICIENT_GAS);

    balance -= jettonAmount;
    saveStorage(balance, ownerAddress, jettonMasterAddress);

    val burnNotificationBody = beginCell()
        .storeUint(OP_BURN_NOTIFICATION, 32)
        .storeUint(queryId, 64)
        .storeCoins(jettonAmount)
        .storeAddress(ownerAddress)
        .storeAddress(responseDestination)
        .endCell();

    sendRawMessage(
        beginCell()
            .storeUint(0x18, 6) // bounceable — see bounce-recovery note above
            .storeAddress(jettonMasterAddress)
            .storeCoins(0)
            .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1)
            .storeUint(1, 1)
            .storeRef(burnNotificationBody)
            .endCell(),
        64
    );
}

// ----------------------------------------------------------------
//  Bounce recovery. A bounced message body is 0xFFFFFFFF followed by
//  the first 256 bits of the ORIGINAL outgoing body. Both
//  internal_transfer and burn_notification carry (op:32, queryId:64,
//  amount:coins) in that prefix, so a single code path recovers either.
// ----------------------------------------------------------------
fun handleBounce(inMsgBody: slice) {
    inMsgBody.loadUint(32); // 0xFFFFFFFF bounce prefix
    val op = inMsgBody.loadUint(32);
    if (op == OP_INTERNAL_TRANSFER || op == OP_BURN_NOTIFICATION) {
        inMsgBody.loadUint(64); // queryId
        val amount = inMsgBody.loadCoins();
        var (balance, ownerAddress, jettonMasterAddress) = loadStorage();
        balance += amount;
        saveStorage(balance, ownerAddress, jettonMasterAddress);
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

    if (op == OP_TRANSFER) {
        handleTransfer(sender, msgValue, inMsgBody);
    } else if (op == OP_INTERNAL_TRANSFER) {
        handleInternalTransfer(sender, msgValue, inMsgBody);
    } else if (op == OP_BURN) {
        handleBurn(sender, msgValue, inMsgBody);
    } else {
        throw ERR_INVALID_OP;
    }
}

// ----------------------------------------------------------------
//  Get methods
// ----------------------------------------------------------------
get fun get_wallet_data(): (int, address, address, cell) {
    val (balance, ownerAddress, jettonMasterAddress) = loadStorage();
    return (balance, ownerAddress, jettonMasterAddress, contract.getCode());
}
