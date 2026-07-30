"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { MessageLog } from "./types";

type MessageLogResponse = {
  logs?: MessageLog[];
  total?: number;
  page?: number;
  pageSize?: number;
  retentionDays?: number;
  error?: string;
};

function formatLogTime(value: string): string {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(normalized));
}

function initials(value: string): string {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase("tr-TR");
}

export function MessageLogPanel({ onClose }: { onClose: () => void }) {
  const [logs, setLogs] = useState<MessageLog[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [total, setTotal] = useState(0);
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (query) params.set("q", query);
      const response = await fetch(`/api/message-logs?${params}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as MessageLogResponse;
      if (!response.ok) {
        throw new Error(data.error || "Mesaj kayıtları alınamadı.");
      }
      setLogs(data.logs ?? []);
      setTotal(data.total ?? 0);
      setPageSize(data.pageSize ?? 100);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Mesaj kayıtları alınamadı.",
      );
    } finally {
      setLoading(false);
    }
  }, [page, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadLogs(), 0);
    return () => window.clearTimeout(timer);
  }, [loadLogs]);

  function search(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setQuery(draftQuery.trim());
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) =>
        event.target === event.currentTarget && onClose()
      }
    >
      <section
        className="message-log-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="message-log-title"
      >
        <header>
          <div>
            <p className="eyebrow">30 GÜNLÜK KAYIT</p>
            <h2 id="message-log-title">Gönderilen mesajlar</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Kapat">
            ×
          </button>
        </header>
        <div className="message-log-summary">
          <div>
            <strong>{total}</strong>
            <span>metin mesajı</span>
          </div>
          <p>
            Hangi ekip kullanıcısının, hangi konuşmaya, ne zaman ve hangi metni
            gönderdiğini gösterir. Fotoğraf ve videolar kaydedilmez.
          </p>
        </div>
        <form className="message-log-search" onSubmit={search}>
          <input
            value={draftQuery}
            maxLength={120}
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder="Kullanıcı, e-posta, konuşma veya mesaj ara"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setDraftQuery("");
                setQuery("");
                setPage(1);
              }}
            >
              Temizle
            </button>
          ) : null}
          <button type="submit">Ara</button>
        </form>
        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        <div className="message-log-table-wrap">
          <table className="message-log-table">
            <thead>
              <tr>
                <th>Zaman</th>
                <th>Kullanıcı</th>
                <th>Konuşma</th>
                <th>Gönderilen metin</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td data-label="Zaman"><time>{formatLogTime(log.sentAt)}</time></td>
                  <td data-label="Kullanıcı">
                    <div className="message-log-user">
                      <span className="agent-avatar small">
                        {initials(log.actorDisplayName)}
                      </span>
                      <div>
                        <strong>{log.actorDisplayName}</strong>
                        <span>{log.actorEmail}</span>
                      </div>
                    </div>
                  </td>
                  <td data-label="Konuşma">{log.conversationTitle}</td>
                  <td data-label="Gönderilen metin"><p>{log.messageText}</p></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !logs.length ? (
            <div className="message-log-empty">
              {query
                ? "Aramanızla eşleşen bir mesaj kaydı bulunamadı."
                : "Son 30 günde gönderilmiş metin mesajı bulunmuyor."}
            </div>
          ) : null}
          {loading ? <div className="message-log-empty">Kayıtlar yükleniyor…</div> : null}
        </div>
        <footer className="message-log-pagination">
          <span>Sayfa {page} / {pageCount}</span>
          <div>
            <button
              disabled={loading || page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Önceki
            </button>
            <button
              disabled={loading || page >= pageCount}
              onClick={() => setPage((current) => current + 1)}
            >
              Sonraki
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
