// LYR Sale Contract — sells LYR (Layer Runners' utility token) from a
// pre-funded vault balance held in this contract's own LYR jetton-wallet.
//
// DRAFT — not audited. Deploy and exercise on testnet first; mainnet only
// after a deliberate, separate go-ahead (see scripts/deploy.js's network
// guard). This contract custodies both a real jetton balance and
// whatever native TON/other-jetton revenue it accumulates from sales —
// treat any change here with the same care as a wallet contract.
//
// TWO WAYS TO BUY, TWO DIFFERENT MESSAGE SHAPES:
//  - TON: a buyer sends a plain internal message (empty body, or a
//    single text comment) with TON value attached. There's no TEP-74
//    notification for native TON, so this is read directly off the
//    incoming message in onInternalMessage — see buyWithTon.
//  - Approved jetton: a buyer sends `transfer` to THEIR OWN wallet for
//    that jetton, destination = this contract. That wallet credits
//    THIS CONTRACT's own wallet for that jetton (auto-deployed, same as
//    any jetton transfer), which then sends `transfer_notification` here
//    — see handleTransferNotification. The buyer's TON purchase and
//    their jetton purchase are therefore fundamentally different code
//    paths, not two branches of the same logic.
//    INTEGRATION FOOTGUN: per TEP-74, a jetton wallet only emits
//    transfer_notification at all if the buyer's `transfer` sets
//    forward_ton_amount > JETTON_OUT_FORWARD_VALUE. A buy-widget/wallet
//    integration that omits this doesn't error — the jettons just land
//    in this contract's wallet with no LYR ever paid out and no
//    rejection either (caught by a sandbox test that initially made
//    this exact mistake).
//
// WHY lyrMasterAddress+lyrWalletCode ARE STORED INSTEAD OF THE VAULT'S
// WALLET ADDRESS DIRECTLY: this contract's own address is a hash of its
// code+data, so its persistent data cannot contain a value that itself
// depends on knowing that address in advance (e.g. a precomputed vault
// wallet address baked into init data — get that precomputation wrong
// once and it's permanent). Instead the vault wallet address is derived
// on-chain every time via calculateJettonWalletAddress(contract.getAddress(),
// lyrMasterAddress, lyrWalletCode) — see saleLyrWalletAddress below. Same
// reasoning as amm-pool.tolk's poolWalletAddress().
//
// RATE MODEL: LYR and TON both use 9 decimals, so nanoLYR = nanoTON *
// lyrPerTon needs no decimal conversion. Jettons vary in decimals and
// market price, so each approved jetton's rate is admin-set as a raw
// (rateNumerator, rateDenominator) pair applied directly to its nano
// amount — the admin is responsible for picking a ratio that already
// accounts for that jetton's decimals and its current TON-equivalent
// value. There is no on-chain price oracle in v1 (see the "admin-set
// fixed rate" scope decision) — rates go stale if not kept updated.
//
// KNOWN LIMITATION: if the vault's LYR balance is too low to cover a
// purchase, the outgoing jetton transfer fails at the wallet level
// (insufficient balance) and bounces back here. This contract does not
// pre-check the vault balance (that would need an untrusted read of
// another contract's storage) and does not auto-refund the buyer's
// payment on that failure — the vault must be kept topped up. Admin
// should monitor the vault wallet's own get_wallet_data balance and top
// up before it runs low.

tolk 1.4.2

import "@stdlib/tvm-dicts"
import "./jetton-utils"

// ----------------------------------------------------------------
//  Op-codes — admin management. Distinct from jetton-utils' TEP-74
//  op-codes (transfer, internal_transfer, ...), which this contract
//  also receives (transfer_notification) but never emits itself for
//  these ops.
// ----------------------------------------------------------------
const OP_ADMIN_APPROVE_JETTON  : int = 0x4a1e9f10;
const OP_ADMIN_DISABLE_JETTON  : int = 0x5b2f0a21;
const OP_ADMIN_SET_TON_RATE    : int = 0x6c301b32;
const OP_ADMIN_SET_ADMIN       : int = 0x7d412c43;
const OP_ADMIN_SET_PAUSED      : int = 0x8e523d54;
const OP_ADMIN_WITHDRAW_TON    : int = 0x9f634e65;
const OP_ADMIN_WITHDRAW_JETTON : int = 0xa0745f76;

const ERR_PAUSED               : int = 462;
const ERR_NOT_APPROVED_JETTON  : int = 463;
const ERR_JETTON_DISABLED      : int = 464;
const ERR_ZERO_AMOUNT          : int = 465;

