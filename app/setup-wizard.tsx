"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { SystemStatus } from "./types";

type SetupBootstrap = {
  available: boolean;
  onHost: boolean;
  bridgeUrl: string;
  token: string | null;
};

type BridgeStatus = {
  available: boolean;
  botConfigured: boolean;
  botUsername: string | null;
  userSessionConfigured: boolean;
  telegramAccount: { displayName: string | null; username: string | null } | null;
  businessConnected: boolean;
};

type TelegramPhase = "details" | "code" | "password" | "complete";

const setupSteps = [
  { id: 1, title: "Yönetici hesabı", short: "Panel güvenliği" },
  { id: 2, title: "Telegram botu", short: "BotFather ve token" },
  { id: 3, title: "Telegram hesabı", short: "API ve güvenli oturum" },
  { id: 4, title: "Business bağlantısı", short: "Okuma ve yanıtlama yetkisi" },
  { id: 5, title: "Grup ve kanal akışı", short: "Canlı MTProto dinleyicisi" },
  { id: 6, title: "Son kontrol", short: "Sistemi kullanıma aç" },
] as const;

async function responseData<T>(response: Response): Promise<T & { error?: string; code?: string }> {
  const text = await response.text();
  if (!text) return {} as T & { error?: string; code?: string };
  try {
    return JSON.parse(text) as T & { error?: string; code?: string };
  } catch {
    return { error: text.slice(0, 240) } as T & { error?: string; code?: string };
  }
}

