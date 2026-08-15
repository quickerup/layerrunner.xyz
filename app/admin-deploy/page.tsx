"use client";

import { useMemo, useState } from "react";
import { useTonConnectUI, useTonWallet, TonConnectButton } from "@tonconnect/ui-react";
import { Address, Cell, beginCell, contractAddress } from "@ton/core";
import { LYR_MASTER_ADDRESS, LYR_WALLET_CODE_BOC, DEFAULT_LYR_PER_TON } from "../../lib/ton-config";
import lyrSaleBuild from "../../build/lyr-sale.boc.json";

const OP_ADMIN_SET_PAUSED = 0x8e523d54;

function buildStateInitCell(code: Cell, data: Cell): Cell {
  return beginCell()
    .storeUint(0, 2) // split_depth: none, special: none
    .storeUint(1, 1) // code: present
    .storeRef(code)
    .storeUint(1, 1) // data: present
    .storeRef(data)
    .storeUint(0, 1) // library: none
    .endCell();
}

export default function AdminDeployPage() {
  const wallet = useTonWallet();
  const [tonConnectUI] = useTonConnectUI();
  const [lyrPerTon, setLyrPerTon] = useState(String(DEFAULT_LYR_PER_TON));
  const [status, setStatus] = useState<{ kind: "idle" | "sending" | "sent" | "error"; message?: string }>({
    kind: "idle",
  });

  const saleCode = useMemo(() => Cell.fromBoc(Buffer.from(lyrSaleBuild.codeBoc, "base64"))[0], []);
  const lyrWalletCode = useMemo(() => Cell.fromBoc(Buffer.from(LYR_WALLET_CODE_BOC, "base64"))[0], []);

  const adminAddress = wallet?.account.address ? Address.parse(wallet.account.address) : null;
  const rateNum = Number(lyrPerTon);
  const isValidRate = Number.isInteger(rateNum) && rateNum > 0 && rateNum < 2 ** 32;

  const computed = useMemo(() => {
    if (!adminAddress || !isValidRate) return null;
    const dataCell = beginCell()
      .storeAddress(adminAddress)
      .storeAddress(Address.parse(LYR_MASTER_ADDRESS))
      .storeRef(lyrWalletCode)
      .storeUint(rateNum, 32)
      .storeUint(0, 1) // paused: false
      .storeDict(null)
      .endCell();
    const address = contractAddress(0, { code: saleCode, data: dataCell });
    const stateInit = buildStateInitCell(saleCode, dataCell);
    return { address, stateInit };
  }, [adminAddress, isValidRate, lyrWalletCode, rateNum, saleCode]);

  async function handleDeploy() {
    if (!computed) return;
    setStatus({ kind: "sending" });
    try {
      const deployBody = beginCell().storeUint(OP_ADMIN_SET_PAUSED, 32).storeUint(0, 1).endCell();
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [
          {
            address: computed.address.toString(),
            amount: "50000000", // 0.05 TON
            stateInit: computed.stateInit.toBoc().toString("base64"),
            payload: deployBody.toBoc().toString("base64"),
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
        <p className="eyebrow">Temporary — internal use</p>
        <h2>Deploy LYR sale contract</h2>
        <p>
          Connect the wallet that should own this contract as admin. Deploying sends the contract&apos;s init
          code+data and becomes its <code>adminAddress</code> — whoever signs this transaction is who ends up in
          control. This page has no other access control, so remove it (or at least unlink it) once the real deploy
          is done.
        </p>

        <div className="buy-lyr-widget">
          <TonConnectButton />

          {!wallet ? (
            <p className="buy-lyr-note">Connect a wallet to continue.</p>
          ) : (
            <div className="buy-lyr-form">
              <label htmlFor="lyr-per-ton">LYR per TON</label>
              <input
                id="lyr-per-ton"
                type="number"
                min="1"
                step="1"
                value={lyrPerTon}
                onChange={(event) => setLyrPerTon(event.target.value)}
              />

              {computed && (
                <p className="buy-lyr-estimate">
                  Contract address will be:
                  <br />
                  <small>{computed.address.toString()}</small>
                </p>
              )}

              <button className="button primary" type="button" disabled={!computed || status.kind === "sending"} onClick={handleDeploy}>
                {status.kind === "sending" ? "Waiting for wallet…" : "Deploy"}
              </button>

              {status.kind === "sent" && computed && (
                <p className="buy-lyr-status success">
                  Sent. Once confirmed on-chain, fund the vault (send LYR to this contract&apos;s address), then set{" "}
                  <code>SALE_CONTRACT_ADDRESS</code> in <code>lib/ton-config.ts</code> to:
                  <br />
                  <small>{computed.address.toString()}</small>
                </p>
              )}
              {status.kind === "error" && <p className="buy-lyr-status error">{status.message}</p>}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
