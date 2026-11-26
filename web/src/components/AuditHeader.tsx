import { NavLink } from "react-router-dom";
import { Download } from "lucide-react";
import { Audit } from "../api";
import { useT } from "../i18n";
import ReportLink from "./ReportLink";
import { CopyButton, ReadinessBadge, fmtDate } from "./ui";

const TABS = [["", "tab.summary"], ["requirements", "tab.requirements"], ["issues", "tab.issues"], ["graph", "tab.graph"],
  ["clarifications", "tab.questions"], ["fintech", "tab.fintech"], ["compare", "tab.compare"]] as const;

export default function AuditHeader({ a }: { a: Audit }) {
  const { t, lang } = useT();
  const p = a.passport;
  return (
    <div className="mb-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="h1 truncate">{p.document_title || p.document_name}</h1>
          <div className="meta mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{p.document_name}</span><span className="text-ink-faint">/</span><span>{fmtDate(p.analysed_at, lang)}</span>
            <span className="text-ink-faint">/</span><span>{p.model}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ReadinessBadge r={a.readiness} large />
          <ReportLink className="btn-primary" id={a.id} fmt="pdf" open><Download size={15} />PDF</ReportLink>
          <ReportLink className="btn-line hidden md:inline-flex" id={a.id} fmt="docx">Word</ReportLink>
          <ReportLink className="btn-line hidden md:inline-flex" id={a.id} fmt="xlsx">Excel</ReportLink>
          <ReportLink className="btn-line hidden lg:inline-flex" id={a.id} fmt="md">MD</ReportLink>
          <CopyButton text={window.location.origin + `/audits/${a.id}`} label={t("ui.share")} />
        </div>
      </div>
      <nav className="mt-6 flex gap-1 overflow-x-auto border-b border-line" aria-label={t("tab.summary")}>
        {TABS.map(([to, key]) => (
          <NavLink key={to} end to={`/audits/${a.id}${to ? "/" + to : ""}`}
            className={({ isActive }) => `relative -mb-px whitespace-nowrap px-3.5 py-2.5 text-sm transition-colors ${isActive ? "font-medium text-ink" : "text-ink-soft hover:text-ink"}`}>
            {({ isActive }) => (<>
              {t(key)}
              {to === "issues" && <span className="ml-1.5 text-ink-faint">{a.scores.findings_total}</span>}
              {to === "clarifications" && <span className="ml-1.5 text-ink-faint">{a.scores.open_questions}</span>}
              {isActive && <span className="absolute inset-x-2 -bottom-px h-[3px] rounded-full bg-marker" />}
            </>)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
