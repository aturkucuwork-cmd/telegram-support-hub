"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { Bot } from "./types";

type BotsResponse = { bots?: Bot[]; error?: string };
type BotResponse = { bot?: Bot; error?: string };
type AdoptEnvResponse = { bot?: Bot; migratedChatCount?: number; error?: string };

function validatedLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Henüz doğrulanmadı";
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function BotsPanel({ onClose }: { onClose: () => void }) {
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyBotId, setBusyBotId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [creating, setCreating] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [showEnvBanner, setShowEnvBanner] = useState(false);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const response = await fetch("/api/bots", { cache: "no-store" });
      const data = (await response.json()) as BotsResponse;
      if (!response.ok) throw new Error(data.error || "Botlar alınamadı.");
      setBots(data.bots ?? []);
      setShowEnvBanner((data.bots ?? []).length === 0);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Botlar alınamadı.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(true), 0);
    return () => window.clearTimeout(initial);
  }, [load]);

  async function createBot(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/bots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, token }),
      });
      const data = (await response.json()) as BotResponse;
      if (!response.ok) throw new Error(data.error || "Bot eklenemedi.");
      setNotice(`${data.bot?.label} eklendi.`);
      setLabel("");
      setToken("");
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Bot eklenemedi.");
    } finally {
      setCreating(false);
    }
  }

  async function patchBot(bot: Bot, changes: Record<string, unknown>) {
    setBusyBotId(bot.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/bots", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: bot.id, ...changes }),
      });
      const data = (await response.json()) as BotResponse;
      if (!response.ok) throw new Error(data.error || "Bot güncellenemedi.");
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Bot güncellenemedi.");
    } finally {
      setBusyBotId(null);
    }
  }

  async function adoptEnvBot() {
    setAdopting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/bots/adopt-env", { method: "POST" });
      const data = (await response.json()) as AdoptEnvResponse;
      if (!response.ok) throw new Error(data.error || "Bot içe aktarılamadı.");
      setNotice(
        `${data.bot?.label} içe aktarıldı. ${data.migratedChatCount ?? 0} mevcut grup ona bağlandı.`,
      );
      setShowEnvBanner(false);
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Bot içe aktarılamadı.");
    } finally {
      setAdopting(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="folder-panel" role="dialog" aria-modal="true" aria-labelledby="bots-panel-title">
        <header>
          <div>
            <p className="eyebrow">TELEGRAM · BOT PERSONA’LARI</p>
            <h2 id="bots-panel-title">Botlar</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Kapat">×</button>
        </header>

        <div className="folder-summary">
          <div><strong>{bots.length}</strong><span>Kayıtlı bot</span></div>
          <div><strong>{bots.filter((bot) => bot.isEnabled).length}</strong><span>Aktif bot</span></div>
          <button onClick={() => void load(true)} disabled={loading}>Yenile</button>
        </div>

        {showEnvBanner ? (
          <div className="folder-rule-note">
            <span>↗</span>
            <p>
              <strong>Ortam değişkeninde bir bot bulundu.</strong> .env.local içindeki
              TELEGRAM_BOT_TOKEN’ı bot #1 olarak içe aktarıp mevcut grup konuşmalarını ona
              bağlayabilirsiniz.{" "}
              <button onClick={() => void adoptEnvBot()} disabled={adopting}>
                {adopting ? "İçe aktarılıyor…" : "İçe aktar"}
              </button>
            </p>
          </div>
        ) : null}

        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        {notice ? <div className="folder-notice" role="status">{notice}</div> : null}

        <form onSubmit={(event) => void createBot(event)} className="folder-rule-note" style={{ flexDirection: "column", gap: "0.5rem" }}>
          <strong>Yeni bot ekle</strong>
          <input
            type="text"
            placeholder="Etiket (örn. Grup A destek botu)"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            required
            minLength={2}
            maxLength={80}
          />
          <input
            type="password"
            placeholder="BotFather token’ı"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
            autoComplete="off"
          />
          <button type="submit" disabled={creating}>{creating ? "Doğrulanıyor…" : "Bot ekle"}</button>
        </form>

        {loading ? (
          <div className="folder-empty"><span className="status-spinner" /><p>Botlar alınıyor…</p></div>
        ) : bots.length ? (
          <div className="folder-list">
            {bots.map((bot) => (
              <article key={bot.id} className={bot.isEnabled ? "mapped" : ""}>
                <div className="folder-card-heading">
                  <span className="folder-icon">◈</span>
                  <div>
                    <strong>{bot.label}</strong>
                    <span>
                      {bot.username ? `@${bot.username}` : "kullanıcı adı yok"} · ····{bot.tokenLastFour} ·{" "}
                      {bot.groupCount} grup · Son doğrulama {validatedLabel(bot.lastValidatedAt ?? "")}
                    </span>
                  </div>
                  <em>{bot.isEnabled ? "AKTİF" : "PASİF"}</em>
                </div>
                {bot.lastPollError ? (
                  <p className="auto-assignment-note">Son polling hatası: {bot.lastPollError}</p>
                ) : null}
                <div className="folder-members">
                  <button
                    disabled={busyBotId === bot.id}
                    onClick={() => void patchBot(bot, { isEnabled: !bot.isEnabled })}
                  >
                    {bot.isEnabled ? "Devre dışı bırak" : "Etkinleştir"}
                  </button>
                  <button
                    disabled={busyBotId === bot.id}
                    onClick={() => void patchBot(bot, { revalidate: true })}
                  >
                    Yeniden doğrula
                  </button>
                  {busyBotId === bot.id ? <small>Kaydediliyor…</small> : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="folder-empty">
            <span>◈</span>
            <strong>Henüz bot eklenmedi</strong>
            <p>BotFather ile bir bot oluşturup token’ını yukarıdan ekleyin.</p>
          </div>
        )}

        <footer>
          Bir Telegram grubuna eklenen bot, o gruptan gelen ilk mesajda otomatik olarak
          eşleştirilir. Bir grubu elle başka bir bota taşımak için grup atamalarını kullanın.
        </footer>
      </section>
    </div>
  );
}
