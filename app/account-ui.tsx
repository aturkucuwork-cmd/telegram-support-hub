"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { Actor } from "./types";

type TeamUser = Actor & {
  isActive: boolean;
  createdAt: string;
  lastSeenAt: string;
};

async function apiData<T>(response: Response): Promise<T & { error?: string }> {
  const text = await response.text();
  if (!text) return {} as T & { error?: string };
  try {
    return JSON.parse(text) as T & { error?: string };
  } catch {
    return { error: text.slice(0, 240) } as T & { error?: string };
  }
}

export function AuthCard({
  setupRequired,
  onAuthenticated,
}: {
  setupRequired: boolean;
  onAuthenticated: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (setupRequired && password !== confirmPassword) {
      setError("Parolalar eşleşmiyor.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        setupRequired ? "/api/auth/setup" : "/api/auth/login",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, displayName, password }),
        },
      );
      const data = await apiData<{ actor?: Actor }>(response);
      if (!response.ok) throw new Error(data.error || "Giriş yapılamadı.");
      await onAuthenticated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Giriş yapılamadı.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="signin-shell">
      <section className="signin-card auth-card">
        <div className="brand-lockup"><span className="brand-mark">R</span><span>RelayDesk</span></div>
        <p className="eyebrow">{setupRequired ? "İLK KURULUM" : "EKİP GİRİŞİ"}</p>
        <h1>{setupRequired ? "Yönetici hesabınızı oluşturun." : "Ortak destek paneline giriş yapın."}</h1>
        <p>{setupRequired ? "Bu hesap ekip üyelerini ekler ve yönetir. Telegram konuşmaları tüm yetkili kullanıcılar için ortaktır." : "Kendi hesabınızla giriş yapın. Ekipteki herkes aynı konuşmaları ve güncel mesajları görür."}</p>
        <form className="auth-form" onSubmit={submit}>
          {setupRequired ? (
            <label><span>Ad soyad</span><input required minLength={2} maxLength={80} autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Destek yöneticisi" /></label>
          ) : null}
          <label><span>E-posta</span><input required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="isim@sirket.com" /></label>
          <label><span>Parola</span><input required type="password" minLength={8} maxLength={128} autoComplete={setupRequired ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="En az 8 karakter" /></label>
          {setupRequired ? (
            <label><span>Parolayı doğrulayın</span><input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
          ) : null}
          {error ? <div className="auth-error" role="alert">{error}</div> : null}
          <button className="primary-button auth-submit" disabled={submitting}>{submitting ? "Bekleyin…" : setupRequired ? "Yönetici hesabını oluştur" : "Giriş yap"}</button>
        </form>
      </section>
    </main>
  );
}

export function TeamPanel({ actor, onClose }: { actor: Actor; onClose: () => void }) {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"agent" | "admin">("agent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    const response = await fetch("/api/auth/users", { cache: "no-store" });
    const data = await apiData<{ users?: TeamUser[] }>(response);
    if (!response.ok) throw new Error(data.error || "Ekip üyeleri alınamadı.");
    setUsers(data.users ?? []);
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void loadUsers().catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Ekip üyeleri alınamadı.");
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [loadUsers]);

  async function addUser(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName, email, password, role }),
      });
      const data = await apiData<{ user?: TeamUser }>(response);
      if (!response.ok) throw new Error(data.error || "Kullanıcı eklenemedi.");
      setDisplayName("");
      setEmail("");
      setPassword("");
      setRole("agent");
      await loadUsers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Kullanıcı eklenemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleUser(user: TeamUser) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: user.id, isActive: !user.isActive }),
      });
      const data = await apiData<{ user?: TeamUser }>(response);
      if (!response.ok) throw new Error(data.error || "Kullanıcı güncellenemedi.");
      await loadUsers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Kullanıcı güncellenemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="team-panel" role="dialog" aria-modal="true" aria-labelledby="team-title">
        <header><div><p className="eyebrow">YÖNETİM</p><h2 id="team-title">Ekip kullanıcıları</h2></div><button className="modal-close" onClick={onClose} aria-label="Kapat">×</button></header>
        <p className="team-lead">Her kullanıcı kendi e-posta ve parolasıyla giriş yapar; herkes aynı Telegram gelen kutusunu görür.</p>
        <div className="team-users">
          {users.map((user) => (
            <article key={user.id} className={!user.isActive ? "inactive" : ""}>
              <span className="agent-avatar">{user.displayName.slice(0, 2).toLocaleUpperCase("tr-TR")}</span>
              <div><strong>{user.displayName}{user.id === actor.id ? " · Siz" : ""}</strong><span>{user.email}</span></div>
              <em>{user.role === "admin" ? "Yönetici" : "Temsilci"}</em>
              <button disabled={busy || user.id === actor.id} onClick={() => void toggleUser(user)}>{user.isActive ? "Devre dışı bırak" : "Etkinleştir"}</button>
            </article>
          ))}
        </div>
        <form className="team-form" onSubmit={addUser}>
          <h3>Yeni kullanıcı ekle</h3>
          <div className="team-form-grid">
            <label><span>Ad soyad</span><input required minLength={2} maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
            <label><span>E-posta</span><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label><span>Geçici parola</span><input required type="password" minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <label><span>Yetki</span><select value={role} onChange={(event) => setRole(event.target.value === "admin" ? "admin" : "agent")}><option value="agent">Destek temsilcisi</option><option value="admin">Yönetici</option></select></label>
          </div>
          {error ? <div className="auth-error" role="alert">{error}</div> : null}
          <button className="primary-button" disabled={busy}>{busy ? "Kaydediliyor…" : "Kullanıcıyı ekle"}</button>
        </form>
      </section>
    </div>
  );
}
