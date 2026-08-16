"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import { Address, beginCell, Cell, contractAddress } from "@ton/core";
import { WalletLogin } from "../../lib/components/wallet-login";
import { networkFromChain, networkLabel, TonNetwork } from "../../lib/ton-network";

type CompileState =
  | { kind: "idle" }
  | { kind: "compiling" }
  | { kind: "ok"; codeBoc64: string; codeHashHex: string; fiftCode: string }
  | { kind: "error"; message: string };

type SessionState = { kind: "checking" } | { kind: "signed-in" } | { kind: "signed-out" };

type ActionStatus = { kind: "idle" | "sending" | "sent" | "error"; message?: string };

interface TrackedContract {
  address: string;
  network: TonNetwork;
  label: string;
  codeHash?: string;
  deployedAt: number;
}

const DEFAULT_SOURCE = `import "@stdlib/common"

fun onInternalMessage(msgValue: int, msgFull: cell, msgBody: slice) {
    // paste or write your Tolk contract here
}
`;

function parseStackLine(line: string): { type: string; value: string } {
  const idx = line.indexOf(":");
  const type = (idx === -1 ? "num" : line.slice(0, idx).trim().toLowerCase());
  const raw = (idx === -1 ? line : line.slice(idx + 1)).trim();
  if (type === "addr" || type === "address") {
    const cell = beginCell().storeAddress(Address.parse(raw)).endCell();
    return { type: "slice", value: cell.toBoc().toString("base64") };
  }
  if (type === "cell" || type === "slice") return { type, value: raw };
  return { type: "num", value: raw };
}

