import { useEffect, useState } from "react";
import AgentBuddy from "../components/AgentBuddy";
import { api, Ticket, Criterion } from "../api";
import { useApp } from "../App";
import { CRIT_I18N, pick, useT } from "../i18n";
import { Lock, ShieldCheck } from "lucide-react";
import { LangSwitch, PageHead, ThemeSwitch } from "../components/ui";

const LABEL: Record<string, string> = {
  anthropic: "Claude — Anthropic API", gemini: "Gemini — Google AI Studio", openrouter: "OpenRouter", groq: "Groq",
  openai: "OpenAI-compatible", "claude-cli": "Claude Code CLI", offline: "Rules only", mock: "Mock",
};

export default function Settings() {
  const { health, admin, refreshAuth } = useApp();
  const { t, lang } = useT();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [authErr, setAuthErr] = useState("");
  const [crit, setCrit] = useState<{ requirement: Criterion[]; set: Criterion[] } | null>(null);
  useEffect(() => { api.criteria().then(setCrit).catch(() => {}); }, []);
  localStorage.removeItem("lumen.token"); // legacy: tokens are no longer kept in the browser
  const signIn = async () => {
    setBusy(true); setAuthErr("");
    try { await api.login(password); setPassword(""); refreshAuth(); } catch (e: any) { setAuthErr(e.message); } finally { setBusy(false); }
  };
  const signOut = async () => { await api.logout(); refreshAuth(); };
  const row = (k: string, v: string) => (<><dt className="text-ink-faint">{k}</dt><dd>{v}</dd></>);
  return (
    <div>
      <PageHead title={t("set.title")} sub={t("set.sub")} />
      <AgentBuddy agent={4} mood="idle"
        say={health?.storage_degraded && health.storage_error ? t("ab.setDb", { err: health.storage_error }) : t("ab.set")}
        onPick={() => window.dispatchEvent(new Event("lumen:support"))} />
      <section className="card mb-6 flex flex-wrap items-center gap-6 p-6">
        <div className="h2 mr-auto">{t("set.appearance")}</div>
        <div><div className="meta mb-1.5">{t("ui.language")}</div><LangSwitch /></div>
        <div><div className="meta mb-1.5">{t("ui.theme")}</div><ThemeSwitch /></div>
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <div className="h2">{t("set.model")}</div>
          {health && <dl className="mt-4 grid grid-cols-[150px_1fr] gap-y-2 text-sm">{row(t("set.default"), `${health.provider_label}, ${health.model}`)}{row(t("set.version"), `LÜMEN ${health.version} · ${health.commit}`)}</dl>}
          <ul className="mt-5 space-y-2">
            {health && Object.entries(health.providers).filter(([k]) => k !== "mock").map(([k, v]) => (
              <li key={k} className="flex items-center justify-between rounded-xl bg-ink/[0.04] px-3 py-2 text-sm">
                <span>{LABEL[k] || k}</span>
                <span className={`chip ${v ? "bg-ok/15 text-ok" : "bg-ink/5 text-ink-faint"}`}>{v ? t("set.available") : t("set.missing")}</span>
              </li>
            ))}
          </ul>
          <p className="meta mt-4">{t("set.modelNote")}</p>
        </section>
        <section className="space-y-6">
          <div className="card p-6">
            <div className="h2">{t("set.storage")}</div>
            {health && (
              <dl className="mt-4 grid grid-cols-[150px_1fr] gap-y-2 text-sm">
                {row(t("set.history"), health.storage === "supabase" ? "Supabase (PostgreSQL)" : t("set.local"))}
                {row(t("set.telegram"), health.telegram ? t("set.connected") : t("set.missing"))}
                {row(t("set.formats"), health.formats.join(", ").toUpperCase())}
                {row(t("set.encryption"), health.encryption ? t("set.encOn") : t("set.encOff"))}
              </dl>
            )}
          </div>
          <div id="admin" className="card p-6">
            <div className="flex items-center gap-2 h2">{admin ? <ShieldCheck size={18} className="text-ok" /> : <Lock size={18} />}{t("set.admin")}</div>
            <p className="meta mt-1">{t("set.adminD")}</p>
            {health && <p className="mt-2 text-[13px]"><span className="text-ink-faint">{t("set.mode")}: </span>{health.public_audits ? t("set.modePublic") : t("set.modeClosed")}</p>}
            {!health?.login_enabled ? <p className="mt-3 rounded-xl bg-warn/15 px-3 py-2 text-[13px] text-warn">{t("set.noLogin")}</p>
              : admin ? (
                <div className="mt-4 flex items-center justify-between rounded-xl bg-ok/15 px-4 py-3 text-sm">
                  <span className="font-medium text-ok">{t("set.signedIn")}</span>
                  <button className="btn-line py-1.5" onClick={signOut}>{t("set.signOut")}</button>
                </div>
              ) : (
                <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); signIn(); }}>
                  <input className="input" type="password" autoComplete="current-password" placeholder={t("set.password")} value={password} onChange={(e) => setPassword(e.target.value)} aria-label={t("set.password")} />
                  <button className="btn-primary" disabled={!password || busy}>{t("set.signIn")}</button>
                </form>
              )}
            {authErr && <p className="mt-2 text-[13px] text-bad">{authErr}</p>}
          </div>
        </section>
      </div>
      {admin && <Tickets />}
      {crit && (
        <section className="card mt-6 p-6">
          <div className="h2">{t("set.criteria")}</div>
          <p className="meta mt-1">{t("set.criteriaD")}</p>
          <div className="mt-4 grid gap-x-8 gap-y-3 md:grid-cols-2">
            {[...crit.requirement, ...crit.set].map((c) => (
              <div key={c.key} className="text-sm">
                <span className="font-medium">{pick(CRIT_I18N[c.key], lang, c.name)}</span>{c.basis === "expert" && <span className="chip ml-2 bg-violet/15 text-violet">{t("set.expert")}</span>}
                <div className="meta">{c.ref}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** What users handed over to the team from the support chat and the bot (admins only). */
function Tickets() {
  const { t, lang } = useT();
  const [items, setItems] = useState<Ticket[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api.tickets().then((r) => setItems(r.items)).catch((e) => setErr(e.message)); }, []);
  return (
    <section className="card mt-6 p-6">
      <div className="h2">{t("tk.title")}</div>
      <p className="meta mt-1">{t("tk.sub")}</p>
      {err && <p className="mt-3 text-[13px] text-bad">{err}</p>}
      {items && !items.length && <p className="meta mt-4">{t("tk.empty")}</p>}
      <ul className="mt-4 space-y-2">
        {items?.map((x) => (
          <li key={x.id} className="rounded-xl border border-line px-4 py-3">
            <div className="meta flex flex-wrap gap-x-3">
              <span className="font-mono">№{x.id}</span>
              <span>{new Date(x.at).toLocaleString(lang === "en" ? "en-GB" : lang === "kk" ? "kk-KZ" : "ru-RU")}</span>
              <span>{x.channel === "telegram" ? "Telegram" : t("tk.site")}</span>
              {x.contact && <span className="text-ink">{x.contact}</span>}
            </div>
            <div className="mt-1 text-[14px]">{x.message}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