export function SetupWizard({
  status,
  onRefresh,
  onClose,
}: {
  status: SystemStatus;
  onRefresh: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [bootstrap, setBootstrap] = useState<SetupBootstrap | null>(null);
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [activeStep, setActiveStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [botToken, setBotToken] = useState("");
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [phone, setPhone] = useState("+90");
  const [telegramCode, setTelegramCode] = useState("");
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [telegramPhase, setTelegramPhase] = useState<TelegramPhase>("details");
  const [replaceRequired, setReplaceRequired] = useState(false);

  const bridgeRequest = useCallback(async <T,>(path: string, options?: RequestInit) => {
    if (!bootstrap?.available || !bootstrap.token) {
      throw new Error("Yerel kurulum köprüsü hazır değil.");
    }
    const response = await fetch(`${bootstrap.bridgeUrl}${path}`, {
      ...options,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${bootstrap.token}`,
        ...(options?.body ? { "Content-Type": "application/json" } : {}),
        ...options?.headers,
      },
    });
    const data = await responseData<T>(response);
    if (!response.ok) {
      const failure = new Error(data.error || "Yerel kurulum işlemi başarısız.") as Error & { code?: string };
      failure.code = data.code;
      throw failure;
    }
    return data;
  }, [bootstrap]);

  const loadBridgeStatus = useCallback(async () => {
    const data = await bridgeRequest<BridgeStatus>("/status");
    setBridge(data);
    return data;
  }, [bridgeRequest]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch("/api/local-setup", { cache: "no-store" });
          const data = await responseData<SetupBootstrap>(response);
          if (!response.ok) throw new Error(data.error || "Kurulum bilgisi alınamadı.");
          if (!active) return;
          setBootstrap(data);
          if (!data.available || !data.token) return;
          const bridgeResponse = await fetch(`${data.bridgeUrl}/status`, {
            cache: "no-store",
            headers: { Authorization: `Bearer ${data.token}` },
          });
          const bridgeData = await responseData<BridgeStatus>(bridgeResponse);
          if (!bridgeResponse.ok) throw new Error(bridgeData.error || "Yerel kurulum köprüsüne ulaşılamadı.");
          if (!active) return;
          setBridge(bridgeData);
          const completed = [true, bridgeData.botConfigured, bridgeData.userSessionConfigured, bridgeData.businessConnected, status.userGroupListener.connected];
          const firstIncomplete = completed.findIndex((value) => !value);
          setActiveStep(firstIncomplete === -1 ? 6 : firstIncomplete + 1);
        } catch (cause) {
          if (active) setError(cause instanceof Error ? cause.message : "Kurulum durumu alınamadı.");
        } finally {
          if (active) setLoading(false);
        }
      })();
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [status.userGroupListener.connected]);

  const done = useMemo(() => ({
    1: status.actor.role === "admin",
    2: Boolean(bridge?.botConfigured || status.configured),
    3: Boolean(bridge?.userSessionConfigured),
    4: bridge ? bridge.businessConnected : status.connected,
    5: status.userGroupListener.connected,
    6: Boolean((bridge ? bridge.businessConnected : status.connected) && status.userGroupListener.connected),
  }), [bridge, status]);

  function beginAction() {
    setBusy(true);
    setError(null);
    setNotice(null);
    setReplaceRequired(false);
  }

  async function saveBot(event: FormEvent) {
    event.preventDefault();
    beginAction();
    try {
      const result = await bridgeRequest<{ username: string }>("/bot-config", {
        method: "POST",
        body: JSON.stringify({ token: botToken }),
      });
      setBotToken("");
      await loadBridgeStatus();
      setNotice(`@${result.username} doğrulandı ve yerel mesaj alımı hazırlandı.`);
      setActiveStep(3);
      window.setTimeout(() => void onRefresh().catch(() => undefined), 1600);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Bot kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function startTelegramLogin(event: FormEvent) {
    event.preventDefault();
    beginAction();
    try {
      const result = await bridgeRequest<{ phase: TelegramPhase; message?: string }>("/telegram/start", {
        method: "POST",
        body: JSON.stringify({ apiId, apiHash, phone }),
      });
      setTelegramPhase(result.phase);
      setNotice(result.message || "Telegram kodu gönderildi.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Telegram kodu gönderilemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function submitTelegramSecret(event: FormEvent) {
    event.preventDefault();
    beginAction();
    try {
      const isPassword = telegramPhase === "password";
      const result = await bridgeRequest<{ phase: TelegramPhase; message?: string }>(
        isPassword ? "/telegram/password" : "/telegram/code",
        {
          method: "POST",
          body: JSON.stringify(isPassword ? { password: twoFactorPassword } : { code: telegramCode }),
        },
      );
      setTelegramPhase(result.phase);
      setTelegramCode("");
      setTwoFactorPassword("");
      if (result.phase === "complete") {
        setApiId("");
        setApiHash("");
        setPhone("+90");
        await loadBridgeStatus();
        setNotice("Telegram hesabı Windows kasasında şifrelendi ve grup dinleyicisi başlatıldı.");
        setActiveStep(4);
        window.setTimeout(() => void onRefresh().catch(() => undefined), 1800);
      } else {
        setNotice(result.message || "Bir sonraki doğrulama adımına geçin.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Telegram hesabı doğrulanamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function checkBusiness() {
    beginAction();
    try {
      const result = await bridgeRequest<{ connected: boolean; username: string | null }>("/business/status");
      setBridge((current) => current ? { ...current, businessConnected: result.connected, botUsername: result.username || current.botUsername } : current);
      setNotice(result.connected ? `@${result.username} Business hesabına bağlı.` : "Business bağlantısı henüz kurulmamış.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Business durumu denetlenemedi.");
    } finally {
      setBusy(false);
    }
  }

  async function connectBusiness(replace = false) {
    beginAction();
    try {
      const result = await bridgeRequest<{ connected: boolean; username: string }>("/business/connect", {
        method: "POST",
        body: JSON.stringify({ replace }),
      });
      setBridge((current) => current ? { ...current, businessConnected: result.connected, botUsername: result.username } : current);
      setNotice(`@${result.username}, mevcut ve yeni özel sohbetler için bağlandı.`);
      setActiveStep(5);
      window.setTimeout(() => void onRefresh().catch(() => undefined), 1500);
    } catch (cause) {
      const failure = cause as Error & { code?: string };
      setReplaceRequired(failure.code === "replace_required");
      setError(failure.message || "Business bot bağlanamadı.");
    } finally {
      setBusy(false);
    }
  }

  async function startListener() {
    beginAction();
    try {
      await bridgeRequest<{ started: boolean }>("/listener/start", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setNotice("Grup ve kanal dinleyicisi başlatıldı. Canlı durum birkaç saniye içinde yeşile dönecek.");
      window.setTimeout(() => void onRefresh().catch(() => undefined), 2500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dinleyici başlatılamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="setup-wizard-backdrop" role="presentation">
      <section className="setup-wizard" role="dialog" aria-modal="true" aria-labelledby="setup-wizard-title">
        <aside className="setup-wizard-rail">
          <div className="brand-lockup"><span className="brand-mark">R</span><span>RelayDesk</span></div>
          <div className="setup-wizard-intro"><p className="eyebrow">İLK KURULUM</p><h2 id="setup-wizard-title">Telegram’ı tek akışta bağlayın.</h2><p>Tamamlanan adımlar kaybolmaz; daha sonra bu ekrandan tekrar kontrol edebilirsiniz.</p></div>
          <nav aria-label="Kurulum adımları">
            {setupSteps.map((step) => (
              <button key={step.id} className={`${activeStep === step.id ? "active" : ""} ${done[step.id] ? "done" : ""}`} onClick={() => { setActiveStep(step.id); setError(null); setNotice(null); }}>
                <span>{done[step.id] ? "✓" : step.id}</span><div><strong>{step.title}</strong><small>{step.short}</small></div>
              </button>
            ))}
          </nav>
          <div className="setup-security-note"><span>⌾</span><p><strong>Yerel ve şifreli</strong>Token, API anahtarı ve Telegram oturumu ekip tarayıcılarına veya mesaj veritabanına yazılmaz.</p></div>
        </aside>

        <main className="setup-wizard-content">
          <header><div><span>ADIM {activeStep} / 6</span><b>{setupSteps[activeStep - 1].title}</b></div><button onClick={onClose} aria-label="Kurulum ekranını kapat">×</button></header>
          <div className="setup-wizard-scroll">
            {loading ? <div className="setup-wizard-loading"><span className="status-spinner" />Kurulum durumu denetleniyor…</div> : null}
            {!loading && bootstrap && !bootstrap.available ? (
              <div className="setup-host-warning"><strong>Kurulumu ana bilgisayarda açın.</strong><p>Bu güvenli ekran yalnızca RelayDesk’in çalıştığı bilgisayarda <code>http://localhost:3000</code> adresinden ayar yapabilir.</p></div>
            ) : null}

            {!loading && bootstrap?.available ? (
              <>
                {activeStep === 1 ? <WizardStepOne status={status} onNext={() => setActiveStep(2)} /> : null}
                {activeStep === 2 ? (
                  <section className="wizard-step-card">
                    <StepHeading mark="01" title="BotFather botunu hazırlayın" text="RelayDesk özel sohbetlere yanıt vermek için bir Telegram Business botu kullanır." done={done[2]} />
                    <div className="setup-callout"><strong>BotFather’da yapılacaklar</strong><ol><li><a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> içinde <code>/newbot</code> ile bot oluşturun.</li><li><code>/mybots</code> → bot → Bot Settings → <b>Business Mode</b> → Turn on.</li><li>Bot token’ını kopyalayıp aşağıya yapıştırın.</li></ol></div>
                    {done[2] ? <ConnectedCard title={`@${bridge?.botUsername || "Telegram botu"}`} detail="Bot token doğrulandı; webhook kapatıldı ve yerel long polling hazır." /> : (
                      <form className="wizard-form" onSubmit={saveBot}><label><span>BotFather token</span><input required type="password" autoComplete="off" value={botToken} onChange={(event) => setBotToken(event.target.value)} placeholder="123456789:AA…" /></label><button className="primary-button" disabled={busy}>{busy ? "Doğrulanıyor…" : "Botu doğrula ve kaydet"}</button></form>
                    )}
                    {done[2] ? <button className="primary-button wizard-next" onClick={() => setActiveStep(3)}>Telegram hesabına geç</button> : null}
                  </section>
                ) : null}
                {activeStep === 3 ? (
                  <section className="wizard-step-card">
                    <StepHeading mark="02" title="Normal Telegram hesabını bağlayın" text="Takip ettiğiniz gruplar ve kanallar bu hesap üzerinden, bot üyeliği gerektirmeden okunur." done={done[3]} />
                    {done[3] ? <><ConnectedCard title={bridge?.telegramAccount?.displayName || "Telegram hesabı"} detail={`${bridge?.telegramAccount?.username ? `@${bridge.telegramAccount.username} · ` : ""}Windows DPAPI kasasında şifreli oturum`} /><button className="primary-button wizard-next" onClick={() => setActiveStep(4)}>Business bağlantısına geç</button></> : (
                      <>
                        <div className="setup-callout"><strong>API bilgilerini alın</strong><p><a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer">my.telegram.org/apps</a> sayfasında bir uygulama oluşturup <code>api_id</code> ve <code>api_hash</code> değerlerini alın. Bu işlem ücretsizdir.</p></div>
                        {telegramPhase === "details" ? <form className="wizard-form two-column" onSubmit={startTelegramLogin}><label><span>api_id</span><input required inputMode="numeric" value={apiId} onChange={(event) => setApiId(event.target.value)} /></label><label><span>api_hash</span><input required type="password" autoComplete="off" value={apiHash} onChange={(event) => setApiHash(event.target.value)} /></label><label className="wide"><span>Telefon numarası</span><input required type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+905…" /></label><button className="primary-button wide" disabled={busy}>{busy ? "Kod gönderiliyor…" : "Telegram kodu gönder"}</button></form> : null}
                        {telegramPhase === "code" || telegramPhase === "password" ? <form className="wizard-form" onSubmit={submitTelegramSecret}><label><span>{telegramPhase === "code" ? "Telegram giriş kodu" : "İki aşamalı doğrulama parolası"}</span><input required type={telegramPhase === "password" ? "password" : "text"} inputMode={telegramPhase === "code" ? "numeric" : undefined} autoComplete="one-time-code" value={telegramPhase === "code" ? telegramCode : twoFactorPassword} onChange={(event) => telegramPhase === "code" ? setTelegramCode(event.target.value) : setTwoFactorPassword(event.target.value)} /></label><button className="primary-button" disabled={busy}>{busy ? "Doğrulanıyor…" : "Hesabı doğrula"}</button></form> : null}
                      </>
                    )}
                  </section>
                ) : null}
                {activeStep === 4 ? (
                  <section className="wizard-step-card">
                    <StepHeading mark="03" title="Business bot yetkilerini verin" text="Bot, mevcut ve yeni özel sohbetleri okuyup destek ekibi adına yanıtlayabilecek." done={done[4]} />
                    <div className="permission-grid"><article><span>◉</span><strong>Mesajları oku</strong><p>Özel müşteri konuşmaları ortak gelen kutusuna gelir.</p></article><article><span>↗</span><strong>Yanıt gönder</strong><p>Ekip cevapları normal Business hesabı adına iletilir.</p></article></div>
                    {done[4] ? <><ConnectedCard title={`@${bridge?.botUsername || "Business bot"} bağlı`} detail="Mevcut/yeni sohbetler, kişiler ve kişi olmayanlar kapsamda." /><button className="primary-button wizard-next" onClick={() => setActiveStep(5)}>Grup akışına geç</button></> : <div className="wizard-actions"><button className="primary-button" disabled={busy || !done[2] || !done[3]} onClick={() => void connectBusiness(false)}>{busy ? "Telegram doğruluyor…" : "Business botu hesaba bağla"}</button><button className="secondary-button" disabled={busy || !done[2] || !done[3]} onClick={() => void checkBusiness()}>Mevcut bağlantıyı denetle</button></div>}
                    {replaceRequired ? <button className="danger-confirm" disabled={busy} onClick={() => void connectBusiness(true)}>Mevcut Business botunu değiştir ve devam et</button> : null}
                  </section>
                ) : null}
                {activeStep === 5 ? (
                  <section className="wizard-step-card">
                    <StepHeading mark="04" title="Grup, forum ve kanalları canlı bağlayın" text="Normal hesabınızın takip ettiği sohbetler başlangıç imlecinden tamamlanır ve yeni mesajlar anlık akar." done={done[5]} />
                    <div className="stream-visual"><div><span>#</span><p><strong>Gruplar</strong>Normal ve süpergruplar</p></div><i>→</i><div><span>◎</span><p><strong>RelayDesk akışı</strong>Tekilleştirilmiş mesajlar</p></div><i>→</i><div><span>R</span><p><strong>Ekip paneli</strong>Tüm kullanıcılara ortak</p></div></div>
                    {done[5] ? <ConnectedCard title="Grup ve kanal akışı canlı" detail={status.userGroupListener.displayName ? `${status.userGroupListener.displayName} hesabı dinleniyor.` : "Telegram kullanıcı dinleyicisi çalışıyor."} /> : <button className="primary-button" disabled={busy || !done[3]} onClick={() => void startListener()}>{busy ? "Başlatılıyor…" : "Grup ve kanal dinleyicisini başlat"}</button>}
                    <div className="setup-callout subtle"><strong>Botu gruplara eklemek zorunda değilsiniz.</strong><p>Mesajları kullanıcı dinleyicisi alır. Yalnızca panelden gruba bot adıyla yanıt vermek istiyorsanız botu ilgili gruba ekleyin.</p></div>
                    {done[5] ? <button className="primary-button wizard-next" onClick={() => setActiveStep(6)}>Son kontrole geç</button> : null}
                  </section>
                ) : null}
                {activeStep === 6 ? <WizardFinal status={status} businessConnected={done[4]} groupConnected={done[5]} onRefresh={onRefresh} onClose={onClose} /> : null}
              </>
            ) : null}

            {notice ? <div className="wizard-notice" role="status">✓ {notice}</div> : null}
            {error ? <div className="wizard-error" role="alert"><span>!</span><p>{error}</p><button onClick={() => setError(null)}>×</button></div> : null}
          </div>
        </main>
      </section>
    </div>
  );
}

function StepHeading({ mark, title, text, done }: { mark: string; title: string; text: string; done: boolean }) {
  return <header className="wizard-step-heading"><span className={done ? "done" : ""}>{done ? "✓" : mark}</span><div><p className="eyebrow">TELEGRAM KURULUMU</p><h1>{title}</h1><p>{text}</p></div></header>;
}

function ConnectedCard({ title, detail }: { title: string; detail: string }) {
  return <div className="connected-card"><span>✓</span><div><strong>{title}</strong><p>{detail}</p></div><b>BAĞLI</b></div>;
}

function WizardStepOne({ status, onNext }: { status: SystemStatus; onNext: () => void }) {
  return <section className="wizard-step-card"><StepHeading mark="00" title="Yönetici hesabınız hazır" text="Kurulum işlemleri yalnızca yönetici rolündeki kullanıcılar tarafından yapılabilir." done /><ConnectedCard title={status.actor.displayName} detail={`${status.actor.email} · Yönetici hesabı`} /><div className="setup-callout subtle"><strong>Ekip üyelerini daha sonra ekleyebilirsiniz.</strong><p>Her kullanıcı kendi e-posta ve parolasıyla giriş yapar; Telegram oturum bilgilerini kimseyle paylaşmaz.</p></div><button className="primary-button wizard-next" onClick={onNext}>Telegram botunu kur</button></section>;
}

function WizardFinal({ status, businessConnected, groupConnected, onRefresh, onClose }: { status: SystemStatus; businessConnected: boolean; groupConnected: boolean; onRefresh: () => Promise<unknown>; onClose: () => void }) {
  const checks = [{ label: "Bot ayarları", done: status.configured }, { label: "Business özel sohbetler", done: businessConnected }, { label: "Grup ve kanal akışı", done: groupConnected }];
  const complete = checks.every((item) => item.done);
  return <section className="wizard-step-card final"><div className={`setup-finish-mark ${complete ? "done" : ""}`}>{complete ? "✓" : "…"}</div><p className="eyebrow">SON KONTROL</p><h1>{complete ? "RelayDesk kullanıma hazır." : "Bağlantıların tamamlanmasını bekliyoruz."}</h1><p className="final-lead">Başka bir hesaptan özel mesaj ve takip ettiğiniz bir gruptan test mesajı gönderin. Konuşmalar otomatik olarak ortak gelen kutusuna düşer.</p><div className="final-checks">{checks.map((item) => <article key={item.label} className={item.done ? "done" : ""}><span>{item.done ? "✓" : "○"}</span><strong>{item.label}</strong><b>{item.done ? "Hazır" : "Bekleniyor"}</b></article>)}</div><div className="wizard-actions"><button className="secondary-button" onClick={() => void onRefresh()}>Durumu yenile</button><button className="primary-button" disabled={!complete} onClick={onClose}>Kurulumu tamamla ve panele geç</button></div></section>;
}