export default function ContractsPage() {
  const wallet = useTonWallet();
  const [tonConnectUI] = useTonConnectUI();
  const network = networkFromChain(wallet?.account.chain);

  const [session, setSession] = useState<SessionState>({ kind: "checking" });
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [compile, setCompile] = useState<CompileState>({ kind: "idle" });
  const [fixing, setFixing] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);

  const [tonAmount, setTonAmount] = useState("0.05");
  const [dataBocBase64, setDataBocBase64] = useState("");
  const [label, setLabel] = useState("");
  const [deployStatus, setDeployStatus] = useState<ActionStatus>({ kind: "idle" });

  const [contracts, setContracts] = useState<TrackedContract[]>([]);
  const [selected, setSelected] = useState("");

  const [methodName, setMethodName] = useState("");
  const [stackText, setStackText] = useState("");
  const [callState, setCallState] = useState<{ kind: "idle" | "calling" | "ok" | "error"; result?: unknown; message?: string }>({ kind: "idle" });

  const [interactTo, setInteractTo] = useState("");
  const [interactAmount, setInteractAmount] = useState("0.05");
  const [interactOp, setInteractOp] = useState("");
  const [interactComment, setInteractComment] = useState("");
  const [interactStatus, setInteractStatus] = useState<ActionStatus>({ kind: "idle" });

  const checkSession = useCallback(async () => {
    try {
      const response = await fetch("/api/session");
      const body = await response.json();
      setSession(body.ok ? { kind: "signed-in" } : { kind: "signed-out" });
    } catch {
      setSession({ kind: "signed-out" });
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const loadContracts = useCallback(async () => {
    try {
      const response = await fetch("/api/contracts");
      const body = await response.json();
      if (body.ok) setContracts(body.contracts ?? []);
    } catch {
      // tracked list is a convenience -- the rest of the page still works without it
    }
  }, []);

  useEffect(() => {
    if (session.kind === "signed-in") loadContracts();
  }, [session, loadContracts]);

  async function handleCompile(src: string) {
    setCompile({ kind: "compiling" });
    setFixError(null);
    try {
      const { runTolkCompiler } = await import("@ton/tolk-js");
      const entrypointFileName = "main.tolk";
      const result = await runTolkCompiler({
        entrypointFileName,
        fsReadCallback: (path: string) => {
          if (path === entrypointFileName) return src;
          throw new Error(
            `Cannot resolve "${path}" — Contract Studio compiles a single pasted file (stdlib imports are fine, other file imports are not).`
          );
        },
      });
      if (result.status === "error") {
        setCompile({ kind: "error", message: result.message });
        return;
      }
      setCompile({ kind: "ok", codeBoc64: result.codeBoc64, codeHashHex: result.codeHashHex, fiftCode: result.fiftCode });
    } catch (error) {
      setCompile({ kind: "error", message: error instanceof Error ? error.message : "Compile failed." });
    }
  }

  async function handleFix() {
    if (compile.kind !== "error") return;
    setFixing(true);
    setFixError(null);
    try {
      const response = await fetch("/api/contracts/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, error: compile.message }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        setFixError(body.error ?? "Could not get an AI fix.");
        return;
      }
      setSource(body.source);
      await handleCompile(body.source);
    } catch (error) {
      setFixError(error instanceof Error ? error.message : "Could not get an AI fix.");
    } finally {
      setFixing(false);
    }
  }

  const codeCell = useMemo(() => {
    if (compile.kind !== "ok") return null;
    try {
      return Cell.fromBoc(Buffer.from(compile.codeBoc64, "base64"))[0];
    } catch {
      return null;
    }
  }, [compile]);

  const dataCell = useMemo(() => {
    if (!dataBocBase64.trim()) return beginCell().endCell();
    try {
      return Cell.fromBoc(Buffer.from(dataBocBase64.trim(), "base64"))[0];
    } catch {
      return null;
    }
  }, [dataBocBase64]);

  const deployTarget = useMemo(() => {
    if (!codeCell || !dataCell) return null;
    const address = contractAddress(0, { code: codeCell, data: dataCell });
    const stateInit = beginCell()
      .storeUint(0, 2)
      .storeUint(1, 1)
      .storeRef(codeCell)
      .storeUint(1, 1)
      .storeRef(dataCell)
      .storeUint(0, 1)
      .endCell();
    return { address, stateInit };
  }, [codeCell, dataCell]);

  async function handleDeploy() {
    if (!deployTarget) return;
    const amountNum = Number(tonAmount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setDeployStatus({ kind: "error", message: "Enter a valid TON amount." });
      return;
    }
    setDeployStatus({ kind: "sending" });
    try {
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [
          {
            address: deployTarget.address.toString(),
            amount: String(Math.round(amountNum * 1_000_000_000)),
            stateInit: deployTarget.stateInit.toBoc().toString("base64"),
          },
        ],
      });
      setDeployStatus({ kind: "sent" });

      if (session.kind === "signed-in") {
        const response = await fetch("/api/contracts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: deployTarget.address.toString(),
            network,
            label: label.trim() || "Untitled contract",
            codeHash: compile.kind === "ok" ? compile.codeHashHex : undefined,
            deployedAt: Date.now(),
          }),
        });
        const body = await response.json();
        if (body.ok) setContracts(body.contracts ?? []);
      }
    } catch (error) {
      setDeployStatus({ kind: "error", message: error instanceof Error ? error.message : "Transaction was not sent." });
    }
  }

  async function handleCall() {
    if (!selected || !methodName.trim()) return;
    setCallState({ kind: "calling" });
    try {
      const stack = stackText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map(parseStackLine);
      const response = await fetch("/api/contracts/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: selected, network, method: methodName.trim(), stack }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        setCallState({ kind: "error", message: body.error ?? "Call failed." });
        return;
      }
      setCallState({ kind: "ok", result: body.result });
    } catch (error) {
      setCallState({ kind: "error", message: error instanceof Error ? error.message : "Call failed." });
    }
  }

  async function handleInteract() {
    const target = interactTo.trim() || selected;
    if (!target) {
      setInteractStatus({ kind: "error", message: "Choose a contract address to send to." });
      return;
    }
    const amountNum = Number(interactAmount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setInteractStatus({ kind: "error", message: "Enter a valid TON amount." });
      return;
    }
    setInteractStatus({ kind: "sending" });
    try {
      let payload: string | undefined;
      if (interactOp.trim() || interactComment.trim()) {
        let builder = beginCell();
        if (interactOp.trim()) {
          const op = Number(interactOp.trim());
          if (!Number.isFinite(op)) throw new Error("Op must be a number (decimal or 0x-prefixed hex).");
          builder = builder.storeUint(op >>> 0, 32);
        } else {
          builder = builder.storeUint(0, 32);
        }
        if (interactComment.trim()) builder = builder.storeStringTail(interactComment.trim());
        payload = builder.endCell().toBoc().toString("base64");
      }
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [{ address: target, amount: String(Math.round(amountNum * 1_000_000_000)), payload }],
      });
      setInteractStatus({ kind: "sent" });
    } catch (error) {
      setInteractStatus({ kind: "error", message: error instanceof Error ? error.message : "Transaction was not sent." });
    }
  }

  const signedIn = session.kind === "signed-in";

  return (
    <main className="site-shell">
      <section className="section">
        <p className="eyebrow">Contract Studio</p>
        <h2>Paste, compile, deploy, and test a Tolk contract</h2>
        <p>
          Connect a wallet to sign in and deploy — the network below always follows whichever chain your wallet is
          currently on. Compiling itself needs no sign-in.
        </p>

        <div className="buy-lyr-widget">
          <div className="wallet-status-row">
            <WalletLogin onSignedIn={checkSession} />
            {wallet && <span className="network-badge">{networkLabel(network)}</span>}
          </div>
          {!signedIn && session.kind !== "checking" && (
            <p className="buy-lyr-note">Sign in with your wallet to fix-with-AI, deploy, track, and call contracts.</p>
          )}
        </div>
      </section>

      <section className="section">
        <h3>1. Source</h3>
        <textarea
          className="code-editor"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          spellCheck={false}
          rows={16}
        />
        <div className="cta-row">
          <button className="button primary" type="button" disabled={compile.kind === "compiling"} onClick={() => handleCompile(source)}>
            {compile.kind === "compiling" ? "Compiling…" : "Compile"}
          </button>
          {compile.kind === "error" && signedIn && (
            <button className="button secondary" type="button" disabled={fixing} onClick={handleFix}>
              {fixing ? "Asking AI…" : "Fix with AI"}
            </button>
          )}
        </div>

        {compile.kind === "ok" && (
          <p className="buy-lyr-status success">
            Compiled. Code hash: <code>{compile.codeHashHex}</code>
          </p>
        )}
        {compile.kind === "error" && <p className="buy-lyr-status error">{compile.message}</p>}
        {fixError && <p className="buy-lyr-status error">{fixError}</p>}
      </section>

      {compile.kind === "ok" && (
        <section className="section">
          <h3>2. Deploy</h3>
          <p>
            Deploy sends the compiled code as this contract&apos;s init code. Initial storage defaults to an empty
            data cell — paste a base64 BOC below if your contract expects specific initial storage.
          </p>
          <div className="buy-lyr-form">
            <label htmlFor="deploy-amount">TON to send</label>
            <input id="deploy-amount" type="number" min="0" step="0.01" value={tonAmount} onChange={(e) => setTonAmount(e.target.value)} />

            <label htmlFor="deploy-data">Initial data (base64 BOC, optional)</label>
            <input id="deploy-data" type="text" value={dataBocBase64} onChange={(e) => setDataBocBase64(e.target.value)} placeholder="leave blank for an empty data cell" />

            <label htmlFor="deploy-label">Label (for tracking)</label>
            <input id="deploy-label" type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. my test contract" />

            {deployTarget ? (
              <p className="buy-lyr-estimate">
                Contract address will be:
                <br />
                <small>{deployTarget.address.toString()}</small>
              </p>
            ) : (
              <p className="buy-lyr-status error">Initial data BOC is invalid.</p>
            )}

            <button className="button primary" type="button" disabled={!deployTarget || !wallet || deployStatus.kind === "sending"} onClick={handleDeploy}>
              {deployStatus.kind === "sending" ? "Waiting for wallet…" : "Deploy"}
            </button>
            {deployStatus.kind === "sent" && <p className="buy-lyr-status success">Sent — check your wallet for confirmation.</p>}
            {deployStatus.kind === "error" && <p className="buy-lyr-status error">{deployStatus.message}</p>}
          </div>
        </section>
      )}

      {signedIn && (
        <section className="section">
          <h3>3. Tracked contracts</h3>
          {contracts.length === 0 ? (
            <p className="buy-lyr-note">Nothing tracked yet — deploy above, or track an existing address.</p>
          ) : (
            <ul className="contract-list">
              {contracts.map((c) => (
                <li key={`${c.network}:${c.address}`}>
                  <button
                    type="button"
                    className={c.address === selected ? "contract-list-item selected" : "contract-list-item"}
                    onClick={() => {
                      setSelected(c.address);
                      setInteractTo(c.address);
                    }}
                  >
                    <strong>{c.label}</strong>
                    <small>
                      {networkLabel(c.network)} · {c.address}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selected && (
            <>
              <div className="buy-lyr-form">
                <h4>Test (read a get-method)</h4>
                <label htmlFor="method-name">Method name</label>
                <input id="method-name" type="text" value={methodName} onChange={(e) => setMethodName(e.target.value)} placeholder="get_sale_data" />
                <label htmlFor="stack-input">Stack (one per line — num:123 / addr:EQ... / cell:&lt;base64&gt;)</label>
                <textarea id="stack-input" className="code-editor small" rows={4} value={stackText} onChange={(e) => setStackText(e.target.value)} />
                <button className="button secondary" type="button" disabled={!methodName.trim() || callState.kind === "calling"} onClick={handleCall}>
                  {callState.kind === "calling" ? "Calling…" : "Call"}
                </button>
                {callState.kind === "ok" && <pre className="code-editor small">{JSON.stringify(callState.result, null, 2)}</pre>}
                {callState.kind === "error" && <p className="buy-lyr-status error">{callState.message}</p>}
              </div>

              <div className="buy-lyr-form">
                <h4>Interact (send a wallet-signed message)</h4>
                <label htmlFor="interact-to">To</label>
                <input id="interact-to" type="text" value={interactTo} onChange={(e) => setInteractTo(e.target.value)} />
                <label htmlFor="interact-amount">TON amount</label>
                <input id="interact-amount" type="number" min="0" step="0.01" value={interactAmount} onChange={(e) => setInteractAmount(e.target.value)} />
                <label htmlFor="interact-op">Op (optional, decimal or 0x hex)</label>
                <input id="interact-op" type="text" value={interactOp} onChange={(e) => setInteractOp(e.target.value)} placeholder="0x12345678" />
                <label htmlFor="interact-comment">Comment (optional)</label>
                <input id="interact-comment" type="text" value={interactComment} onChange={(e) => setInteractComment(e.target.value)} />
                <button className="button primary" type="button" disabled={!wallet || interactStatus.kind === "sending"} onClick={handleInteract}>
                  {interactStatus.kind === "sending" ? "Waiting for wallet…" : "Send"}
                </button>
                {interactStatus.kind === "sent" && <p className="buy-lyr-status success">Sent — check your wallet for confirmation.</p>}
                {interactStatus.kind === "error" && <p className="buy-lyr-status error">{interactStatus.message}</p>}
              </div>
            </>
          )}
        </section>
      )}
    </main>
  );
}