// Reference defaults, review before mainnet — see other contracts' similar constants.
const TON_PURCHASE_RESERVE : int = 100000000; // 0.1 TON: own gas + outgoing LYR transfer's forward value
const LYR_OUT_FORWARD_VALUE : int = 50000000; // 0.05 TON, attached to the outgoing LYR transfer message
const JETTON_OUT_FORWARD_VALUE : int = 50000000; // same, for jetton-purchase payouts
const WITHDRAW_FORWARD_VALUE : int = 50000000;

// ----------------------------------------------------------------
//  Storage
// ----------------------------------------------------------------
fun loadStorage(): (address, address, cell, int, int, dict) {
    var ds = contract.getData().beginParse();
    val adminAddress      = ds.loadAddress();
    val lyrMasterAddress  = ds.loadAddress();
    val lyrWalletCode      = ds.loadRef();
    val lyrPerTon            = ds.loadUint(32);
    val paused                = ds.loadUint(1);
    val approvedJettons       = ds.loadDict();
    return (adminAddress, lyrMasterAddress, lyrWalletCode, lyrPerTon, paused, approvedJettons);
}

fun saveStorage(adminAddress: address, lyrMasterAddress: address, lyrWalletCode: cell, lyrPerTon: int, paused: int, approvedJettons: dict) {
    contract.setData(
        beginCell()
            .storeAddress(adminAddress)
            .storeAddress(lyrMasterAddress)
            .storeRef(lyrWalletCode)
            .storeUint(lyrPerTon, 32)
            .storeUint(paused, 1)
            .storeDict(approvedJettons)
            .endCell()
    );
}

fun saleLyrWalletAddress(lyrMasterAddress: address, lyrWalletCode: cell): address {
    return calculateJettonWalletAddress(contract.getAddress(), lyrMasterAddress, lyrWalletCode);
}

fun jettonKey(walletAddress: address): slice {
    return beginCell().storeAddress(walletAddress).endCell().beginParse();
}

// ----------------------------------------------------------------
//  Shared jetton-transfer sender (pays LYR or an accumulated jetton out
//  of one of this contract's own wallets). mode=1: fees paid separately
//  from tonValue, not carried from the contract's whole balance.
// ----------------------------------------------------------------
fun sendJettonTransfer(walletAddress: address, recipient: address, amount: int, queryId: int, tonValue: int) {
    val transferBody = beginCell()
        .storeUint(OP_TRANSFER, 32)
        .storeUint(queryId, 64)
        .storeCoins(amount)
        .storeAddress(recipient)
        .storeAddress(recipient)
        .storeUint(0, 1)
        .storeCoins(0)
        .storeForwardPayload(beginCell().endCell())
        .endCell();

    sendRawMessage(
        beginCell()
            .storeUint(0x18, 6) // bounceable
            .storeAddress(walletAddress)
            .storeCoins(tonValue)
            .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1)
            .storeUint(1, 1)
            .storeRef(transferBody)
            .endCell(),
        1
    );
}

// ----------------------------------------------------------------
//  Buy with native TON. Triggered for empty-body messages and
//  single-text-comment messages only (see onInternalMessage) — anything
//  else with an unrecognized op fails closed rather than being read as
//  a purchase.
// ----------------------------------------------------------------
fun buyWithTon(buyer: address, msgValue: int) {
    val (adminAddress, lyrMasterAddress, lyrWalletCode, lyrPerTon, paused, approvedJettons) = loadStorage();
    assert(paused == 0, ERR_PAUSED);

    val netValue = msgValue - TON_PURCHASE_RESERVE;
    assert(netValue > 0, ERR_INSUFFICIENT_GAS);

    val lyrOut = netValue * lyrPerTon;
    assert(lyrOut > 0, ERR_ZERO_AMOUNT);

    sendJettonTransfer(saleLyrWalletAddress(lyrMasterAddress, lyrWalletCode), buyer, lyrOut, 0, LYR_OUT_FORWARD_VALUE);
}

// ----------------------------------------------------------------
//  Buy with an approved jetton. `sender` here is OUR OWN wallet for
//  that jetton (transfer_notification always arrives from the
//  recipient's own wallet), looked up directly in approvedJettons —
//  this is what proves the jetton is really the approved one, not a
//  same-named impostor.
// ----------------------------------------------------------------
fun handleTransferNotification(sender: address, msgValue: int, inMsgBody: slice) {
    val (adminAddress, lyrMasterAddress, lyrWalletCode, lyrPerTon, paused, approvedJettons) = loadStorage();
    assert(paused == 0, ERR_PAUSED);

    val queryId = inMsgBody.loadUint(64);
    val jettonAmount = inMsgBody.loadCoins();
    val fromAddress = inMsgBody.loadAddress();

    val (rateRef, found) = approvedJettons.sDictGetRef(267, jettonKey(sender));
    if (!found) {
        throw ERR_NOT_APPROVED_JETTON;
    }

    var rs = rateRef!.beginParse();
    val rateNumerator = rs.loadCoins();
    val rateDenominator = rs.loadCoins();
    val enabled = rs.loadUint(1);
    assert(enabled == 1, ERR_JETTON_DISABLED);

    assert(jettonAmount > 0, ERR_ZERO_AMOUNT);
    val lyrOut = jettonAmount * rateNumerator / rateDenominator;
    assert(lyrOut > 0, ERR_ZERO_AMOUNT);
    assert(msgValue > JETTON_OUT_FORWARD_VALUE, ERR_INSUFFICIENT_GAS);

    sendJettonTransfer(saleLyrWalletAddress(lyrMasterAddress, lyrWalletCode), fromAddress, lyrOut, queryId, JETTON_OUT_FORWARD_VALUE);
}

