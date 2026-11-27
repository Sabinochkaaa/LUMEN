import { useState } from "react";
import AuditBuddy from "../components/AuditBuddy";
import { AnimatePresence, motion } from "framer-motion";
import { Check, RotateCcw, X } from "lucide-react";
import { AuditGate, useApp } from "../App";
import { api, Audit, canEdit, Question } from "../api";
import { useT } from "../i18n";
import AuditHeader from "../components/AuditHeader";
import { ErrorBox } from "../components/panelUi";

const TONE = { open: "violet", clarified: "ok", rejected: "ink-faint" } as const;

export default function Clarifications() {
  return <AuditGate>{(a, set) => <View a={a} set={set} />}</AuditGate>;
}

function View({ a, set }: { a: Audit; set: (a: Audit) => void }) {
  const { t } = useT();
  const [filter, setFilter] = useState<"" | Question["status"]>("open");
  const [error, setError] = useState("");
  const { admin } = useApp();
  const readOnly = !admin && !canEdit(a.id);
  const list = a.questions.filter((q) => !filter || q.status === filter);
  const counts = { open: 0, clarified: 0, rejected: 0 } as Record<Question["status"], number>;
  a.questions.forEach((q) => counts[q.status]++);
  const done = a.questions.length ? Math.round(((counts.clarified + counts.rejected) / a.questions.length) * 100) : 0;
  const save = async (q: Question, body: { status?: string; answer?: string }) => {
    try {
      const r = await api.patchQuestion(a.id, q.id, body);
      set({ ...a, scores: r.scores, readiness: r.readiness, readiness_reason: r.readiness_reason, questions: a.questions.map((x) => (x.id === q.id ? r.question : x)) });
      setError("");
    } catch (e: any) { setError(e.message); }
  };
  return (
    <div>
      <AuditHeader a={a} />
      <AuditBuddy a={a} page="clarifications" />
      <div className="mb-5 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <div><h2 className="text-xl font-semibold">{t("q.title")}</h2><p className="meta mt-1 max-w-2xl">{t("q.sub")}</p></div>
        <div className="w-full md:w-64">
          <div className="meta mb-1.5 flex justify-between"><span>{t("q.progress")}</span><span className="tabular-nums">{done}%</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-line"><motion.div className="h-2 rounded-full grad-bg" animate={{ width: `${done}%` }} /></div>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-1">
        {([["open", "q.open"], ["clarified", "q.clarified"], ["rejected", "q.rejected"], ["", "ui.all"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={`relative rounded-lg px-3 py-1.5 text-sm ${filter === k ? "font-medium text-violet" : "text-ink-soft hover:text-ink"}`}>
            {filter === k && <motion.span layoutId="q-filter" className="absolute inset-0 rounded-lg bg-violet/15" />}
            <span className="relative">{t(l)} <span className="text-ink-faint">{k ? counts[k] : a.questions.length}</span></span>
          </button>
        ))}
      </div>
      {readOnly && <p className="meta mb-3 rounded-lg border border-line px-3 py-2">{t("q.readOnly")}</p>}
      {error && <div className="mb-3"><ErrorBox error={error} /></div>}
      <div className="space-y-3">
        <AnimatePresence mode="popLayout">{list.map((q) => <QuestionCard key={q.id} q={q} onSave={(b) => save(q, b)} />)}</AnimatePresence>
        {!list.length && <p className="meta py-6">{filter === "open" ? t("q.allDone") : t("q.none")}</p>}
      </div>
    </div>
  );
}

function QuestionCard({ q, onSave }: { q: Question; onSave: (b: { status?: string; answer?: string }) => Promise<void> }) {
  const { t } = useT();
  const [answer, setAnswer] = useState(q.answer);
  const [busy, setBusy] = useState(false);
  const tone = TONE[q.status];
  const act = async (b: { status?: string; answer?: string }) => { setBusy(true); await onSave(b); setBusy(false); };
  return (
    <motion.article layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }}
      className="card p-5" style={{ borderLeft: `3px solid rgb(var(--${tone}))` }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip" style={{ background: `rgb(var(--${tone}) / .14)`, color: `rgb(var(--${tone}))` }}>{t(`q.st.${q.status}`)}</span>
        <span className="text-[12px] text-ink-faint">{q.id}</span>
        {q.req_ids.map((r) => <span key={r} className="chip bg-ink/5 text-ink-soft">{r}</span>)}
        {q.finding_ids.length > 0 && <span className="meta">{t("q.related")}: {q.finding_ids.join(", ")}</span>}
      </div>
      <h3 className="mt-2 text-[16px] font-medium leading-snug">{q.question}</h3>
      <div className="mt-2 grid gap-1 text-[13.5px] sm:grid-cols-2 sm:gap-4">
        <p><span className="text-ink-faint">{t("q.why")}: </span>{q.why}</p>
        {q.risk && <p><span className="text-ink-faint">{t("q.risk")}: </span>{q.risk}</p>}
      </div>
      {q.options.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {q.options.map((o) => (
            <motion.button whileTap={{ scale: 0.96 }} key={o} onClick={() => setAnswer(o)} disabled={busy}
              className={`rounded-lg border px-3 py-1.5 text-[13px] transition-colors ${answer === o ? "border-violet bg-violet/15 text-violet" : "border-line hover:border-violet/50"}`}>{o}</motion.button>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input className="input" placeholder={t("q.answer")} value={answer} onChange={(e) => setAnswer(e.target.value)} />
        <div className="flex gap-2">
          {q.status !== "clarified" && <button className="btn-primary whitespace-nowrap" disabled={busy || !answer.trim()} onClick={() => act({ status: "clarified", answer })}><Check size={15} />{t("q.clarify")}</button>}
          {q.status === "open" && <button className="btn-line whitespace-nowrap" disabled={busy} onClick={() => act({ status: "rejected", answer })}><X size={15} />{t("q.reject")}</button>}
          {q.status !== "open" && <button className="btn-ghost whitespace-nowrap" disabled={busy} onClick={() => act({ status: "open" })}><RotateCcw size={15} />{t("q.reopen")}</button>}
        </div>
      </div>
    </motion.article>
  );
}
