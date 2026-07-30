"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { TelegramFolder, TelegramFolderUser } from "./types";

type FolderResponse = {
  folders?: TelegramFolder[];
  users?: TelegramFolderUser[];
  assignedConversationCount?: number;
  error?: string;
};

function syncLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Henüz senkronlanmadı";
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function peerMark(type: string) {
  return type === "private" ? "K" : type === "channel" ? "Y" : "#";
}

export function FolderRulesPanel({ onClose }: { onClose: () => void }) {
  const [folders, setFolders] = useState<TelegramFolder[]>([]);
  const [users, setUsers] = useState<TelegramFolderUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyFolderId, setBusyFolderId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const response = await fetch("/api/telegram/folders", { cache: "no-store" });
      const data = (await response.json()) as FolderResponse;
      if (!response.ok) throw new Error(data.error || "Telegram klasörleri alınamadı.");
      setFolders(data.folders ?? []);
      setUsers(data.users ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Telegram klasörleri alınamadı.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(true), 0);
    const timer = window.setInterval(() => void load(false), 15_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  const activeUsers = useMemo(
    () => users.filter((user) => user.isActive),
    [users],
  );
  const mappedCount = folders.filter((folder) => folder.assignedToEmail).length;

  async function assign(folder: TelegramFolder, assignedToEmail: string | null) {
    setBusyFolderId(folder.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/telegram/folders", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderId: folder.id, assignedToEmail }),
      });
      const data = (await response.json()) as FolderResponse;
      if (!response.ok) throw new Error(data.error || "Klasör ataması kaydedilemedi.");
      setNotice(
        assignedToEmail
          ? `${folder.title} klasörü çalışanla eşleştirildi. ${data.assignedConversationCount ?? 0} konuşma şu anda klasör kurallarıyla atanıyor.`
          : `${folder.title} klasörünün otomatik ataması kaldırıldı.`,
      );
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Klasör ataması kaydedilemedi.");
    } finally {
      setBusyFolderId(null);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="folder-panel" role="dialog" aria-modal="true" aria-labelledby="folder-rules-title">
        <header>
          <div>
            <p className="eyebrow">TELEGRAM · OTOMATİK YÖNLENDİRME</p>
            <h2 id="folder-rules-title">Klasör atamaları</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Kapat">×</button>
        </header>

        <div className="folder-summary">
          <div><strong>{folders.length}</strong><span>Telegram klasörü</span></div>
          <div><strong>{mappedCount}</strong><span>Aktif yönlendirme</span></div>
          <button onClick={() => void load(true)} disabled={loading}>Telegram’dan yenile</button>
        </div>

        <div className="folder-rule-note">
          <span>↗</span>
          <p><strong>Nasıl çalışır?</strong> Telegram’da bir klasöre eklediğiniz özel sohbet, grup veya kanal burada seçtiğiniz çalışana otomatik atanır. Elle yapılmış kişi atamaları korunur.</p>
        </div>

        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        {notice ? <div className="folder-notice" role="status">{notice}</div> : null}

        {loading ? (
          <div className="folder-empty"><span className="status-spinner" /><p>Telegram klasörleri alınıyor…</p></div>
        ) : folders.length ? (
          <div className="folder-list">
            {folders.map((folder) => {
              const assignedUser = users.find((user) => user.email === folder.assignedToEmail);
              return (
                <article key={folder.id} className={folder.assignedToEmail ? "mapped" : ""}>
                  <div className="folder-card-heading">
                    <span className="folder-icon">▰</span>
                    <div>
                      <strong>{folder.title}</strong>
                      <span>{folder.memberCount} sohbet · Son senkron {syncLabel(folder.lastSyncedAt)}</span>
                    </div>
                    <em>{folder.assignedToEmail ? "AKTİF" : "ATANMADI"}</em>
                  </div>
                  <label className="folder-agent-select">
                    <span>Bu klasördeki sohbetleri aktar</span>
                    <select
                      value={folder.assignedToEmail ?? ""}
                      disabled={busyFolderId === folder.id}
                      onChange={(event) => void assign(folder, event.target.value || null)}
                    >
                      <option value="">Otomatik atama yok</option>
                      {activeUsers.map((user) => (
                        <option key={user.email} value={user.email}>{user.displayName} · {user.email}</option>
                      ))}
                      {assignedUser && !assignedUser.isActive ? (
                        <option value={assignedUser.email}>{assignedUser.displayName} · devre dışı</option>
                      ) : null}
                    </select>
                    {busyFolderId === folder.id ? <small>Kaydediliyor…</small> : null}
                  </label>
                  <div className="folder-members">
                    {folder.members.map((member) => (
                      <span key={member.id} title={`${member.peerTitle} · ${member.telegramPeerId}`}>
                        <i>{peerMark(member.peerType)}</i>{member.peerTitle}
                      </span>
                    ))}
                    {folder.memberCount > folder.members.length ? (
                      <b>+{folder.memberCount - folder.members.length} sohbet</b>
                    ) : null}
                    {!folder.memberCount ? <p>Bu Telegram klasöründe henüz sohbet yok.</p> : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="folder-empty">
            <span>▰</span>
            <strong>Telegram klasörü bulunamadı</strong>
            <p>Telegram’da Ayarlar → Sohbet Klasörleri bölümünden bir klasör oluşturup sohbetleri ekleyin. Dinleyici en geç 30 saniye içinde buraya aktarır.</p>
          </div>
        )}

        <footer>
          Bir sohbet birden fazla yönlendirilen klasördeyse en son değiştirdiğiniz klasör kuralı geçerli olur.
        </footer>
      </section>
    </div>
  );
}
