import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, MapPin } from "lucide-react";
import { Finding, SEV_COLOR } from "../api";
import { CRIT_I18N, pick, useT } from "../i18n";
import { SevBadge } from "./ui";

export default function FindingCard({ f, open: initial = false, onLocate }: { f: Finding; open?: boolean; onLocate?: (line: number) => void }) {
  const { t, lang } = useT();
  const [open, setOpen] = useState(initial);
  const where = f.loc
    ? `${t(f.loc.line_end !== f.loc.line_start ? "ui.lines" : "ui.line")} ${f.loc.line_start}${f.loc.line_end !== f.loc.line_start ? `–${f.loc.line_end}` : ""}${f.loc.page ? `, ${t("ui.page")} ${f.loc.page}` : ""}`
    : t("ui.wholeDoc");
  return (
    <motion.article layout className="card overflow-hidden" style={{ borderLeft: `3px solid ${SEV_COLOR[f.severity]}` }}>
      <button className="flex w-full items-start gap-3 px-5 py-4 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SevBadge sev={f.severity} />
            <span className="text-[12px] text-ink-faint tabular-nums">{f.id}</span>
            {f.status === "needs_review" && <span className="chip bg-warn/15 text-warn">{t("f.review")}</span>}
            {f.basis === "expert" && <span className="chip bg-violet/15 text-violet">{t("f.expert")}</span>}
          </div>
          <div className="mt-1.5 font-medium leading-snug">{f.title}</div>
          <div className="meta mt-1">
            {pick(CRIT_I18N[f.criterion], lang, f.criterion)} · {where}{f.req_ids.length ? ` · ${f.req_ids.slice(0, 4).join(", ")}` : ""}
          </div>
        </div>
        <ChevronDown size={18} className={`mt-1 shrink-0 text-ink-faint transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }} className="overflow-hidden">
            <div className="space-y-3 border-t border-line px-5 py-4 text-[14px] leading-relaxed">
              {f.quote && <blockquote className="whitespace-pre-wrap rounded-lg border-l-2 border-sky bg-sky/10 px-3 py-2 font-mono text-[12.5px]">{f.quote}</blockquote>}
              <Row k={t("f.problem")} v={f.problem} />
              <Row k={t("f.risk")} v={f.risk} />
              <Row k={t("f.fix")} v={f.fix} />
              {f.rewrite && (
                <div className="rounded-lg bg-ok/10 px-3 py-2">
                  <div className="text-[12px] font-medium text-ok">{t("f.rewrite")}</div>
                  <div className="mt-0.5">{f.rewrite}</div>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <span className="meta">
                  {f.standard_ref || "—"} · {t("f.source")}: {f.source === "llm" ? "LLM" : f.source === "rule" ? `${t("f.rule")} ${f.rule_id}` : `${t("f.rule")} + LLM`}
                  {f.confidence < 0.95 ? ` · ${t("f.confidence")} ${Math.round(f.confidence * 100)}%` : ""}
                </span>
                {f.loc && onLocate && <button className="btn-ghost px-2 py-1 text-[13px]" onClick={() => onLocate(f.loc!.line_start)}><MapPin size={14} />{t("f.locate")}</button>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  if (!v) return null;
  return (
    <div className="grid gap-1 sm:grid-cols-[140px_1fr]">
      <div className="text-ink-faint">{k}</div>
      <div>{v}</div>
    </div>
  );
}
