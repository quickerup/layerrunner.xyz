/**
 * Shared TON constants for the website's wallet-connect surfaces (public
 * buy widget, admin deploy page). Kept separate from src/services/ton.ts,
 * which is the Cloudflare Worker/bot's server-side TON Center client —
 * this file is for the Next.js static site (client-side only).
 */

// Real, deployed mainnet LYR jetton master. Verified on-chain (see
// contracts/jetton-utils.tolk's comment on the wallet data layout this
// jetton actually uses).
export const LYR_MASTER_ADDRESS = "EQDOOW2oAIoqBdngirqRA757cFCJqpVGrP4sPDeWxSgPNuTA";

// Real LYR jetton-wallet code, fetched directly from a live LYR holder's
// account state (code_boc) via TonCenter — not assumed. Standard
// ton-blockchain/token-contract reference implementation.
export const LYR_WALLET_CODE_BOC =
  "te6ccgECEQEAAyMAART/APSkE/S88sgLAQIBYgIDAgLMBAUAG6D2BdqJofQB9IH0gahhAgHUBgcCASAICQDDCDHAJJfBOAB0NMDAXGwlRNfA/AM4PpA+kAx+gAxcdch+gAx+gAwc6m0AALTH4IQD4p+pVIgupUxNFnwCeCCEBeNRRlSILqWMUREA/AK4DWCEFlfB7y6k1nwC+BfBIQP8vCAAET6RDBwuvLhTYAIBIAoLAIPUAQa5D2omh9AH0gfSBqGAJpj8EIC8aijKkQXUEIPe7L7wndCVj5cWLpn5j9ABgJ0CgR5CgCfQEsZ4sA54tmZPaqQB8VA9M/+gD6QCHwAe1E0PoA+kD6QNQwUTahUirHBfLiwSjC//LiwlQ0QnBUIBNUFAPIUAT6AljPFgHPFszJIsjLARL0APQAywDJIPkAcHTIywLKB8v/ydAE+kD0BDH6ACDXScIA8uLEd4AYyMsFUAjPFnD6AhfLaxPMgMAgEgDQ4AnoIQF41FGcjLHxnLP1AH+gIizxZQBs8WJfoCUAPPFslQBcwjkXKRceJQCKgToIIJycOAoBS88uLFBMmAQPsAECPIUAT6AljPFgHPFszJ7VQC9ztRND6APpA+kDUMAjTP/oAUVGgBfpA+kBTW8cFVHNtcFQgE1QUA8hQBPoCWM8WAc8WzMkiyMsBEvQA9ADLAMn5AHB0yMsCygfL/8nQUA3HBRyx8uLDCvoAUaihggiYloBmtgihggiYloCgGKEnlxBJEDg3XwTjDSXXCwGAPEADXO1E0PoA+kD6QNQwB9M/+gD6QDBRUaFSSccF8uLBJ8L/8uLCBYIJMS0AoBa88uLDghB73ZfeyMsfFcs/UAP6AiLPFgHPFslxgBjIywUkzxZw+gLLaszJgED7AEATyFAE+gJYzxYBzxbMye1UgAHBSeaAYoYIQc2LQnMjLH1Iwyz9Y+gJQB88WUAfPFslxgBDIywUkzxZQBvoCFctqFMzJcfsAECQQIwB8wwAjwgCwjiGCENUydttwgBDIywVQCM8WUAT6AhbLahLLHxLLP8ly+wCTNWwh4gPIUAT6AljPFgHPFszJ7VQ=";

export const LYR_DECIMALS = 9;

/**
 * Live LYR sale contract, deployed via /admin-deploy. Verified on-chain
 * (code hash A1kOkEDmTHp7CGOpkKadDS8GsbKwXBWgkhPoRiICh9w=, matching the
 * locally compiled contracts/lyr-sale.tolk exactly) and confirmed via
 * get_sale_data: adminAddress is the deploying wallet, lyrMasterAddress
 * is the real LYR jetton master, lyrPerTon=100, paused=0.
 *
 * (TonCenter's address explorer mislabels this address's interfaces as
 * nft_auction_v1/nft_sale — that's a false positive from its heuristic
 * detector, not the real bytecode; the code hash match above is the
 * actual proof.)
 *
 * Vault wallet (fund this with real LYR before purchases can pay out):
 * EQDSPDwi7wBMd83OPGLaqaMDP-yH0LZPC453cqhi29_VpK0a
 */
export const SALE_CONTRACT_ADDRESS: string | null = "EQDcvHpDqQFe50_FS5dGurcgP4z5FpAREAzidFQNaKKJDnnZ";

export const DEFAULT_LYR_PER_TON = 100;
