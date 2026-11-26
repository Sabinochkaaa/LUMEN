import { useState } from "react";
import { motion } from "framer-motion";
import { Check, X, RotateCcw } from "lucide-react";
import { AuditGate } from "../App";
import { api, Audit, Question } from "../api";
import AuditHeader from "../components/AuditHeader";
import { ErrorBox } from "../components/ui";

const ST = {
  open: { ru: "Открыт", c: "#6D4AE0", bg: "#F0EBFF" },
  clarified: { ru: "Уточнён", c: "#12A150", bg: "#E7F6EE" },
  rejected: { ru: "Отклонён", c: "#98A2B3", bg: "#F3F5F9" },
} as const;

export default function Clarifications() {
  return <AuditGate>{(a, set) => <View a={a} set={set} />}</AuditGate>;
}

function View({ a, set }: { a: Audit; set: (a: Audit) => void }) {
  const [filter, setFilter] = useState<"" | Question["status"]>("open");
  const [error, setError] = useState("");
  const list = a.questions.filter((q) => !filter || q.status === filter);
  const counts = { open: 0, clarified: 0, rejected: 0 } as Record<Question["status"], number>;
  a.questions.forEach((q) => counts[q.status]++);
  const done = a.questions.length ? Math.round(((counts.clarified + counts.rejected) / a.questions.length) * 100) : 0;

  const save = async (q: Question, body: { status?: string; answer?: string }) => {
    try {
      const r = await api.patchQuestion(a.id, q.id, body);
      set({ ...a, scores: r.scores, readiness: r.readiness, readiness_reason: r.readiness_reason,
        questions: a.questions.map((x) => (x.id === q.id ? r.question : x)) });
      setError("");
    } catch (e: any) { setError(e.message); }
  };

  return (
    <div>
      <AuditHeader a={a} />
      <div className="mb-5 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <h2 className="text-xl font-semibold">Вопросы к владельцу требований</h2>
          <p className="meta mt-1 max-w-2xl">
            LÜMEN Clarification Engine задаёт вопросы там, где по тексту нельзя однозначно понять поведение системы. Варианты — предложения для
            обсуждения, а не подтверждённые факты. Зафиксируйте ответ, и он попадёт в отчёт.
          </p>
        </div>
        <div className="w-full md:w-64">
          <div className="meta mb-1.5 flex justify-between"><span>Разобрано</span><span className="tabular-nums">{done}%</span></div>
          <div className="h-2 rounded-full bg-line"><motion.div className="h-2 rounded-full bg-violet" animate={{ width: `${done}%` }} /></div>
        </div>
      </div>
      <div className="mb-4 flex gap-1">
        {([["open", "Открытые"], ["clarified", "Уточнённые"], ["rejected", "Отклонённые"], ["", "Все"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={`rounded-lg px-3 py-1.5 text-sm ${filter === k ? "bg-violet-wash text-violet font-medium" : "text-ink-soft hover:bg-white"}`}>
            {l} <span className="text-ink-faint">{k ? counts[k] : a.questions.length}</span>
          </button>
        ))}
      </div>
      {error && <div className="mb-3"><ErrorBox error={error} /></div>}
      <div className="space-y-3">
        {list.map((q) => <QuestionCard key={q.id} q={q} onSave={(b) => save(q, b)} />)}
        {!list.length && <p className="meta py-6">{filter === "open" ? "Все вопросы разобраны." : "Вопросов в этом статусе нет."}</p>}
      </div>
    </div>
  );
}

function QuestionCard({ q, onSave }: { q: Question; onSave: (b: { status?: string; answer?: string }) => Promise<void> }) {
  const [answer, setAnswer] = useState(q.answer);
  const [busy, setBusy] = useState(false);
  const st = ST[q.status];
  const act = async (b: { status?: string; answer?: string }) => { setBusy(true); await onSave(b); setBusy(false); };
  return (
    <motion.article layout className="card p-5" style={{ borderLeft: `3px solid ${st.c}` }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip" style={{ background: st.bg, color: st.c }}>{st.ru}</span>
        <span className="text-[12px] text-ink-faint">{q.id}</span>
        {q.req_ids.map((r) => <span key={r} className="chip bg-canvas text-ink-soft">{r}</span>)}
        {q.finding_ids.length > 0 && <span className="meta">связано: {q.finding_ids.join(", ")}</span>}
      </div>
      <h3 className="mt-2 text-[16px] font-medium leading-snug">{q.question}</h3>
      <div className="mt-2 grid gap-1 text-[13.5px] sm:grid-cols-2 sm:gap-4">
        <p><span className="text-ink-faint">Зачем: </span>{q.why}</p>
        {q.risk && <p><span className="text-ink-faint">Риск без ответа: </span>{q.risk}</p>}
      </div>
      {q.options.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {q.options.map((o) => (
            <button key={o} onClick={() => setAnswer(o)} disabled={busy}
              className={`rounded-lg border px-3 py-1.5 text-[13px] transition-colors ${answer === o ? "border-violet bg-violet-wash text-violet" : "border-line hover:border-violet/50"}`}>{o}</button>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input className="input" placeholder="Ответ владельца требований" value={answer} onChange={(e) => setAnswer(e.target.value)} />
        <div className="flex gap-2">
          {q.status !== "clarified" && <button className="btn-primary whitespace-nowrap bg-violet hover:bg-violet/90" disabled={busy || !answer.trim()} onClick={() => act({ status: "clarified", answer })}><Check size={15} />Уточнить</button>}
          {q.status === "open" && <button className="btn-line whitespace-nowrap" disabled={busy} onClick={() => act({ status: "rejected", answer })}><X size={15} />Отклонить</button>}
          {q.status !== "open" && <button className="btn-ghost whitespace-nowrap" disabled={busy} onClick={() => act({ status: "open" })}><RotateCcw size={15} />Открыть снова</button>}
        </div>
      </div>
    </motion.article>
  );
}
