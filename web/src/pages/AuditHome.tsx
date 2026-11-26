import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AuditGate } from "../App";
import { Audit, CRIT_RU, Finding, SEV_COLOR, SEV_ORDER } from "../api";
import AuditHeader from "../components/AuditHeader";
import DocumentLens from "../components/DocumentLens";
import FindingCard from "../components/FindingCard";
import { QualityArc, Stat } from "../components/ui";

export default function AuditHome() {
  return <AuditGate>{(a) => <View a={a} />}</AuditGate>;
}

function View({ a }: { a: Audit }) {
  const s = a.scores;
  const [lineHits, setLineHits] = useState<{ no: number; fs: Finding[] } | null>(null);
  const confirmed = a.findings.filter((f) => f.status === "confirmed");
  const sevData = SEV_ORDER.map((k) => ({ k, v: s.by_severity[k] }));
  const critData = useMemo(() => {
    const m = new Map<string, number>();
    confirmed.forEach((f) => m.set(f.criterion, (m.get(f.criterion) || 0) + 1));
    return [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => ({ k: CRIT_RU[k] || k, v }));
  }, [confirmed]);
  const top = confirmed.filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH").slice(0, 6);

  return (
    <div>
      <AuditHeader a={a} />
      <section className="card mb-6 grid gap-8 p-6 md:grid-cols-[auto_1fr] md:p-8">
        <QualityArc value={s.quality_index} size={180} />
        <div className="min-w-0">
          <p className="text-[21px] font-medium leading-snug tracking-[-0.01em]">{a.readiness_reason}</p>
          <p className="meta mt-2 max-w-2xl">
            Выделено {s.total_requirements} требований, подтверждено {s.findings_total} замечаний. Индекс считается по прозрачной формуле
            из штрафов за дефекты (см. отчёт, приложение А) и не является официальной оценкой по ISO.
          </p>
          {a.warnings.length > 0 && (
            <ul className="mt-3 space-y-1 text-[13px] text-amber-800">{a.warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>
          )}
        </div>
      </section>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat value={s.total_requirements} label="требований" to={`/audits/${a.id}/requirements`} />
        <Stat value={s.by_severity.CRITICAL} label="критических" tone={s.by_severity.CRITICAL ? SEV_COLOR.CRITICAL : undefined} to={`/audits/${a.id}/issues`} />
        <Stat value={s.by_severity.HIGH} label="высокой критичности" tone={s.by_severity.HIGH ? SEV_COLOR.HIGH : undefined} to={`/audits/${a.id}/issues`} />
        <Stat value={s.contradictions} label="противоречий" to={`/audits/${a.id}/graph`} />
        <Stat value={s.open_questions} label="открытых вопросов" tone="#6D4AE0" to={`/audits/${a.id}/clarifications`} />
        <Stat value={`${Math.round(s.criteria_coverage * 100)}%`} label="покрытие критериев" />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <div className="card p-6">
          <div className="h2 mb-4">Дефекты по критичности</div>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={sevData} margin={{ left: -24 }}>
              <XAxis dataKey="k" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#475467" }} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#98A2B3" }} />
              <Tooltip cursor={{ fill: "#F3F5F9" }} formatter={(v: any) => [v, "замечаний"]} />
              <Bar dataKey="v" radius={[6, 6, 0, 0]}>{sevData.map((d) => <Cell key={d.k} fill={SEV_COLOR[d.k]} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card p-6">
          <div className="h2 mb-4">Какие свойства нарушены чаще</div>
          <div className="space-y-2.5">
            {critData.map((d) => (
              <div key={d.k} className="grid grid-cols-[170px_1fr_28px] items-center gap-3 text-[13px]">
                <span className="truncate text-ink-soft">{d.k}</span>
                <div className="h-2 rounded-full bg-canvas"><div className="h-2 rounded-full bg-signal" style={{ width: `${(d.v / (critData[0]?.v || 1)) * 100}%` }} /></div>
                <span className="text-right tabular-nums">{d.v}</span>
              </div>
            ))}
            {!critData.length && <p className="meta">Нарушений не найдено.</p>}
          </div>
        </div>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <div className="h2">Документ под линзой</div>
            <span className="meta">нажмите на отмеченную строку</span>
          </div>
          {a.source.length ? (
            <DocumentLens lines={a.source} findings={confirmed} focusLine={lineHits?.no} onLine={(no, fs) => setLineHits({ no, fs })} height={520} />
          ) : <p className="meta">Текст документа не сохранён в этом прогоне.</p>}
        </div>
        <div>
          <div className="h2 mb-3">{lineHits ? `Строка ${lineHits.no}` : "Исправить в первую очередь"}</div>
          <div className="space-y-3">
            {(lineHits ? lineHits.fs : top).map((f) => <FindingCard key={f.id} f={f} open={!!lineHits} onLocate={(n) => setLineHits({ no: n, fs: a.findings.filter((x) => x.loc && x.loc.line_start <= n && n <= x.loc.line_end) })} />)}
            {lineHits && <button className="btn-ghost" onClick={() => setLineHits(null)}>Вернуться к приоритетам</button>}
            {!lineHits && !top.length && <p className="meta">Критичных и существенных дефектов нет.</p>}
            {!lineHits && <Link to={`/audits/${a.id}/issues`} className="btn-line">Все дефекты ({s.findings_total})</Link>}
          </div>
        </div>
      </div>
    </div>
  );
}
