import { useEffect, useState } from "react";
import { api, Criterion } from "../api";
import { useApp } from "../App";
import { PageHead } from "../components/ui";

const LABEL: Record<string, string> = {
  anthropic: "Claude — Anthropic API (ANTHROPIC_API_KEY)", gemini: "Gemini — Google AI Studio (GEMINI_API_KEY)",
  openai: "OpenAI-совместимый (OPENAI_API_KEY + OPENAI_BASE_URL)", "claude-cli": "Claude Code CLI на сервере",
  offline: "Только правила (без ключа)", mock: "Mock (тесты и демо)",
};

export default function Settings() {
  const { health } = useApp();
  const [token, setToken] = useState(() => localStorage.getItem("lumen.token") || "");
  const [saved, setSaved] = useState(false);
  const [crit, setCrit] = useState<{ requirement: Criterion[]; set: Criterion[] } | null>(null);
  useEffect(() => { api.criteria().then(setCrit).catch(() => {}); }, []);
  const saveToken = () => { token ? localStorage.setItem("lumen.token", token) : localStorage.removeItem("lumen.token"); setSaved(true); setTimeout(() => setSaved(false), 1800); };

  return (
    <div>
      <PageHead title="Настройки" sub="Ключи моделей задаются только на сервере в .env или переменных Railway: в браузер и отчёты они не попадают." />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <div className="h2">Модель</div>
          {health ? (
            <dl className="mt-4 grid grid-cols-[150px_1fr] gap-y-2 text-sm">
              <dt className="text-ink-faint">По умолчанию</dt><dd>{health.provider_label}</dd>
              <dt className="text-ink-faint">Модель</dt><dd>{health.model}</dd>
              <dt className="text-ink-faint">Версия агента</dt><dd>LÜMEN {health.version}, коммит {health.commit}</dd>
            </dl>
          ) : <p className="meta mt-2">Сервер недоступен.</p>}
          <ul className="mt-5 space-y-2">
            {health && Object.entries(health.providers).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between rounded-xl bg-canvas px-3 py-2 text-sm">
                <span>{LABEL[k] || k}</span>
                <span className={`chip ${v ? "bg-emerald-50 text-emerald-700" : "bg-white text-ink-faint"}`}>{v ? "доступен" : "не настроен"}</span>
              </li>
            ))}
          </ul>
          <p className="meta mt-4">Сменить модель: LLM_PROVIDER и LLM_MODEL в .env. Для отдельного прогона модель выбирается на странице «Новый аудит».</p>
        </section>
        <section className="space-y-6">
          <div className="card p-6">
            <div className="h2">Хранилище и интеграции</div>
            {health && (
              <dl className="mt-4 grid grid-cols-[150px_1fr] gap-y-2 text-sm">
                <dt className="text-ink-faint">История</dt><dd>{health.storage === "supabase" ? `Supabase${health.storage_degraded ? " (недоступен, используется локальное)" : ""}` : "Локальные файлы (data/)"}</dd>
                <dt className="text-ink-faint">Telegram-бот</dt><dd>{health.telegram ? "подключён" : "не настроен (TELEGRAM_BOT_TOKEN)"}</dd>
                <dt className="text-ink-faint">Форматы</dt><dd>{health.formats.join(", ").toUpperCase()}</dd>
              </dl>
            )}
          </div>
          <div className="card p-6">
            <div className="h2">Доступ к API</div>
            <p className="meta mt-1">{health?.auth_required ? "Сервер требует токен для запуска аудитов и изменений." : "Сервер открыт: токен не требуется. Чтобы закрыть доступ, задайте LUMEN_API_TOKEN."}</p>
            <div className="mt-3 flex gap-2">
              <input className="input" type="password" placeholder="X-API-Token" value={token} onChange={(e) => setToken(e.target.value)} aria-label="Токен API" />
              <button className="btn-primary" onClick={saveToken}>{saved ? "Сохранено" : "Сохранить"}</button>
            </div>
          </div>
        </section>
      </div>
      {crit && (
        <section className="card mt-6 p-6">
          <div className="h2">Критерии проверки</div>
          <p className="meta mt-1">ISO/IEC/IEEE 29148:2018 п. 5.2.5–5.2.6 и IEEE Std 830-1998 п. 4.3; экспертные критерии LÜMEN отмечены отдельно.</p>
          <div className="mt-4 grid gap-x-8 gap-y-3 md:grid-cols-2">
            {[...crit.requirement, ...crit.set].map((c) => (
              <div key={c.key} className="text-sm">
                <span className="font-medium">{c.name}</span>{c.basis === "expert" && <span className="chip ml-2 bg-violet-wash text-violet">экспертный</span>}
                <div className="meta">{c.definition} {c.ref}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
