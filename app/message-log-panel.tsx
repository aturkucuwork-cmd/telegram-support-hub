"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { MessageLog, MessageLogUser } from "./types";

type MessageLogResponse = {
  logs?: MessageLog[];
  users?: MessageLogUser[];
  total?: number;
  pageSize?: number;
  error?: string;
};

type DayGroup = {
  key: string;
  label: string;
  logs: MessageLog[];
};

function logDate(value: string): Date {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return new Date(normalized);
}

function localDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const key = localDayKey(date);
  if (key === localDayKey(today)) return "Bugün";
  if (key === localDayKey(yesterday)) return "Dün";
  return new Intl.DateTimeFormat("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(logDate(value));
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
  const [users, setUsers] = useState<MessageLogUser[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [logs, setLogs] = useState<MessageLog[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(250);
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
      if (selectedEmail) params.set("actor_email", selectedEmail);
      if (query) params.set("q", query);
      const response = await fetch(`/api/message-logs?${params}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as MessageLogResponse;
      if (!response.ok) {
        throw new Error(data.error || "Mesaj kayıtları alınamadı.");
      }
      setUsers(data.users ?? []);
      setLogs(data.logs ?? []);
      setTotal(data.total ?? 0);
      setPageSize(data.pageSize ?? 250);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Mesaj kayıtları alınamadı.",
      );
    } finally {
      setLoading(false);
    }
  }, [page, query, selectedEmail]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadLogs(), 0);
    return () => window.clearTimeout(timer);
  }, [loadLogs]);

  const selectedUser =
    users.find((user) => user.email === selectedEmail) ?? null;

  const dayGroups = useMemo<DayGroup[]>(() => {
    const groups: DayGroup[] = [];
    for (const log of logs) {
      const date = logDate(log.sentAt);
      const key = localDayKey(date);
      const current = groups.at(-1);
      if (current?.key === key) {
        current.logs.push(log);
      } else {
        groups.push({ key, label: dayLabel(date), logs: [log] });
      }
    }
    return groups;
  }, [logs]);

  function selectUser(user: MessageLogUser) {
    setSelectedEmail(user.email);
    setLogs([]);
    setTotal(0);
    setPage(1);
    setDraftQuery("");
    setQuery("");
  }

  function search(event: FormEvent) {
    event.preventDefault();
    setLogs([]);
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
            <p className="eyebrow">KİŞİ BAZLI · SON 30 GÜN</p>
            <h2 id="message-log-title">Gönderilen mesajlar</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Kapat">
            ×
          </button>
        </header>

        <div className="message-log-person-layout">
          <aside className="message-log-people">
            <div className="message-log-people-heading">
              <strong>Ekip üyeleri</strong>
              <span>{users.length} kişi</span>
            </div>
            <div className="message-log-people-list">
              {users.map((user) => (
                <button
                  key={user.id}
                  className={user.email === selectedEmail ? "selected" : ""}
                  onClick={() => selectUser(user)}
                >
                  <span className="agent-avatar">
                    {initials(user.displayName)}
                  </span>
                  <span className="message-log-person-copy">
                    <strong>{user.displayName}</strong>
                    <small>{user.email}</small>
                    {!user.isActive ? <em>Devre dışı</em> : null}
                  </span>
                  <b>{user.messageCount}</b>
                </button>
              ))}
            </div>
          </aside>

          <section className="message-log-person-detail">
            {!selectedUser ? (
              <div className="message-log-select-prompt">
                <span>↗</span>
                <strong>Bir ekip üyesi seçin</strong>
                <p>
                  Kişinin gönderdiği metin mesajları otomatik olarak günlere
                  ayrılarak burada gösterilir.
                </p>
              </div>
            ) : (
              <>
                <div className="message-log-selected-user">
                  <span className="agent-avatar">
                    {initials(selectedUser.displayName)}
                  </span>
                  <div>
                    <strong>{selectedUser.displayName}</strong>
                    <span>{selectedUser.email}</span>
                  </div>
                  <b>{total} metin mesajı</b>
                </div>
                <form className="message-log-search" onSubmit={search}>
                  <input
                    value={draftQuery}
                    maxLength={120}
                    onChange={(event) => setDraftQuery(event.target.value)}
                    placeholder="Konuşma veya mesaj metninde ara"
                  />
                  {query ? (
                    <button
                      type="button"
                      onClick={() => {
                        setLogs([]);
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
                {error ? (
                  <div className="auth-error" role="alert">{error}</div>
                ) : null}
                <div className="message-log-day-stream">
                  {dayGroups.map((group) => (
                    <section className="message-log-day" key={group.key}>
                      <header>
                        <h3>{group.label}</h3>
                        <span>{group.logs.length} mesaj</span>
                      </header>
                      <div>
                        {group.logs.map((log) => (
                          <article className="message-log-entry" key={log.id}>
                            <time>{formatTime(log.sentAt)}</time>
                            <div>
                              <strong>{log.conversationTitle}</strong>
                              <p>{log.messageText}</p>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  ))}
                  {!loading && !logs.length ? (
                    <div className="message-log-empty">
                      {query
                        ? "Aramanızla eşleşen bir mesaj kaydı bulunamadı."
                        : "Bu kullanıcının son 30 günde gönderdiği metin mesajı bulunmuyor."}
                    </div>
                  ) : null}
                  {loading ? (
                    <div className="message-log-empty">Kayıtlar yükleniyor…</div>
                  ) : null}
                </div>
                {pageCount > 1 ? (
                  <footer className="message-log-pagination">
                    <span>Sayfa {page} / {pageCount}</span>
                    <div>
                      <button
                        disabled={loading || page <= 1}
                        onClick={() =>
                          setPage((current) => Math.max(1, current - 1))
                        }
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
                ) : null}
              </>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
