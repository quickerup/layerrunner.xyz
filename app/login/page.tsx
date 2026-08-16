"use client";

import { useEffect, useState } from "react";
import { WalletLogin } from "../../lib/components/wallet-login";

const BOT_USERNAME = "layerrunnersbot";

type SessionState =
  | { kind: "checking" }
  | { kind: "signed-in"; identity: string }
  | { kind: "signed-out" }
  | { kind: "error"; message: string };

export default function LoginPage() {
  const [state, setState] = useState<SessionState>({ kind: "checking" });

  useEffect(() => {
    checkSession();

    (window as any).onTelegramAuth = async (user: Record<string, unknown>) => {
      setState({ kind: "checking" });
      try {
        const response = await fetch("/auth/telegram/callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(user),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          setState({ kind: "error", message: body.error ?? "Login failed." });
          return;
        }
        await checkSession();
      } catch (error) {
        setState({ kind: "error", message: error instanceof Error ? error.message : "Login failed." });
      }
    };

    const container = document.getElementById("telegram-login-widget");
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", BOT_USERNAME);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    container?.appendChild(script);

    return () => {
      delete (window as any).onTelegramAuth;
    };
  }, []);

  async function checkSession() {
    try {
      const response = await fetch("/api/session");
      const body = await response.json();
      setState(body.ok ? { kind: "signed-in", identity: body.identity } : { kind: "signed-out" });
    } catch {
      setState({ kind: "signed-out" });
    }
  }

  async function handleLogout() {
    await fetch("/auth/logout", { method: "POST" });
    setState({ kind: "signed-out" });
  }

  return (
    <main className="site-shell">
      <section className="section">
        <p className="eyebrow">Web login</p>
        <h2>Sign in to Layer Runners</h2>
        <p>
          Telegram resolves to the exact same account as the bot — if you&apos;ve already used @{BOT_USERNAME}, your
          balance, profile, and linked wallet carry over immediately. GitHub, Google, and TON wallet sign-in each create
          separate web identities; repo access still requires the in-chat connect flow.
        </p>

        {state.kind === "signed-in" ? (
          <div className="buy-lyr-form">
            <p className="buy-lyr-status success">Signed in.</p>
            <button className="button primary" type="button" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        ) : (
          <div className="login-options">
            <a className="button primary" href="/auth/github">
              Continue with GitHub
            </a>
            <a className="button secondary" href="/auth/google">
              Continue with Google
            </a>
            <div className="login-divider">or connect a TON wallet</div>
            <WalletLogin onSignedIn={checkSession} />
            <div className="login-divider">or use your existing bot account</div>
            <div id="telegram-login-widget" />
          </div>
        )}

        {state.kind === "error" && <p className="buy-lyr-status error">{state.message}</p>}
      </section>
    </main>
  );
}
