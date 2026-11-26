import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, MapPin } from "lucide-react";
import { CRIT_RU, Finding, SEV_COLOR } from "../api";
import { SevBadge } from "./ui";

export default function FindingCard({ f, open: initial = false, onLocate }: { f: Finding; open?: boolean; onLocate?: (line: number) => void }) {
  const [open, setOpen] = useState(initial);
  const where = f.loc ? `строка ${f.loc.line_start}${f.loc.line_end !== f.loc.line_start ? `–${f.loc.line_end}` : ""}${f.loc.page ? `, стр. ${f.loc.page}` : ""}` : "документ в целом";
  return (
    <article className="card overflow-hidden" style={{ borderLeft: `3px solid ${SEV_COLOR[f.severity]}` }}>
      <button className="flex w-full items-start gap-3 px-5 py-4 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SevBadge sev={f.severity} />
            <span className="text-[12px] text-ink-faint tabular-nums">{f.id}</span>
            {f.status === "needs_review" && <span className="chip bg-amber-50 text-amber-800">требует проверки</span>}
            {f.basis === "expert" && <span className="chip bg-violet-wash text-violet">экспертное</span>}
          </div>
          <div className="mt-1.5 font-medium leading-snug">{f.title}</div>
          <div className="meta mt-1">
            {CRIT_RU[f.criterion] || f.criterion} · {where}{f.req_ids.length ? ` · ${f.req_ids.slice(0, 4).join(", ")}` : ""}
          </div>
        </div>
        <ChevronDown size={18} className={`mt-1 shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }} className="overflow-hidden">
            <div className="space-y-3 border-t border-line px-5 py-4 text-[14px] leading-relaxed">
              {f.quote && (
                <blockquote className="whitespace-pre-wrap rounded-lg border-l-2 border-sky bg-sky-wash px-3 py-2 font-mono text-[12.5px] text-ink/90">{f.quote}</blockquote>
              )}
              <Row k="Что не так" v={f.problem} />
              <Row k="Риск" v={f.risk} />
              <Row k="Как исправить" v={f.fix} />
              {f.rewrite && (
                <div className="rounded-lg bg-emerald-50 px-3 py-2">
                  <div className="text-[12px] font-medium text-emerald-700">Улучшенная формулировка</div>
                  <div className="mt-0.5 text-emerald-900">{f.rewrite}</div>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <span className="meta">
                  {f.standard_ref || "—"} · источник: {f.source === "llm" ? "LLM" : f.source === "rule" ? `правило ${f.rule_id}` : "правило + LLM"}
                  {f.confidence < 0.95 ? ` · уверенность ${Math.round(f.confidence * 100)}%` : ""}
                </span>
                {f.loc && onLocate && (
                  <button className="btn-ghost px-2 py-1 text-[13px]" onClick={() => onLocate(f.loc!.line_start)}><MapPin size={14} />Показать в документе</button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  if (!v) return null;
  return (
    <div className="grid gap-1 sm:grid-cols-[130px_1fr]">
      <div className="text-ink-faint">{k}</div>
      <div>{v}</div>
    </div>
  );
}
