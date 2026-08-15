"use client";

import { useEffect, useState } from "react";
import { useTonConnectUI, useTonWallet, TonConnectButton } from "@tonconnect/ui-react";
import { Address, beginCell } from "@ton/core";
import { SALE_CONTRACT_ADDRESS } from "../../lib/ton-config";

const OP_ADMIN_WITHDRAW_TON = 0x9f634e65;
const STORAGE_RESERVE_NANO = BigInt(100_000_000); // 0.1 TON, left behind to cover ongoing storage rent

export default function AdminCollectPage() {
  const wallet = useTonWallet();
  const [tonConnectUI] = useTonConnectUI();
  const [contractBalanceNano, setContractBalanceNano] = useState<bigint | null>(null);
  const [amountTon, setAmountTon] = useState("");
  const [destination, setDestination] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" | "sending" | "sent" | "error"; message?: string }>({
    kind: "idle",
  });

  useEffect(() => {
    if (wallet?.account.address) {
      setDestination(Address.parse(wallet.account.address).toString());
    }
  }, [wallet]);

  useEffect(() => {
    if (!SALE_CONTRACT_ADDRESS) return;
    let cancelled = false;

    async function loadBalance() {
      try {
        const res = await fetch(`https://toncenter.com/api/v3/accountStates?address=${SALE_CONTRACT_ADDRESS}`);
        const data = await res.json();
        const balance = data?.accounts?.[0]?.balance;
        if (!cancelled && balance) {
          setContractBalanceNano(BigInt(balance));
        }
      } catch {
        // best-effort -- withdrawal form still works without a displayed balance
      }
    }

    loadBalance();
    const interval = setInterval(loadBalance, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const withdrawableNano = contractBalanceNano !== null && contractBalanceNano > STORAGE_RESERVE_NANO
    ? contractBalanceNano - STORAGE_RESERVE_NANO
    : BigInt(0);

  const parsedAmount = Number(amountTon);
  const isValidAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const isValidDestination = (() => {
    try {
      if (!destination) return false;
      Address.parse(destination);
      return true;
    } catch {
      return false;
    }
  })();

  function useMax() {
    if (withdrawableNano > BigInt(0)) {
      setAmountTon((Number(withdrawableNano) / 1e9).toString());
    }
  }

  async function handleWithdraw() {
    if (!SALE_CONTRACT_ADDRESS || !isValidAmount || !isValidDestination) return;

    setStatus({ kind: "sending" });
    try {
      const amountNano = BigInt(Math.round(parsedAmount * 1e9));
      const body = beginCell()
        .storeUint(OP_ADMIN_WITHDRAW_TON, 32)
        .storeCoins(amountNano)
        .storeAddress(Address.parse(destination))
        .endCell();

      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [
          {
            address: SALE_CONTRACT_ADDRESS,
            amount: "50000000", // 0.05 TON to cover the withdrawal call's own gas
            payload: body.toBoc().toString("base64"),
          },
        ],
      });
      setStatus({ kind: "sent" });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Transaction was not sent." });
    }
  }

  return (
    <main className="site-shell">
      <section className="section">
        <p className="eyebrow">Admin — collect revenue</p>
        <h2>Withdraw accumulated TON</h2>
        <p>
          Every TON someone pays to buy LYR sits in the sale contract itself until withdrawn — it isn&apos;t
          forwarded anywhere automatically. Connect the contract&apos;s admin wallet to pull it out. Only the wallet
          that deployed the contract can do this; anyone else&apos;s transaction will simply fail on-chain.
        </p>

        <div className="buy-lyr-widget">
          <TonConnectButton />

          {!wallet ? (
            <p className="buy-lyr-note">Connect the admin wallet to continue.</p>
          ) : (
            <div className="buy-lyr-form">
              <p className="buy-lyr-estimate">
                Contract balance:{" "}
                {contractBalanceNano === null ? "loading…" : `${(Number(contractBalanceNano) / 1e9).toFixed(4)} TON`}
                <br />
                <small>
                  {withdrawableNano > BigInt(0)
                    ? `${(Number(withdrawableNano) / 1e9).toFixed(4)} TON withdrawable (0.1 TON kept for storage rent)`
                    : "Nothing withdrawable right now"}
                </small>
              </p>

              <label htmlFor="withdraw-amount">Amount (TON)</label>
              <input
                id="withdraw-amount"
                type="number"
                min="0"
                step="0.01"
                value={amountTon}
                onChange={(event) => setAmountTon(event.target.value)}
              />
              {withdrawableNano > BigInt(0) && (
                <button type="button" className="button secondary" onClick={useMax}>
                  Use max ({(Number(withdrawableNano) / 1e9).toFixed(4)} TON)
                </button>
              )}

              <label htmlFor="withdraw-destination">Send to</label>
              <input
                id="withdraw-destination"
                type="text"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
              />

              <button
                className="button primary"
                type="button"
                disabled={!isValidAmount || !isValidDestination || status.kind === "sending"}
                onClick={handleWithdraw}
              >
                {status.kind === "sending" ? "Waiting for wallet…" : "Withdraw"}
              </button>

              {status.kind === "sent" && <p className="buy-lyr-status success">Sent — check your wallet for confirmation.</p>}
              {status.kind === "error" && <p className="buy-lyr-status error">{status.message}</p>}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
