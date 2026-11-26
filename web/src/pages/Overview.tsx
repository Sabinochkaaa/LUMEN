import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FileSearch } from "lucide-react";
import { api, AuditSummary } from "../api";
import { useT } from "../i18n";
import { Empty, ErrorBox, Loading, Num, PageHead, ReadinessBadge, Stat, fmtDate, rise, stagger } from "../components/ui";

export default function Overview() {
  const { t, lang } = useT();
  const [items, setItems] = useState<AuditSummary[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.list().then((r) => setItems(r.items.filter((x) => !x.demo))).catch((e) => setError(e.message)); }, []);
  if (error) return <ErrorBox error={`${t("status.offline")}: ${error}`} />;
  if (!items) return <Loading />;
  const last = items[0];
  const avg = items.length ? items.reduce((s, x) => s + x.quality_index, 0) / items.length : 0;
  const trend = [...items].reverse().map((x) => ({ t: fmtDate(x.analysed_at, lang), q: x.quality_index, name: x.document_name }));

  return (
    <div>
      <PageHead title={t("ov.title")} sub={t("ov.sub")} right={<Link to="/new" className="btn-primary"><FileSearch size={16} />{t("nav.new")}</Link>} />
      {!items.length ? (
        <Empty title={t("ov.emptyT")} text={t("ov.emptyD")} action={<Link to="/new" className="btn-primary">{t("land.cta")}</Link>} />
      ) : (
        <motion.div variants={stagger} initial="hidden" animate="show">
          <motion.div variants={rise} className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat value={items.length} label={t("ov.audits")} to="/reports" />
            <Stat value={items.reduce((s, x) => s + x.requirements, 0)} label={t("ov.reqs")} />
            <Stat value={avg} decimals={1} label={t("ov.avg")} />
            <Stat value={items.reduce((s, x) => s + x.critical, 0)} label={t("ov.crit")} tone="#E5484D" />
          </motion.div>
          <motion.div variants={rise} className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
            <Link to={`/audits/${last.id}`} className="card card-hover relative block overflow-hidden p-6">
              <div className="meta">{t("ov.last")} · {fmtDate(last.analysed_at, lang)}</div>
              <div className="mt-2 text-xl font-semibold leading-snug">{last.document_title || last.document_name}</div>
              <div className="mt-3"><ReadinessBadge r={last.readiness} /></div>
              <div className="mt-6 grid grid-cols-3 gap-4">
                <div><div className="text-2xl font-semibold grad-text"><Num value={last.quality_index} decimals={1} /></div><div className="meta">{t("ov.index")}</div></div>
                <div><div className="text-2xl font-semibold"><Num value={last.findings} /></div><div className="meta">{t("ov.findings")}</div></div>
                <div><div className="text-2xl font-semibold text-violet"><Num value={last.open_questions} /></div><div className="meta">{t("ov.questions")}</div></div>
              </div>
            </Link>
            <div className="card p-6">
              <div className="h2 mb-4">{t("ov.trend")}</div>
              {trend.length > 1 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={trend} margin={{ left: -20, right: 8 }}>
                    <defs><linearGradient id="q" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgb(var(--violet))" stopOpacity={0.4} /><stop offset="1" stopColor="rgb(var(--signal))" stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid stroke="rgb(var(--line))" vertical={false} />
                    <XAxis dataKey="t" tick={{ fontSize: 11, fill: "rgb(var(--ink-faint))" }} tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "rgb(var(--ink-faint))" }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ background: "rgb(var(--surface))", border: "1px solid rgb(var(--line))", borderRadius: 12 }} formatter={(v: any) => [v, t("ov.index")]} labelFormatter={(_l: any, p: any) => p?.[0]?.payload?.name ?? ""} />
                    <Area dataKey="q" stroke="rgb(var(--signal))" strokeWidth={2.5} fill="url(#q)" dot={{ r: 3.5, fill: "rgb(var(--signal))" }} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <p className="meta">{t("ov.trendEmpty")}</p>}
            </div>
          </motion.div>
          <motion.div variants={rise} className="card mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink/[0.03] text-left text-ink-soft"><tr>
                <th className="px-5 py-3 font-medium">{t("ov.colDoc")}</th><th className="px-3 font-medium">{t("ov.colReady")}</th>
                <th className="px-3 text-right font-medium">{t("ov.colIndex")}</th><th className="hidden px-3 text-right font-medium md:table-cell">{t("ov.colReqs")}</th>
                <th className="hidden px-3 text-right font-medium md:table-cell">Critical / High</th><th className="px-5 text-right font-medium">{t("ov.colDate")}</th>
              </tr></thead>
              <tbody>
                {items.slice(0, 8).map((x) => (
                  <tr key={x.id} className="border-t border-line transition-colors hover:bg-ink/[0.03]">
                    <td className="px-5 py-3"><Link className="font-medium hover:text-signal" to={`/audits/${x.id}`}>{x.document_title || x.document_name}</Link></td>
                    <td className="px-3"><ReadinessBadge r={x.readiness} /></td>
                    <td className="px-3 text-right tabular-nums">{x.quality_index}</td>
                    <td className="hidden px-3 text-right tabular-nums md:table-cell">{x.requirements}</td>
                    <td className="hidden px-3 text-right tabular-nums md:table-cell">{x.critical} / {x.high}</td>
                    <td className="px-5 text-right meta">{fmtDate(x.analysed_at, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}
