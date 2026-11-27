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
export interface Ticket {
  id: string; at: string; channel: string; message: string; contact?: string; audit_id?: string;
  history?: { role: string; text: string }[]; status?: string;
}
export interface AuditSummary {
  id: string; document_name: string; document_title: string; analysed_at: string; model: string; provider: string;
  mode: string; readiness: Readiness; quality_index: number; requirements: number; findings: number; critical: number;
  high: number; questions: number; open_questions: number; demo: boolean; duration_s: number;
}
export interface Health {
  status: string; version: string; commit: string; provider: string; provider_label: string; model: string;
  providers: Record<string, boolean>; storage: string; storage_degraded: boolean; storage_error?: string | null; storage_key?: string | null; auth_required: boolean; telegram: boolean; formats: string[];
  private_mode: boolean; public_demo: boolean; encryption: boolean; public_audits: boolean; login_enabled: boolean;
}
export interface CmpItem { id: string; severity: Severity; title: string; criterion: string; where: string }
export interface CompareSide { id: string; document: string; analysed_at: string; quality_index: number; readiness: Readiness; findings: number; requirements: number }
export interface CompareResult { base: CompareSide; new: CompareSide; delta_quality: number; fixed: CmpItem[]; added: CmpItem[]; remaining: CmpItem[]; critical_fixed: number; critical_added: number }
export interface Criterion { key: string; name: string; ref: string; definition: string; basis: string }

export interface SupportReply { answer: string; source: "llm" | "faq"; escalate: boolean; suggestions: string[] }
export interface ChatTurn { role: "user" | "agent"; text: string }

export interface OverlayBox { x: number; y: number; w: number; h: number; text: string; orig: string }
export interface TranslationResult {
  source_name: string; target: string; markdown: string; chunks: number; model: string; provider: string;
  source_text?: string; overlay?: { width: number; height: number; boxes: OverlayBox[] } | null; warnings?: string[];
}

const BASE = (import.meta as any).env?.VITE_API_URL ?? "";

/** Admin auth is an HttpOnly session cookie (never readable by JS); this header proves the request comes from our UI. */
function headers(): Record<string, string> {
  return { "X-Requested-With": "lumen" };
}

/** Edit key from the upload response: lets this browser answer the audit's questions (others only read). */
const EDIT = "lumen.edit.";
function keep(r: { audit_id: string; edit_key?: string }) {
  try { if (r.edit_key) localStorage.setItem(EDIT + r.audit_id, r.edit_key); } catch { /* storage disabled */ }
  return r;
}
export function canEdit(id: string): boolean {
  try { return !!localStorage.getItem(EDIT + id); } catch { return false; }
}
function editHeader(id: string): Record<string, string> {
  try { const k = localStorage.getItem(EDIT + id); return k ? { "X-Edit-Key": k } : {}; } catch { return {}; }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(BASE + path, { ...init, headers: { ...headers(), ...(init.headers || {}) } });
  if (!r.ok) {
    let msg = `Ошибка ${r.status}`;
    try { msg = (await r.json()).detail ?? msg; } catch { /* not json */ }
    const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    (err as Error & { status?: number }).status = r.status;
    throw err;
  }
  return r.json();
}

export const api = {
  health: () => req<Health>("/api/health"),
  me: () => req<{ admin: boolean; login_enabled: boolean; public_audits: boolean }>("/api/auth/me"),
  login: (password: string) => req<{ admin: boolean }>("/api/auth/login", { method: "POST", body: JSON.stringify({ password }), headers: { "content-type": "application/json" } }),
  logout: () => req<{ admin: boolean }>("/api/auth/logout", { method: "POST" }),
  criteria: () => req<{ requirement: Criterion[]; set: Criterion[]; fintech: { key: string; name: string }[] }>("/api/criteria"),
  list: () => req<{ items: AuditSummary[]; running: { id: string; document_name: string; status: string }[] }>("/api/audits"),
  get: (id: string) => req<Audit>(`/api/audits/${id}`),
  remove: (id: string) => req(`/api/audits/${id}`, { method: "DELETE" }),
  upload: (file: File, provider?: string, model?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    if (provider) fd.append("provider", provider);
    if (model) fd.append("model", model);
    return req<{ audit_id: string; edit_key?: string }>("/api/audits", { method: "POST", body: fd }).then(keep);
  },
  support: (message: string, history: ChatTurn[], lang: string, audit_id?: string) =>
    req<SupportReply>("/api/support", { method: "POST", body: JSON.stringify({ message, history, lang, audit_id }),
      headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(25000) }),
  ticket: (message: string, contact: string, history: ChatTurn[], audit_id?: string) =>
    req<{ id: string; ok: boolean }>("/api/support/ticket", { method: "POST", body: JSON.stringify({ message, contact, history, audit_id }),
      headers: { "content-type": "application/json" } }),
  demo: () => req<{ audit_id: string; edit_key?: string }>("/api/demo", { method: "POST" }).then(keep),
  compare: (base: string, next: string) => req<CompareResult>(`/api/compare?base=${base}&new=${next}`),
  translate: (file: File, target: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("target", target);
    return req<TranslationResult>("/api/translate", { method: "POST", body: fd });
  },
  tickets: () => req<{ items: Ticket[] }>("/api/support/tickets"),
  generate: (idea: string, lang: string) =>
    req<{ title: string; markdown: string }>("/api/generate", { method: "POST", body: JSON.stringify({ idea, lang }),
      headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(180000) }),
  translationDocx: async (markdown: string, name: string) => {
    const r = await fetch(`${BASE}/api/translate/docx`, { method: "POST", headers: { ...headers(), "content-type": "application/json" }, body: JSON.stringify({ markdown, title: name }) });
    if (!r.ok) throw new Error(`Ошибка ${r.status}`);
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a"); a.href = url; a.download = `${name}.docx`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
  patchQuestion: (id: string, qid: string, body: { status?: string; answer?: string }) =>
    req<{ question: Question; scores: Scores; readiness: Readiness; readiness_reason: string }>(
      `/api/audits/${id}/questions/${qid}`,
      { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json", ...editHeader(id) } }),
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
// design 2.0: muted severity palette (docs/DESIGN.md §3) — keep in sync with tailwind.config.js `sev`
export const SEV_COLOR: Record<Severity, string> = { CRITICAL: "#C53030", HIGH: "#D9622B", MEDIUM: "#B7791F", LOW: "#2B6CB0", INFO: "#718096" };
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
