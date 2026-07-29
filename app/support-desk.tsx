"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import type { Conversation, Message, SystemStatus } from "./types";

type Filter = "all" | "mine" | "unassigned" | "groups" | "resolved";

const filters: Array<{ id: Filter; label: string; mark: string }> = [
  { id: "all", label: "Tüm konuşmalar", mark: "◎" },
  { id: "mine", label: "Bana atanan", mark: "◉" },
  { id: "unassigned", label: "Atanmamış", mark: "◇" },
  { id: "groups", label: "Gruplar", mark: "#" },
  { id: "resolved", label: "Çözülenler", mark: "✓" },
];

function formatTime(value: string) {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat("tr-TR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase("tr-TR");
}

function attachmentLabel(message: Message) {
  const labels: Record<string, string> = {
    photo: "Fotoğraf",
    document: "Belge",
    video: "Video",
    audio: "Ses dosyası",
    voice: "Sesli mesaj",
    animation: "Animasyon",
    sticker: "Çıkartma",
    location: "Konum",
    contact: "Kişi",
    poll: "Anket",
  };
  return labels[message.contentType] || "Ek";
}

export function SupportDesk() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mobileListOpen, setMobileListOpen] = useState(true);

  const loadStatus = useCallback(async () => {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (response.status === 401) {
      setStatus(null);
      return false;
    }
    if (!response.ok) throw new Error("Bağlantı durumu alınamadı.");
    setStatus((await response.json()) as SystemStatus);
    return true;
  }, []);

  const loadConversations = useCallback(async () => {
    const response = await fetch("/api/conversations", { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as { conversations: Conversation[] };
    setConversations(data.conversations);
    setSelectedId((current) => current ?? data.conversations[0]?.id ?? null);
  }, []);

  const loadMessages = useCallback(async (conversationId: number) => {
    const response = await fetch(
      `/api/messages?conversation_id=${conversationId}`,
      { cache: "no-store" },
    );
    if (!response.ok) return;
    const data = (await response.json()) as { messages: Message[] };
    setMessages(data.messages);
  }, []);

  useEffect(() => {
    let active = true;
    const bootTimer = window.setTimeout(() => {
      Promise.all([loadStatus(), loadConversations()])
        .catch((cause) => active && setError(cause instanceof Error ? cause.message : "Bir hata oluştu."))
        .finally(() => active && setLoading(false));
    }, 0);
    const timer = window.setInterval(() => {
      void loadStatus();
      void loadConversations();
    }, 4000);
    return () => {
      active = false;
      window.clearTimeout(bootTimer);
      window.clearInterval(timer);
    };
  }, [loadConversations, loadStatus]);

  useEffect(() => {
    if (!selectedId) return;
    const initialTimer = window.setTimeout(() => void loadMessages(selectedId), 0);
    const timer = window.setInterval(() => void loadMessages(selectedId), 3000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [loadMessages, selectedId]);

  const selected = conversations.find((item) => item.id === selectedId) ?? null;
  const actor = status?.actor ?? null;

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("tr-TR");
    return conversations.filter((item) => {
      const matchesQuery =
        !needle ||
        item.title.toLocaleLowerCase("tr-TR").includes(needle) ||
        item.lastMessage.toLocaleLowerCase("tr-TR").includes(needle);
      if (!matchesQuery) return false;
      if (filter === "mine") return item.assignedToEmail === actor?.email;
      if (filter === "unassigned") return !item.assignedToEmail;
      if (filter === "groups") return item.type !== "private";
      if (filter === "resolved") return item.status === "resolved";
      return item.status !== "resolved";
    });
  }, [actor?.email, conversations, filter, query]);

  async function updateConversation(changes: {
    status?: Conversation["status"];
    assignedToEmail?: string | null;
    markRead?: boolean;
  }) {
    if (!selected) return;
    const response = await fetch("/api/conversations", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: selected.id, ...changes }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(data.error || "Konuşma güncellenemedi.");
    await loadConversations();
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!selected || !text || sending) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: selected.id, text }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Mesaj gönderilemedi.");
      setDraft("");
      await Promise.all([loadMessages(selected.id), loadConversations()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mesaj gönderilemedi.");
    } finally {
      setSending(false);
    }
  }

  async function configureWebhook() {
    setError(null);
    const response = await fetch("/api/telegram/configure", { method: "POST" });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(data.error || "Webhook etkinleştirilemedi.");
      return;
    }
    await loadStatus();
  }

  async function copyWebhook() {
    if (!status?.webhookUrl) return;
    await navigator.clipboard.writeText(status.webhookUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  if (loading) {
    return (
      <main className="app-loading" aria-live="polite">
        <div className="brand-mark">R</div>
        <p>RelayDesk hazırlanıyor…</p>
      </main>
    );
  }

  if (!status) {
    return (
      <main className="signin-shell">
        <section className="signin-card">
          <div className="brand-lockup"><span className="brand-mark">R</span><span>RelayDesk</span></div>
          <p className="eyebrow">GÜVENLİ DESTEK MERKEZİ</p>
          <h1>Telegram ekibiniz için tek, düzenli gelen kutusu.</h1>
          <p>Konuşmaları görmek ve yanıtlamak için yetkili hesabınızla giriş yapın.</p>
          <a className="primary-button" href="/signin-with-chatgpt?return_to=%2F">Güvenli giriş yap</a>
        </section>
      </main>
    );
  }

  return (
    <main className="desk-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">R</span>
          <span>RelayDesk</span>
          <span className="product-chip">TELEGRAM</span>
        </div>
        <div className="topbar-actions">
          <span className={`connection-pill ${status.connected ? "online" : "offline"}`}>
            <span className="status-dot" />
            {status.connected ? "Telegram bağlı" : status.configured ? "Bağlantı bekleniyor" : "Kurulum gerekli"}
          </span>
          <div className="agent-avatar" title={actor?.email}>{initials(actor?.displayName || "D")}</div>
        </div>
      </header>

      <div className="workspace">
        <aside className="nav-rail" aria-label="Gelen kutusu filtreleri">
          <div className="nav-heading">EKİP GELEN KUTUSU</div>
          {filters.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${filter === item.id ? "active" : ""}`}
              onClick={() => setFilter(item.id)}
            >
              <span className="nav-mark">{item.mark}</span>
              <span>{item.label}</span>
              {item.id === "all" && conversations.some((conversation) => conversation.unreadCount) ? (
                <span className="nav-count">
                  {conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0)}
                </span>
              ) : null}
            </button>
          ))}
          <div className="nav-spacer" />
          <div className="agent-card">
            <span className="agent-avatar small">{initials(actor?.displayName || "D")}</span>
            <div><strong>{actor?.displayName}</strong><span>Destek temsilcisi</span></div>
          </div>
        </aside>

        <section className={`conversation-pane ${mobileListOpen ? "mobile-open" : ""}`}>
          <div className="pane-heading">
            <div><p className="eyebrow">CANLI KUYRUK</p><h1>Konuşmalar</h1></div>
            <span className="queue-count">{filtered.length}</span>
          </div>
          <label className="search-box">
            <span>⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kişi, grup veya mesaj ara" />
          </label>

          <div className="conversation-list">
            {filtered.map((conversation) => (
              <button
                key={conversation.id}
                className={`conversation-card ${conversation.id === selectedId ? "selected" : ""}`}
                onClick={() => { setMessages([]); setSelectedId(conversation.id); setMobileListOpen(false); }}
              >
                <span className={`conversation-avatar type-${conversation.type}`}>
                  {conversation.type === "private" ? initials(conversation.title) : "#"}
                  <i className="platform-badge">↗</i>
                </span>
                <span className="conversation-copy">
                  <span className="conversation-title-row">
                    <strong>{conversation.title}</strong>
                    <time>{formatTime(conversation.lastMessageAt)}</time>
                  </span>
                  <span className="conversation-preview">{conversation.lastMessage}</span>
                  <span className="conversation-meta">
                    <i className={`priority-dot ${conversation.status}`} />
                    {conversation.assignedToEmail ? (conversation.assignedToEmail === actor?.email ? "Sende" : "Atanmış") : "Atanmamış"}
                    {conversation.type !== "private" ? <em>Grup</em> : null}
                  </span>
                </span>
                {conversation.unreadCount ? <span className="unread-badge">{conversation.unreadCount}</span> : null}
              </button>
            ))}
            {!filtered.length && status.connected ? (
              <div className="list-empty"><span>◎</span><strong>Bu görünümde konuşma yok</strong><p>Filtreyi değiştirin veya yeni mesajı bekleyin.</p></div>
            ) : null}
          </div>
        </section>

        <section className={`chat-pane ${mobileListOpen ? "mobile-hidden" : ""}`}>
          {!selected ? (
            <SetupPanel status={status} copied={copied} onCopy={copyWebhook} onConfigure={configureWebhook} />
          ) : (
            <>
              <header className="chat-header">
                <button className="mobile-back" onClick={() => setMobileListOpen(true)} aria-label="Konuşma listesine dön">‹</button>
                <span className={`conversation-avatar compact type-${selected.type}`}>{selected.type === "private" ? initials(selected.title) : "#"}</span>
                <div className="chat-heading"><strong>{selected.title}</strong><span>{selected.type === "private" ? "Özel sohbet" : "Telegram grubu"} · {status.connected ? "canlı" : "çevrimdışı"}</span></div>
                <button className="ghost-button" onClick={() => void updateConversation({ status: selected.status === "resolved" ? "open" : "resolved" })}>
                  {selected.status === "resolved" ? "Yeniden aç" : "Çözüldü"}
                </button>
              </header>

              <div className="message-stream" aria-live="polite">
                <div className="day-divider"><span>Bugün</span></div>
                {messages.map((message) => (
                  <article key={message.id} className={`message-row ${message.direction}`}>
                    <div className="message-bubble">
                      {message.direction === "inbound" && selected.type !== "private" ? <strong className="sender-name">{message.senderName}</strong> : null}
                      <MessageContent message={message} />
                      <span className="message-time">{message.isEdited ? "düzenlendi · " : ""}{formatTime(message.sentAt)}{message.direction === "outbound" ? "  ✓✓" : ""}</span>
                    </div>
                  </article>
                ))}
                {!messages.length ? <div className="messages-empty">Bu konuşmanın mesajları burada görünecek.</div> : null}
              </div>

              {error ? <div className="error-banner" role="alert">{error}<button onClick={() => setError(null)}>×</button></div> : null}
              <form className="composer" onSubmit={sendReply}>
                <div className="composer-input">
                  <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Yanıtınızı yazın…" rows={1} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
                  <span className="composer-hint">Enter gönderir · Shift + Enter yeni satır</span>
                </div>
                <button className="send-button" disabled={!draft.trim() || sending || !status.connected} aria-label="Mesaj gönder">{sending ? "…" : "↑"}</button>
              </form>
            </>
          )}
        </section>

        <aside className="details-pane">
          {selected ? (
            <>
              <div className="details-profile">
                <span className={`conversation-avatar large type-${selected.type}`}>{selected.type === "private" ? initials(selected.title) : "#"}</span>
                <h2>{selected.title}</h2>
                <p>{selected.username ? `@${selected.username}` : selected.type === "private" ? "Telegram müşterisi" : "Telegram grubu"}</p>
              </div>
              <section className="detail-section"><h3>Sorumlu</h3><button className="assignment-button" onClick={() => void updateConversation({ assignedToEmail: selected.assignedToEmail ? null : actor?.email })}><span className="agent-avatar tiny">{selected.assignedToEmail ? initials(actor?.displayName || "D") : "+"}</span><span>{selected.assignedToEmail ? "Bana atandı" : "Bana ata"}</span><b>⌄</b></button></section>
              <section className="detail-section"><h3>Durum</h3><div className="status-options">{(["open", "pending", "resolved"] as const).map((item) => <button key={item} className={selected.status === item ? "active" : ""} onClick={() => void updateConversation({ status: item })}>{item === "open" ? "Açık" : item === "pending" ? "Beklemede" : "Çözüldü"}</button>)}</div></section>
              <section className="detail-section facts"><h3>Konuşma bilgileri</h3><p><span>Kaynak</span><strong>Telegram</strong></p><p><span>Tür</span><strong>{selected.type === "private" ? "Özel sohbet" : "Grup"}</strong></p><p><span>Sohbet ID</span><strong>{selected.telegramChatId}</strong></p></section>
            </>
          ) : (
            <div className="details-placeholder"><span>R</span><p>Bir konuşma seçtiğinizde müşteri ve atama bilgileri burada görünür.</p></div>
          )}
        </aside>
      </div>
    </main>
  );
}

function MessageContent({ message }: { message: Message }) {
  if (message.isDeleted) return <p className="deleted-message">Bu mesaj silindi.</p>;
  if (message.contentType === "photo" && message.fileId) {
    return <div className="message-content"><Image unoptimized width={720} height={480} className="message-photo" src={`/api/telegram/file?file_id=${encodeURIComponent(message.fileId)}`} alt={message.text || "Telegram fotoğrafı"} />{message.text ? <p>{message.text}</p> : null}</div>;
  }
  if (message.contentType === "location") {
    return <a className="attachment-card" href={`https://www.google.com/maps?q=${encodeURIComponent(message.text)}`} target="_blank" rel="noreferrer"><span>⌖</span><div><strong>Konumu aç</strong><small>{message.text}</small></div></a>;
  }
  if (message.fileId) {
    return <div className="message-content"><a className="attachment-card" href={`/api/telegram/file?file_id=${encodeURIComponent(message.fileId)}`} target="_blank" rel="noreferrer"><span>↓</span><div><strong>{message.fileName || attachmentLabel(message)}</strong><small>{attachmentLabel(message)}</small></div></a>{message.text ? <p>{message.text}</p> : null}</div>;
  }
  return <p>{message.text || attachmentLabel(message)}</p>;
}

function SetupPanel({ status, copied, onCopy, onConfigure }: { status: SystemStatus; copied: boolean; onCopy: () => void; onConfigure: () => void }) {
  const isLocalPolling = status.deliveryMode === "polling";
  return (
    <div className="setup-wrap">
      <div className="setup-orbit"><span>R</span><i /><b /></div>
      <p className="eyebrow">BAĞLANTI MERKEZİ</p>
      <h1>{status.connected ? "Telegram bağlı. İlk mesajı bekliyoruz." : isLocalPolling ? "Yerel dinleyici hazır. İlk müşteri mesajını bekliyoruz." : "Telegram hesabınızı RelayDesk’e bağlayın."}</h1>
      <p className="setup-lead">Tek destek hesabınız çalışmaya devam eder; ekip üyeleri Telegram’a giriş yapmadan bu panelden yanıt verir.</p>
      <div className="setup-steps">
        <article className={status.configured ? "done" : "current"}><span>1</span><div><strong>Bot anahtarını ekleyin</strong><p>BotFather token’ı ve webhook gizli anahtarı sunucuya tanımlanır.</p></div><b>{status.configured ? "✓" : "01"}</b></article>
        <article className={isLocalPolling && status.configured ? "done" : status.connected ? "done" : status.configured ? "current" : ""}><span>2</span><div><strong>{isLocalPolling ? "Yerel mesaj dinleyicisini açık tutun" : "Webhook’u etkinleştirin"}</strong><p>{isLocalPolling ? "RelayDesk Telegram güncellemelerini long polling ile alır; Telegram Bağlantısı terminali açık kalmalıdır." : "Telegram yeni mesajları güvenli biçimde bu adrese gönderir."}</p>{!isLocalPolling ? <button className="webhook-copy" onClick={onCopy}>{copied ? "Kopyalandı" : status.webhookUrl}</button> : null}</div><b>{isLocalPolling && status.configured ? "✓" : status.connected ? "✓" : "02"}</b></article>
        <article className={status.connected ? "done" : isLocalPolling && status.configured ? "current" : ""}><span>3</span><div><strong>{isLocalPolling ? "İlk test mesajını gönderin" : "Hesaptan botu bağlayın"}</strong><p>{isLocalPolling ? "Başka bir Telegram hesabından destek hesabına yeni bir mesaj gönderin; sohbet otomatik olarak burada görünür." : "Telegram → Ayarlar → Telegram Business → Sohbet Botları bölümünden botu seçip yanıt yetkisini verin."}</p></div><b>{status.connected ? "✓" : "03"}</b></article>
      </div>
      {status.configured && !status.connected && !isLocalPolling ? <button className="primary-button setup-action" onClick={onConfigure}>Webhook’u etkinleştir</button> : null}
      {!status.configured ? <div className="setup-note">Token hiçbir zaman tarayıcıya gönderilmez; yalnızca güvenli sunucu değişkeninde tutulur.</div> : null}
      <div className="setup-note">Grup desteği için aynı botu gruplara ekleyin; tüm mesajları görmek için BotFather’da Group Privacy’yi kapatın veya botu yönetici yapın. Grup yanıtları bot adına gönderilir.</div>
    </div>
  );
}
