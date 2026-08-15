"use client";

import { useEffect, useRef, useState } from "react";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  pendingApproval?: { requestId: string; resolved?: "approved" | "rejected" };
}

type SessionState =
  | { kind: "checking" }
  | { kind: "signed-out" }
  | { kind: "signed-in"; balance: string };

export default function ChatPage() {
  const [session, setSession] = useState<SessionState>({ kind: "checking" });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    checkSession();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function checkSession() {
    try {
      const response = await fetch("/api/session");
      const body = await response.json();
      setSession(body.ok ? { kind: "signed-in", balance: body.balance } : { kind: "signed-out" });
    } catch {
      setSession({ kind: "signed-out" });
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    setMessages(prev => [...prev, { role: "user", text }]);
    setSending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = await response.json();

      if (!response.ok || !body.ok) {
        setMessages(prev => [...prev, { role: "assistant", text: body.error ?? "Something went wrong." }]);
        return;
      }

      setMessages(prev => [
        ...prev,
        { role: "assistant", text: body.text, pendingApproval: body.pendingApproval },
      ]);
      await refreshBalance();
    } catch {
      setMessages(prev => [...prev, { role: "assistant", text: "Something went wrong reaching the server." }]);
    } finally {
      setSending(false);
    }
  }

  async function refreshBalance() {
    try {
      const response = await fetch("/api/session");
      const body = await response.json();
      if (body.ok) setSession({ kind: "signed-in", balance: body.balance });
    } catch {
      // Balance display just stays stale; not worth surfacing an error for.
    }
  }

  async function respondToApproval(messageIndex: number, requestId: string, action: "approve" | "reject") {
    setSending(true);
    try {
      const response = await fetch("/api/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action }),
      });
      const body = await response.json();

      setMessages(prev => {
        const next = [...prev];
        const target = next[messageIndex];
        if (target?.pendingApproval) {
          next[messageIndex] = {
            ...target,
            pendingApproval: { ...target.pendingApproval, resolved: action === "approve" ? "approved" : "rejected" },
          };
        }
        next.push({ role: "assistant", text: body.text ?? body.error ?? "Something went wrong." });
        return next;
      });
      await refreshBalance();
    } catch {
      setMessages(prev => [...prev, { role: "assistant", text: "Something went wrong reaching the server." }]);
    } finally {
      setSending(false);
    }
  }

  if (session.kind === "signed-out") {
    return (
      <main className="site-shell">
        <section className="section">
          <p className="eyebrow">Web chat</p>
          <h2>Sign in to chat</h2>
          <p>You need to be signed in to use the web chat.</p>
          <a className="button primary" href="/login">Sign in with Telegram</a>
        </section>
      </main>
    );
  }

  return (
    <main className="site-shell">
      <section className="section">
        <p className="eyebrow">Web chat</p>
        <h2>Layer Runners</h2>
        {session.kind === "signed-in" && (
          <p className="buy-lyr-note">
            Balance: {session.balance} — <a href="/">buy more LYR</a>
          </p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", margin: "1rem 0" }}>
          {messages.length === 0 && (
            <p className="buy-lyr-note">
              Try: &quot;show production status&quot;, &quot;list GitHub repos&quot;, or &quot;deploy latest to staging&quot;.
            </p>
          )}
          {messages.map((message, index) => (
            <div key={index} style={{ alignSelf: message.role === "user" ? "flex-end" : "flex-start", maxWidth: "80%" }}>
              <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{message.text}</p>
              {message.pendingApproval && (
                <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
                  {message.pendingApproval.resolved ? (
                    <p className="buy-lyr-status success">{message.pendingApproval.resolved === "approved" ? "Approved." : "Rejected."}</p>
                  ) : (
                    <>
                      <button
                        className="button primary"
                        type="button"
                        disabled={sending}
                        onClick={() => respondToApproval(index, message.pendingApproval!.requestId, "approve")}
                      >
                        Approve
                      </button>
                      <button
                        className="button secondary"
                        type="button"
                        disabled={sending}
                        onClick={() => respondToApproval(index, message.pendingApproval!.requestId, "reject")}
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form
          className="buy-lyr-form"
          onSubmit={event => {
            event.preventDefault();
            sendMessage();
          }}
        >
          <label htmlFor="chat-input">Message</label>
          <input
            id="chat-input"
            type="text"
            value={input}
            onChange={event => setInput(event.target.value)}
            placeholder="Ask about your repo, CI, or deployments…"
            disabled={sending}
          />
          <button className="button primary" type="submit" disabled={sending || !input.trim()}>
            {sending ? "Working…" : "Send"}
          </button>
        </form>
      </section>
    </main>
  );
}
