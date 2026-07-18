import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { InboundMessage } from "../types.ts";

function contactLink(replyTo: string): string {
  return replyTo.includes("@")
    ? `mailto:${replyTo}`
    : `tel:${replyTo.replace(/[^+\d]/g, "")}`;
}

export function Messages() {
  const [messages, setMessages] = useState<InboundMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setMessages(await api<InboundMessage[]>("/api/dashboard/messages"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load messages");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => undefined); }, []);

  return <main className="content-page messages-page">
    <header><div><span className="eyebrow">Confidential inbox</span><h1>Messages</h1><p>Private outreach sent through your public MCP context. Message contents and sender contact details are available only to your authenticated owner session.</p></div><button onClick={() => load().catch(() => undefined)}>Refresh inbox</button></header>
    <section className="messages-section">
      <div className="section-heading"><div><h2>Received</h2><p>{messages.length} confidential {messages.length === 1 ? "message" : "messages"}, newest first.</p></div><span className="private-inbox-badge"><i />Owner only</span></div>
      {error && <div className="inbox-error" role="alert">{error}</div>}
      {loading ? <p className="empty-note">Loading messages…</p> : messages.length === 0 ? <div className="inbox-empty"><span aria-hidden="true">↙</span><h3>No messages yet</h3><p>When someone reaches out through the public MCP server, their message and loopback address will appear here.</p></div> : <div className="message-list">{messages.map((item) => <article key={item.id}>
        <header><a href={contactLink(item.reply_to)}>{item.reply_to}</a><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time></header>
        <p>{item.message}</p>
      </article>)}</div>}
    </section>
  </main>;
}
