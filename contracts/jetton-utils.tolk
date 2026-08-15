// Shared TEP-74 op-codes, error codes, and jetton-wallet address helpers
// used by both soda-jetton-master.tolk and soda-jetton-wallet.tolk.
//
// Op-codes below (transfer, internal_transfer, burn, ...) are the standard
// TEP-74 values used by every jetton on TON — not project-specific, do not
// change them. OP_MINT is project-specific (TEP-74 does not define minting).
//
// Simplifications in this draft, pending audit (see docs/CONTRACTS.md):
//  - forward_payload (TEP-74 `Either Cell ^Cell`) is always sent as a ref
//    (the bit is always 1). This is spec-valid on the wire but this
//    codebase never emits the inline-bits encoding.
//  - custom_payload (on transfer/burn) is read and discarded, not acted on.

tolk 1.4.2

// ----------------------------------------------------------------
//  TEP-74 op-codes
// ----------------------------------------------------------------
const OP_TRANSFER               : int = 0x0f8a7ea5;
const OP_TRANSFER_NOTIFICATION  : int = 0x7362d09c;
const OP_INTERNAL_TRANSFER      : int = 0x178d4519;
const OP_EXCESSES               : int = 0xd53276db;
const OP_BURN                   : int = 0x595f07bc;
const OP_BURN_NOTIFICATION      : int = 0x7bdd97de;
const OP_PROVIDE_WALLET_ADDRESS : int = 0x2c76b973;
const OP_TAKE_WALLET_ADDRESS    : int = 0xd1735400;

// Project-specific: TEP-74 does not standardize minting or admin transfer.
const OP_MINT        : int = 0x642b7d07;
const OP_SET_ADMIN    : int = 0x39702640;
const OP_REVOKE_MINT  : int = 0x5f8a0f2d;

// ----------------------------------------------------------------
//  Error codes
// ----------------------------------------------------------------
const ERR_NOT_OWNER          : int = 401;
const ERR_NOT_ADMIN          : int = 402;
const ERR_NOT_VALID_SENDER   : int = 404;
const ERR_INSUFFICIENT_FUNDS : int = 405;
const ERR_INSUFFICIENT_GAS   : int = 406;
const ERR_MINT_DISABLED      : int = 407;
const ERR_EXCEEDS_MAX_SUPPLY : int = 408;
const ERR_INVALID_OP         : int = 0xffff;

// ----------------------------------------------------------------
//  Standard reference-implementation gas reserves (ton-blockchain/token-contract).
//  These are widely-used defaults, not a final production spec — review before mainnet.
// ----------------------------------------------------------------
const MIN_TONS_FOR_STORAGE : int = 10000000; // 0.01 TON
const GAS_CONSUMPTION      : int = 15000000; // 0.015 TON

// ----------------------------------------------------------------
//  A jetton wallet is deployed at an address deterministically derived
//  from (code, initial data). Initial data always has balance = 0 — the
//  wallet's real-time balance is irrelevant to its address, which is
//  fixed forever at first deploy.
//
//  DATA LAYOUT — this is the ton-blockchain/token-contract reference
//  implementation's layout (balance, owner, jetton_master, and the
//  wallet's OWN code stored as a 4th field/ref), not this codebase's own
//  simpler 3-field layout (no code ref) that soda-jetton-wallet.tolk
//  uses for itself. TEP-74 standardizes the wire *messages*, not the
//  storage layout, so there's no universal formula here — this one was
//  chosen because it's what the actual jetton this contract deals with
//  (LYR, layerrunners.xyz) uses, verified directly against its live
//  on-chain wallet data (not assumed): a real LYR holder's wallet
//  address only reproduces correctly with this exact 4-field layout,
//  not the 3-field one. It's also the single most common layout among
//  real-world jettons generally (most projects deploy this reference
//  implementation or a close fork of it) — but a jetton using some
//  other custom layout would compute a wrong address here. That's a
//  safe failure mode for approveJetton (that jetton's purchases just
//  never match and never succeed — see lyr-sale.tolk's
//  ERR_NOT_APPROVED_JETTON path), not a fund-misdirection one — the
//  wrong-computed address is never itself the destination of value,
//  only a dict key that would fail to match the real wallet's actual
//  sender address.
// ----------------------------------------------------------------
fun calculateJettonWalletData(ownerAddress: address, jettonMasterAddress: address, jettonWalletCode: cell): cell {
    return beginCell()
        .storeCoins(0)
        .storeAddress(ownerAddress)
        .storeAddress(jettonMasterAddress)
        .storeRef(jettonWalletCode)
        .endCell();
}

fun calculateJettonWalletAddress(ownerAddress: address, jettonMasterAddress: address, jettonWalletCode: cell): address {
    val dataHash = StateInit.calcHashCodeData(jettonWalletCode, calculateJettonWalletData(ownerAddress, jettonMasterAddress, jettonWalletCode));
    return address.fromWorkchainAndHash(0, dataHash);
}

// ----------------------------------------------------------------
//  forward_payload per TEP-74 is `Either Cell ^Cell` — either the
//  remaining bits/refs of the current slice (bit 0), or a single ref
//  cell (bit 1). This codebase always WRITES the ref form; it reads
//  either form so it stays compatible with well-formed senders.
// ----------------------------------------------------------------
fun slice.loadForwardPayload(mutate self): cell {
    val isRef = self.loadUint(1);
    if (isRef == 1) {
        return self.loadRef();
    }
    return beginCell().storeSlice(self).endCell();
}

fun builder.storeForwardPayload(mutate self, payload: cell): self {
    return self.storeUint(1, 1).storeRef(payload);
}
