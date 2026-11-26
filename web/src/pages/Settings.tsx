import { useEffect, useState } from "react";
import { api, Criterion } from "../api";
import { useApp } from "../App";
import { CRIT_I18N, pick, useT } from "../i18n";
import { LangSwitch, PageHead, ThemeSwitch } from "../components/ui";

const LABEL: Record<string, string> = {
  anthropic: "Claude — Anthropic API", gemini: "Gemini — Google AI Studio", openrouter: "OpenRouter", groq: "Groq",
  openai: "OpenAI-compatible", "claude-cli": "Claude Code CLI", offline: "Rules only", mock: "Mock",
};

export default function Settings() {
  const { health } = useApp();
  const { t, lang } = useT();
  const [token, setToken] = useState(() => localStorage.getItem("lumen.token") || "");
  const [saved, setSaved] = useState(false);
  const [crit, setCrit] = useState<{ requirement: Criterion[]; set: Criterion[] } | null>(null);
  useEffect(() => { api.criteria().then(setCrit).catch(() => {}); }, []);
  const saveToken = () => { token ? localStorage.setItem("lumen.token", token) : localStorage.removeItem("lumen.token"); setSaved(true); setTimeout(() => setSaved(false), 1800); };
  const row = (k: string, v: string) => (<><dt className="text-ink-faint">{k}</dt><dd>{v}</dd></>);
  return (
    <div>
      <PageHead title={t("set.title")} sub={t("set.sub")} />
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
          <div className="card p-6">
            <div className="h2">{t("set.access")}</div>
            <p className="meta mt-1">{health?.auth_required ? t("set.accessOn") : t("set.accessOff")}</p>
            <div className="mt-3 flex gap-2">
              <input className="input" type="password" placeholder="X-API-Token" value={token} onChange={(e) => setToken(e.target.value)} aria-label="Token" />
              <button className="btn-primary" onClick={saveToken}>{saved ? t("ui.saved") : t("ui.save")}</button>
            </div>
          </div>
        </section>
      </div>
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
