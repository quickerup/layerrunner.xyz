"use client";

import { useState } from "react";
import { TonConnectButton, useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import { DEFAULT_LYR_PER_TON, SALE_CONTRACT_ADDRESS, TON_PURCHASE_RESERVE_NANO } from "../ton-config";

const NANO_FACTOR = 1_000_000_000;

export function BuyLyrWidget() {
  const wallet = useTonWallet();
  const [tonConnectUI] = useTonConnectUI();
  const [tonAmount, setTonAmount] = useState("1");
  const [status, setStatus] = useState<{ kind: "idle" | "sending" | "sent" | "error"; message?: string }>({
    kind: "idle",
  });

  const parsedTon = Number(tonAmount);
  const isValidAmount = Number.isFinite(parsedTon) && parsedTon > 0;
  const estimatedLyr = isValidAmount ? parsedTon * DEFAULT_LYR_PER_TON : 0;

  async function handleBuy() {
    if (!SALE_CONTRACT_ADDRESS || !isValidAmount) return;

    setStatus({ kind: "sending" });
    try {
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [
          {
            address: SALE_CONTRACT_ADDRESS,
            // nanoTON, sent with an empty body -- this is exactly the
            // "buy LYR with TON" path in lyr-sale.tolk's onInternalMessage.
            // The contract subtracts TON_PURCHASE_RESERVE_NANO before
            // converting to LYR, so the reserve is added on top here --
            // netValue on-chain ends up equal to the buyer's chosen
            // amount, and they get the full advertised rate for it.
            amount: String(Math.round(parsedTon * NANO_FACTOR) + TON_PURCHASE_RESERVE_NANO),
          },
        ],
      });
      setStatus({ kind: "sent" });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Transaction was not sent." });
    }
  }

  return (
    <div className="buy-lyr-widget">
      <div className="buy-lyr-connect">
        <TonConnectButton />
      </div>

      {!SALE_CONTRACT_ADDRESS ? (
        <p className="buy-lyr-note">LYR sales open soon — the sale contract isn&apos;t live yet.</p>
      ) : !wallet ? (
        <p className="buy-lyr-note">Connect a TON wallet to buy LYR.</p>
      ) : (
        <div className="buy-lyr-form">
          <label htmlFor="ton-amount">LYR purchase amount (in TON)</label>
          <input
            id="ton-amount"
            type="number"
            min="0"
            step="0.1"
            value={tonAmount}
            onChange={(event) => setTonAmount(event.target.value)}
          />
          <p className="buy-lyr-estimate">
            ≈ {estimatedLyr.toLocaleString()} LYR at {DEFAULT_LYR_PER_TON} LYR / TON
            <br />
            <small>
              Your wallet will be asked to send {isValidAmount ? (parsedTon + TON_PURCHASE_RESERVE_NANO / NANO_FACTOR).toLocaleString() : "0"} TON
              total — {tonAmount || 0} TON converts to LYR, plus a fixed {TON_PURCHASE_RESERVE_NANO / NANO_FACTOR} TON network
              reserve the contract requires on top. Final rate is whatever the contract has set at the time your transaction lands.
            </small>
          </p>
          <button className="button primary" type="button" disabled={!isValidAmount || status.kind === "sending"} onClick={handleBuy}>
            {status.kind === "sending" ? "Waiting for wallet…" : "Buy LYR"}
          </button>
          {status.kind === "sent" && <p className="buy-lyr-status success">Sent — check your wallet for confirmation.</p>}
          {status.kind === "error" && <p className="buy-lyr-status error">{status.message}</p>}
        </div>
      )}
    </div>
  );
}
