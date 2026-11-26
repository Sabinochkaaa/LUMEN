import { NavLink } from "react-router-dom";
import { Download } from "lucide-react";
import { api, Audit, MODE_RU } from "../api";
import { ReadinessBadge, fmtDate } from "./ui";

const TABS = [
  ["", "Сводка"], ["requirements", "Требования"], ["issues", "Дефекты"], ["graph", "Граф"],
  ["clarifications", "Вопросы"], ["fintech", "FinTech"],
] as const;

export default function AuditHeader({ a, title }: { a: Audit; title?: string }) {
  const p = a.passport;
  return (
    <div className="mb-6">
      {a.demo && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          Демонстрационный прогон: документ и ответы модели подготовлены для показа. Это не проверка документа организаторов.
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="h1 truncate">{title ?? (p.document_title || p.document_name)}</h1>
          <div className="meta mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{p.document_name}</span><span>{fmtDate(p.analysed_at)}</span>
            <span>{p.model}</span><span>{MODE_RU[p.mode]}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ReadinessBadge r={a.readiness} large />
          <a className="btn-line" href={api.reportUrl(a.id, "md", true)}><Download size={15} />Отчёт .md</a>
          <a className="btn-line hidden sm:inline-flex" href={api.reportUrl(a.id, "pdf")} target="_blank" rel="noreferrer">PDF</a>
          <a className="btn-line hidden md:inline-flex" href={api.reportUrl(a.id, "docx", true)}>Word</a>
          <a className="btn-line hidden md:inline-flex" href={api.reportUrl(a.id, "xlsx", true)}>Excel</a>
        </div>
      </div>
      <nav className="mt-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Разделы аудита">
        {TABS.map(([to, label]) => (
          <NavLink key={to} end to={`/audits/${a.id}${to ? "/" + to : ""}`}
            className={({ isActive }) => `-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm transition-colors ${isActive ? "border-signal font-medium text-signal" : "border-transparent text-ink-soft hover:text-ink"}`}>
            {label}
            {to === "issues" && <span className="ml-1.5 text-ink-faint">{a.scores.findings_total}</span>}
            {to === "clarifications" && <span className="ml-1.5 text-ink-faint">{a.scores.open_questions}</span>}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
