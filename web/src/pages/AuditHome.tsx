import { useMemo, useState } from "react";
import AuditBuddy from "../components/AuditBuddy";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AuditGate } from "../App";
import { Audit, Finding, SEV_COLOR, SEV_ORDER } from "../api";
import { CRIT_I18N, pick, useT } from "../i18n";
import AuditHeader from "../components/AuditHeader";
import DocumentLens from "../components/DocumentLens";
import FindingCard from "../components/FindingCard";
import { QualityArc, Stat, rise, stagger } from "../components/panelUi";

export default function AuditHome() {
  return <AuditGate>{(a) => <View a={a} />}</AuditGate>;
}

function View({ a }: { a: Audit }) {
  const { t, lang } = useT();
  const s = a.scores;
  const [lineHits, setLineHits] = useState<{ no: number; fs: Finding[] } | null>(null);
  const confirmed = a.findings.filter((f) => f.status === "confirmed");
  const sevData = SEV_ORDER.map((k) => ({ k, v: s.by_severity[k] }));
  const critData = useMemo(() => {
    const m = new Map<string, number>();
    confirmed.forEach((f) => m.set(f.criterion, (m.get(f.criterion) || 0) + 1));
    return [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => ({ k: pick(CRIT_I18N[k], lang, k), v }));
  }, [confirmed, lang]);
  const top = confirmed.filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH").slice(0, 6);
  const at = (n: number) => a.findings.filter((x) => x.loc && x.loc.line_start <= n && n <= x.loc.line_end);

  return (
    <div>
      <AuditHeader a={a} />
      <AuditBuddy a={a} page="home" />
      <motion.div variants={stagger} initial="hidden" animate="show">
        <motion.section variants={rise} className="card relative mb-6 grid gap-8 overflow-hidden p-6 md:grid-cols-[auto_1fr] md:p-8">
          <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full opacity-15 blur-3xl grad-bg" />
          <QualityArc value={s.quality_index} size={190} />
          <div className="relative min-w-0">
            <p className="text-[21px] font-medium leading-snug tracking-[-0.01em]">{a.readiness_reason}</p>
            <p className="meta mt-2 max-w-2xl">{t("home.summary", { r: s.total_requirements, f: s.findings_total })} {t("home.indexNote")}</p>
            {a.warnings.length > 0 && <ul className="mt-3 space-y-1 text-[13px] text-warn">{a.warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>}
          </div>
        </motion.section>
        <motion.div variants={rise} className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat value={s.total_requirements} label={t("home.reqs")} to={`/audits/${a.id}/requirements`} />
          <Stat value={s.by_severity.CRITICAL} label={t("home.crit")} tone={s.by_severity.CRITICAL ? SEV_COLOR.CRITICAL : undefined} to={`/audits/${a.id}/issues`} />
          <Stat value={s.by_severity.HIGH} label={t("home.high")} tone={s.by_severity.HIGH ? SEV_COLOR.HIGH : undefined} to={`/audits/${a.id}/issues`} />
          <Stat value={s.contradictions} label={t("home.contr")} to={`/audits/${a.id}/graph`} />
          <Stat value={s.open_questions} label={t("home.openQ")} tone="rgb(var(--violet))" to={`/audits/${a.id}/clarifications`} />
          <Stat value={Math.round(s.criteria_coverage * 100)} suffix="%" label={t("home.coverage")} />
        </motion.div>
        <motion.div variants={rise} className="mb-6 grid gap-6 lg:grid-cols-2">
          <div className="card p-6">
            <div className="h2 mb-4">{t("home.bySev")}</div>
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={sevData} margin={{ left: -24 }}>
                <XAxis dataKey="k" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "rgb(var(--ink-soft))" }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "rgb(var(--ink-faint))" }} />
                <Tooltip cursor={{ fill: "rgb(var(--ink) / .04)" }} contentStyle={{ background: "rgb(var(--surface))", border: "1px solid rgb(var(--line))", borderRadius: 12 }} formatter={(v: any) => [v, t("home.found")]} />
                <Bar dataKey="v" radius={[8, 8, 0, 0]} animationDuration={1100}>{sevData.map((d) => <Cell key={d.k} fill={SEV_COLOR[d.k]} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card p-6">
            <div className="h2 mb-4">{t("home.byCrit")}</div>
            <div className="space-y-2.5">
              {critData.map((d, i) => (
                <div key={d.k} className="grid grid-cols-[170px_1fr_28px] items-center gap-3 text-[13px]">
                  <span className="truncate text-ink-soft">{d.k}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-ink/5">
                    <motion.div className="h-2 rounded-full grad-bg" initial={{ width: 0 }} animate={{ width: `${(d.v / (critData[0]?.v || 1)) * 100}%` }} transition={{ duration: 0.9, delay: 0.05 * i }} />
                  </div>
                  <span className="text-right tabular-nums">{d.v}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
        <motion.div variants={rise} className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <div className="mb-3 flex items-baseline justify-between"><div className="h2">{t("home.lens")}</div><span className="meta">{t("home.lensHint")}</span></div>
            {a.source.length ? <DocumentLens lines={a.source} findings={confirmed} focusLine={lineHits?.no} onLine={(no, fs) => setLineHits({ no, fs })} height={520} />
              : <p className="meta">{t("home.noSource")}</p>}
          </div>
          <div>
            <div className="h2 mb-3">{lineHits ? t("home.lineN", { n: lineHits.no }) : t("home.fixFirst")}</div>
            <div className="space-y-3">
              {(lineHits ? lineHits.fs : top).map((f) => <FindingCard key={f.id} f={f} open={!!lineHits} onLocate={(n) => setLineHits({ no: n, fs: at(n) })} />)}
              {lineHits && <button className="btn-ghost" onClick={() => setLineHits(null)}>{t("home.backPrio")}</button>}
              {!lineHits && !top.length && <p className="meta">{t("home.noCrit")}</p>}
              {!lineHits && <Link to={`/audits/${a.id}/issues`} className="btn-line">{t("home.allIssues")} ({s.findings_total})</Link>}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
