"use client";

import { useEffect, useRef, useState } from "react";
import { TonConnectButton, useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";

type WalletLoginState =
  | { kind: "idle" }
  | { kind: "verifying" }
  | { kind: "error"; message: string };

/**
 * "Continue with wallet" -- TonConnect sign-in via ton_proof (see
 * src/core/ton-proof.ts for the server-side verification this pairs with).
 * Self-contained: fetches a fresh payload for the wallet to sign, verifies
 * the resulting proof server-side once connected, and calls `onSignedIn`
 * so the parent page can refresh its own session state, mirroring how
 * app/login/page.tsx's Telegram widget calls checkSession() after login.
 */
export function WalletLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const wallet = useTonWallet();
  const [tonConnectUI] = useTonConnectUI();
  const [state, setState] = useState<WalletLoginState>({ kind: "idle" });
  const verifiedForAddress = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/auth/ton/payload");
        const body = await response.json();
        if (!cancelled && body.ok) {
          tonConnectUI.setConnectRequestParameters({ state: "ready", value: { tonProof: body.payload } });
        }
      } catch {
        // Connecting still works without a fresh payload -- the callback
        // below will just reject the missing/stale proof, surfacing as a
        // normal sign-in error instead of a broken connect button.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tonConnectUI]);

  useEffect(() => {
    if (!wallet) {
      verifiedForAddress.current = null;
      return;
    }
    if (verifiedForAddress.current === wallet.account.address) return;

    const proofReply = wallet.connectItems?.tonProof;
    if (!proofReply || !("proof" in proofReply)) {
      setState({ kind: "error", message: "This wallet did not return a signed proof — try reconnecting." });
      return;
    }

    verifiedForAddress.current = wallet.account.address;
    setState({ kind: "verifying" });

    (async () => {
      try {
        const response = await fetch("/auth/ton/callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            proof: proofReply.proof,
            account: { address: wallet.account.address, publicKey: wallet.account.publicKey },
          }),
        });
        const body = await response.json();
        if (!response.ok || !body.ok) {
          setState({ kind: "error", message: body.error ?? "Could not verify wallet signature." });
          return;
        }
        setState({ kind: "idle" });
        onSignedIn();
      } catch (error) {
        setState({ kind: "error", message: error instanceof Error ? error.message : "Wallet sign-in failed." });
      }
    })();
  }, [wallet, onSignedIn]);

  return (
    <div className="wallet-login">
      <TonConnectButton />
      {state.kind === "verifying" && <p className="buy-lyr-note">Verifying wallet signature…</p>}
      {state.kind === "error" && <p className="buy-lyr-status error">{state.message}</p>}
    </div>
  );
}
