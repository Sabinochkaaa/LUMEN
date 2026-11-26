// Typed client for the LÜMEN REST API.
export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
export type CritStatus = "ok" | "issue" | "na" | "unknown";
export type Readiness = "READY" | "READY WITH CONDITIONS" | "NOT READY" | "INSUFFICIENT DATA";

export interface Location { line_start: number; line_end: number; page?: number | null; section: string }
export interface Requirement {
  id: string; source_id?: string | null; source_id_kind: "explicit" | "derived" | "none"; section: string;
  part: string; loc: Location; quote: string; summary: string; type: string; context: string[];
}
export interface Finding {
  id: string; scope: "requirement" | "set"; req_ids: string[]; criterion: string; severity: Severity; title: string;
  quote: string; loc?: Location | null; problem: string; risk: string; fix: string; rewrite: string; source: string;
  rule_id: string; status: "confirmed" | "needs_review"; basis: "normative" | "expert"; standard_ref: string; confidence: number;
}
export interface Relation { source: string; target: string; type: string; status: "confirmed" | "needs_confirmation"; note: string; origin: string }
export interface Question {
  id: string; req_ids: string[]; question: string; why: string; risk: string; options: string[];
  status: "open" | "clarified" | "rejected"; answer: string; source: string; finding_ids: string[];
}
export interface FintechCheck {
  key: string; aspect: string; applicable: "yes" | "no" | "unknown"; status: "covered" | "partial" | "missing" | "na" | "unknown";
  note: string; req_ids: string[]; quote: string; severity: Severity; recommendation: string; source: string;
}
export interface Assessment { req_id: string; criteria: Record<string, CritStatus>; score: number; verdict: "pass" | "warn" | "fail" }
export interface StageEvent { index: number; total: number; key: string; title: string; status: "running" | "done" | "skipped" | "error"; message: string; elapsed_ms: number }
export interface Scores {
  quality_index: number; requirements_index: number; set_index: number; checked_requirements: number; total_requirements: number;
  findings_total: number; by_severity: Record<Severity, number>; contradictions: number; incomplete: number; unverifiable: number;
  ambiguous: number; open_questions: number; needs_review: number; criteria_coverage: number; method: string;
}
export interface Passport {
  document_name: string; document_title: string; document_format: string; document_sha256: string; analysed_at: string;
  provider: string; model: string; agent_version: string; agent_commit: string; mode: "llm" | "offline" | "mock";
  duration_s: number; llm_calls: number; llm_failures: number; tokens_in: number; tokens_out: number;
}
export interface Line { no: number; text: string; page?: number | null }
export interface Audit {
  id: string; passport: Passport; requirements: Requirement[]; assessments: Assessment[]; findings: Finding[];
  relations: Relation[]; questions: Question[]; fintech: FintechCheck[]; scores: Scores; readiness: Readiness;
  readiness_reason: string; priorities: string[]; stages: StageEvent[]; warnings: string[]; demo: boolean; source: Line[];
}
export interface AuditSummary {
  id: string; document_name: string; document_title: string; analysed_at: string; model: string; provider: string;
  mode: string; readiness: Readiness; quality_index: number; requirements: number; findings: number; critical: number;
  high: number; questions: number; open_questions: number; demo: boolean; duration_s: number;
}
export interface Health {
  status: string; version: string; commit: string; provider: string; provider_label: string; model: string;
  providers: Record<string, boolean>; storage: string; storage_degraded: boolean; auth_required: boolean; telegram: boolean; formats: string[];
  private_mode: boolean; public_demo: boolean; encryption: boolean;
}
export interface Criterion { key: string; name: string; ref: string; definition: string; basis: string }

const BASE = (import.meta as any).env?.VITE_API_URL ?? "";