// ----------------------------------------------------------------
//  Admin ops. Every one requires sender == adminAddress.
// ----------------------------------------------------------------
fun handleApproveJetton(sender: address, inMsgBody: slice) {
    var (adminAddress, lyrMasterAddress, lyrWalletCode, lyrPerTon, paused, approvedJettons) = loadStorage();
    assert(sender.bitsEqual(adminAddress), ERR_NOT_ADMIN);

    val jettonMasterAddress = inMsgBody.loadAddress();
    val jettonWalletCode = inMsgBody.loadRef();
    val rateNumerator = inMsgBody.loadCoins();
    val rateDenominator = inMsgBody.loadCoins();
    assert(rateNumerator > 0, ERR_ZERO_AMOUNT);
    assert(rateDenominator > 0, ERR_ZERO_AMOUNT);

    // Computed on-chain from the jetton's own master + wallet code, not
    // trusted as an admin-supplied address — removes a class of
    // fat-fingered-address mistakes.
    val walletAddress = calculateJettonWalletAddress(contract.getAddress(), jettonMasterAddress, jettonWalletCode);

    val entry = beginCell()
        .storeCoins(rateNumerator)
        .storeCoins(rateDenominator)
        .storeUint(1, 1)
        .endCell();
    approvedJettons.sDictSetRef(267, jettonKey(walletAddress), entry);

    saveStorage(adminAddress, lyrMasterAddress, lyrWalletCode, lyrPerTon, paused, approvedJettons);
}

fun handleDisableJetton(sender: address, inMsgBody: slice) {
    var (adminAddress, lyrMasterAddress, lyrWalletCode, lyrPerTon, paused, approvedJettons) = loadStorage();
    assert(sender.bitsEqual(adminAddress), ERR_NOT_ADMIN);

    val walletAddress = inMsgBody.loadAddress();
    val (rateRef, found) = approvedJettons.sDictGetRef(267, jettonKey(walletAddress));
    if (!found) {
        throw ERR_NOT_APPROVED_JETTON;
    }

    var rs = rateRef!.beginParse();
    val rateNumerator = rs.loadCoins();
    val rateDenominator = rs.loadCoins();

    val entry = beginCell().storeCoins(rateNumerator).storeCoins(rateDenominator).storeUint(0, 1).endCell();
    approvedJettons.sDictSetRef(267, jettonKey(walletAddress), entry);

    saveStorage(adminAddress, lyrMasterAddress, lyrWalletCode, lyrPerTon, paused, approvedJettons);
}

fun handleSetTonRate(sender: address, inMsgBody: slice) {
    var (adminAddress, lyrMasterAddress, lyrWalletCode, lyrPerTon, paused, approvedJettons) = loadStorage();
    assert(sender.bitsEqual(adminAddress), ERR_NOT_ADMIN);

    val newRate = inMsgBody.loadUint(32);
    assert(newRate > 0, ERR_ZERO_AMOUNT);

    saveStorage(adminAddress, lyrMasterAddress, lyrWalletCode, newRate, paused, approvedJettons);
}

fun handleSetAdmin(sender: address, inMsgBody: slice) {
    var (adminAddress, lyrMasterAddress, lyrWalletCode, lyrPerTon, paused, approvedJettons) = loadStorage();
    assert(sender.bitsEqual(adminAddress), ERR_NOT_ADMIN);

    val newAdmin = inMsgBody.loadAddress();
    saveStorage(newAdmin, lyrMasterAddress, lyrWalletCode, lyrPerTon, paused, approvedJettons);
}

fun handleSetPaused(sender: address, inMsgBody: slice) {
    var (adminAddress, lyrMasterAddress, lyrWalletCode, lyrPerTon, paused, approvedJettons) = loadStorage();
    assert(sender.bitsEqual(adminAddress), ERR_NOT_ADMIN);

    val newPaused = inMsgBody.loadUint(1);
    saveStorage(adminAddress, lyrMasterAddress, lyrWalletCode, lyrPerTon, newPaused, approvedJettons);
}

