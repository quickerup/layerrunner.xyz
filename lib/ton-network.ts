/**
 * Client-side TON network detection. TonConnect reports the connected
 * wallet's chain as CHAIN.MAINNET ("-239") or CHAIN.TESTNET ("-3") on
 * `wallet.account.chain` -- there is no separate manual toggle, the site
 * just follows whatever the connected wallet is actually on.
 */

export type TonNetwork = "mainnet" | "testnet";

const TESTNET_CHAIN_ID = "-3";

export function networkFromChain(chain: string | undefined): TonNetwork {
  return chain === TESTNET_CHAIN_ID ? "testnet" : "mainnet";
}

export function networkLabel(network: TonNetwork): string {
  return network === "testnet" ? "Testnet" : "Mainnet";
}