function headers(): Record<string, string> {
  const t = localStorage.getItem("lumen.token");
  return t ? { "X-API-Token": t } : {};
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(BASE + path, { ...init, headers: { ...headers(), ...(init.headers || {}) } });
  if (!r.ok) {
    let msg = `Ошибка ${r.status}`;
    try { msg = (await r.json()).detail ?? msg; } catch { /* not json */ }
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return r.json();
}

export const api = {
  health: () => req<Health>("/api/health"),
  criteria: () => req<{ requirement: Criterion[]; set: Criterion[]; fintech: { key: string; name: string }[] }>("/api/criteria"),
  list: () => req<{ items: AuditSummary[]; running: { id: string; document_name: string; status: string }[] }>("/api/audits"),
  get: (id: string) => req<Audit>(`/api/audits/${id}`),
  remove: (id: string) => req(`/api/audits/${id}`, { method: "DELETE" }),
  upload: (file: File, provider?: string, model?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    if (provider) fd.append("provider", provider);
    if (model) fd.append("model", model);
    return req<{ audit_id: string }>("/api/audits", { method: "POST", body: fd });
  },
  demo: () => req<{ audit_id: string }>("/api/demo", { method: "POST" }),
  patchQuestion: (id: string, qid: string, body: { status?: string; answer?: string }) =>
    req<{ question: Question; scores: Scores; readiness: Readiness; readiness_reason: string }>(
      `/api/audits/${id}/questions/${qid}`,
      { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  reportUrl: (id: string, fmt: "md" | "html" | "json" | "pdf" | "docx" | "xlsx", download = false) =>
    `${BASE}/api/audits/${id}/report.${fmt}${download ? "?download=true" : ""}`,
  /** SSE over fetch: the token travels in a header, never in the URL (and so never in server logs). */
  events: (id: string, on: (type: string, data: any) => void): (() => void) => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch(`${BASE}/api/audits/${id}/events`, { headers: headers(), signal: ctrl.signal });
        if (!r.ok || !r.body) { on("error", { message: `Ошибка ${r.status}: нет доступа к прогрессу анализа` }); return; }
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            let type = "message", data = "";
            for (const line of chunk.split("\n")) {
              if (line.startsWith("event: ")) type = line.slice(7);
              else if (line.startsWith("data: ")) data += line.slice(6);
            }
            if (data) on(type, JSON.parse(data));
          }
        }
      } catch (e: any) { if (e?.name !== "AbortError") on("error", { message: "Соединение с сервером прервано" }); }
    })();
    return () => ctrl.abort();
  },
  /** Download a report through fetch (works in private mode, where plain links would get 401). */
  download: async (id: string, fmt: "md" | "html" | "json" | "pdf" | "docx" | "xlsx", name = "lumen_report") => {
    const r = await fetch(`${BASE}/api/audits/${id}/report.${fmt}?download=true`, { headers: headers() });
    if (!r.ok) throw new Error(`Не удалось скачать отчёт (${r.status})`);
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url; a.download = `${name}.${fmt}`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
};

export const SEV_ORDER: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
export const SEV_RU: Record<Severity, string> = { CRITICAL: "Критический", HIGH: "Высокий", MEDIUM: "Средний", LOW: "Низкий", INFO: "Инфо" };
export const SEV_COLOR: Record<Severity, string> = { CRITICAL: "#D92D20", HIGH: "#E8620C", MEDIUM: "#C99A06", LOW: "#3B82F6", INFO: "#98A2B3" };
export const READY_RU: Record<Readiness, { label: string; tone: string; hint: string }> = {
  "READY": { label: "Готов к разработке", tone: "ready", hint: "Блокирующих проблем нет" },
  "READY WITH CONDITIONS": { label: "Готов с условиями", tone: "cond", hint: "Нужны исправления и согласования" },
  "NOT READY": { label: "Не готов", tone: "not", hint: "Есть критические дефекты" },
  "INSUFFICIENT DATA": { label: "Недостаточно данных", tone: "none", hint: "Оценка ненадёжна" },
};
export const TYPE_RU: Record<string, string> = {
  functional: "Функциональное", nonfunctional: "Нефункциональное", acceptance: "Критерий приёмки", data: "Данные",
  integration: "Интеграция", api: "API-контракт", ui: "UI/UX", architecture: "Архитектура", business_goal: "Бизнес-цель",
  security: "Безопасность", testing: "Тестирование", other: "Прочее",
};
export const CRIT_RU: Record<string, string> = {
  unambiguous: "Однозначность", complete: "Полнота", verifiable: "Проверяемость", consistent: "Непротиворечивость",
  necessary: "Необходимость", singular: "Атомарность", feasible: "Реализуемость", traceable: "Прослеживаемость",
  correct: "Корректность", implementation_free: "Без проектных решений", inputs_defined: "Входные данные",
  outputs_defined: "Выходные данные", errors_defined: "Ошибки и исключения", acceptance: "Критерии приёмки",
  boundaries: "Граничные условия", set_complete: "Полнота набора", set_consistent: "Согласованность набора",
  set_feasible: "Реализуемость набора", set_comprehensible: "Понятность набора", set_validatable: "Валидируемость",
  ranked: "Ранжирование", modifiable: "Модифицируемость", set_traceable: "Прослеживаемость набора",
  terminology: "Терминология", integration_contract: "Интеграционные контракты", fintech: "FinTech-риск",
};
export const MODE_RU = { llm: "LLM + правила", offline: "Только правила", mock: "Демо" } as const;