// Sweep native TON revenue out to an admin-chosen address.
fun handleWithdrawTon(sender: address, inMsgBody: slice) {
    val (adminAddress, lyrMasterAddress, lyrWalletCode, lyrPerTon, paused, approvedJettons) = loadStorage();
    assert(sender.bitsEqual(adminAddress), ERR_NOT_ADMIN);

    val amount = inMsgBody.loadCoins();
    val to = inMsgBody.loadAddress();
    assert(amount > 0, ERR_ZERO_AMOUNT);

    sendRawMessage(
        beginCell()
            .storeUint(0x18, 6)
            .storeAddress(to)
            .storeCoins(amount)
            .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1 + 1)
            .endCell(),
        1
    );
}

// Sweep an accumulated jetton (e.g. approved-jetton sale proceeds, or the
// LYR vault itself) out of one of this contract's own wallets to an
// admin-chosen address.
fun handleWithdrawJetton(sender: address, inMsgBody: slice) {
    val (adminAddress, lyrMasterAddress, lyrWalletCode, lyrPerTon, paused, approvedJettons) = loadStorage();
    assert(sender.bitsEqual(adminAddress), ERR_NOT_ADMIN);

    val jettonWalletAddress = inMsgBody.loadAddress();
    val amount = inMsgBody.loadCoins();
    val to = inMsgBody.loadAddress();
    assert(amount > 0, ERR_ZERO_AMOUNT);

    sendJettonTransfer(jettonWalletAddress, to, amount, 0, WITHDRAW_FORWARD_VALUE);
}

// ----------------------------------------------------------------
//  Main entry point. Empty body or a single text comment (op 0) is
//  read as "buy LYR with the attached TON value" — anything else with
//  an op this contract doesn't recognize fails closed (ERR_INVALID_OP)
//  rather than being treated as a purchase.
// ----------------------------------------------------------------
fun onInternalMessage(myBalance: int, msgValue: int, inMsgFull: cell, inMsgBody: slice) {
    var msg = inMsgFull.beginParse();
    val flags = msg.loadUint(4);
    if ((flags & 1) != 0) {
        return; // bounced message — no pending state to reverse here, see module note
    }

    val sender = msg.loadAddress();

    if (inMsgBody.isEmpty()) {
        buyWithTon(sender, msgValue);
        return;
    }

    val op = inMsgBody.loadUint(32);

    if (op == 0) {
        buyWithTon(sender, msgValue);
    } else if (op == OP_TRANSFER_NOTIFICATION) {
        handleTransferNotification(sender, msgValue, inMsgBody);
    } else if (op == OP_ADMIN_APPROVE_JETTON) {
        handleApproveJetton(sender, inMsgBody);
    } else if (op == OP_ADMIN_DISABLE_JETTON) {
        handleDisableJetton(sender, inMsgBody);
    } else if (op == OP_ADMIN_SET_TON_RATE) {
        handleSetTonRate(sender, inMsgBody);
    } else if (op == OP_ADMIN_SET_ADMIN) {
        handleSetAdmin(sender, inMsgBody);
    } else if (op == OP_ADMIN_SET_PAUSED) {
        handleSetPaused(sender, inMsgBody);
    } else if (op == OP_ADMIN_WITHDRAW_TON) {
        handleWithdrawTon(sender, inMsgBody);
    } else if (op == OP_ADMIN_WITHDRAW_JETTON) {
        handleWithdrawJetton(sender, inMsgBody);
    } else {
        throw ERR_INVALID_OP;
    }
}

// ----------------------------------------------------------------
//  Get methods
// ----------------------------------------------------------------
get fun get_sale_data(): (address, address, address, int, int) {
    val (adminAddress, lyrMasterAddress, lyrWalletCode, lyrPerTon, paused, approvedJettons) = loadStorage();
    return (adminAddress, lyrMasterAddress, saleLyrWalletAddress(lyrMasterAddress, lyrWalletCode), lyrPerTon, paused);
}

get fun get_jetton_rate(jettonWalletAddress: address): (int, int, int, int) {
    val (adminAddress, lyrMasterAddress, lyrWalletCode, lyrPerTon, paused, approvedJettons) = loadStorage();
    val (rateRef, found) = approvedJettons.sDictGetRef(267, jettonKey(jettonWalletAddress));
    if (!found) {
        return (0, 0, 0, 0);
    }
    var rs = rateRef!.beginParse();
    val rateNumerator = rs.loadCoins();
    val rateDenominator = rs.loadCoins();
    val enabled = rs.loadUint(1);
    return (1, rateNumerator, rateDenominator, enabled);
}
