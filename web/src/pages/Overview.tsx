import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FileSearch, PlayCircle } from "lucide-react";
import { api, AuditSummary } from "../api";
import { Empty, ErrorBox, Loading, PageHead, ReadinessBadge, Stat, fmtDate } from "../components/ui";

export default function Overview() {
  const [items, setItems] = useState<AuditSummary[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.list().then((r) => setItems(r.items)).catch((e) => setError(e.message)); }, []);
  if (error) return <ErrorBox error={`Сервер LÜMEN недоступен: ${error}`} />;
  if (!items) return <Loading />;

  const real = items.filter((i) => !i.demo);
  const base = real.length ? real : items;
  const last = items[0];
  const avg = base.length ? base.reduce((s, x) => s + x.quality_index, 0) / base.length : 0;
  const trend = [...base].reverse().map((x) => ({ t: fmtDate(x.analysed_at), q: x.quality_index, name: x.document_name }));

  return (
    <div>
      <PageHead title="Обзор" sub="Качество документов требований, прошедших через LÜMEN Core."
        right={<Link to="/new" className="btn-primary"><FileSearch size={16} />Новый аудит</Link>} />
      {!items.length ? (
        <Empty title="Здесь появится история проверок"
          text="Загрузите первый документ требований или посмотрите демо-прогон, чтобы увидеть, как LÜMEN находит противоречия и формирует вопросы."
          action={<div className="flex gap-2"><Link to="/new" className="btn-primary">Загрузить документ</Link><Link to="/new" className="btn-line"><PlayCircle size={16} />Демо</Link></div>} />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat value={items.length} label={`аудитов${items.length !== real.length ? `, из них демо: ${items.length - real.length}` : ""}`} to="/reports" />
            <Stat value={base.reduce((s, x) => s + x.requirements, 0)} label="требований проверено" />
            <Stat value={avg.toFixed(1)} label="средний индекс качества" />
            <Stat value={base.reduce((s, x) => s + x.critical, 0)} label="критических дефектов найдено" tone="#D92D20" />
          </div>
          <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
            <Link to={`/audits/${last.id}`} className="card block p-6 transition-colors hover:border-signal/40">
              <div className="meta">Последний аудит, {fmtDate(last.analysed_at)}</div>
              <div className="mt-2 text-xl font-semibold leading-snug">{last.document_title || last.document_name}</div>
              <div className="mt-3"><ReadinessBadge r={last.readiness} /></div>
              <div className="mt-6 grid grid-cols-3 gap-4">
                <div><div className="text-2xl font-semibold tabular-nums">{last.quality_index}</div><div className="meta">индекс</div></div>
                <div><div className="text-2xl font-semibold tabular-nums">{last.findings}</div><div className="meta">замечаний</div></div>
                <div><div className="text-2xl font-semibold tabular-nums text-violet">{last.open_questions}</div><div className="meta">вопросов</div></div>
              </div>
            </Link>
            <div className="card p-6">
              <div className="h2 mb-4">Динамика индекса качества</div>
              {trend.length > 1 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={trend} margin={{ left: -20, right: 8 }}>
                    <CartesianGrid stroke="#EEF1F6" vertical={false} />
                    <XAxis dataKey="t" tick={{ fontSize: 11, fill: "#98A2B3" }} tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#98A2B3" }} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(v: any) => [v, "индекс"]} labelFormatter={(_l: any, p: any) => p?.[0]?.payload?.name ?? ""} />
                    <Line dataKey="q" stroke="#1F4FD8" strokeWidth={2.5} dot={{ r: 3.5, fill: "#1F4FD8" }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <p className="meta">Динамика появится после второго аудита — например, после исправления документа.</p>}
            </div>
          </div>
          <div className="card mt-6 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-canvas text-left text-ink-soft"><tr>
                <th className="px-5 py-3 font-medium">Документ</th><th className="px-3 font-medium">Готовность</th>
                <th className="px-3 text-right font-medium">Индекс</th><th className="hidden px-3 text-right font-medium md:table-cell">Требований</th>
                <th className="hidden px-3 text-right font-medium md:table-cell">Critical/High</th><th className="px-5 text-right font-medium">Дата</th>
              </tr></thead>
              <tbody>
                {items.slice(0, 8).map((x) => (
                  <tr key={x.id} className="border-t border-line hover:bg-canvas/60">
                    <td className="px-5 py-3"><Link className="font-medium hover:text-signal" to={`/audits/${x.id}`}>{x.document_title || x.document_name}</Link>{x.demo && <span className="chip ml-2 bg-amber-50 text-amber-800">демо</span>}</td>
                    <td className="px-3"><ReadinessBadge r={x.readiness} /></td>
                    <td className="px-3 text-right tabular-nums">{x.quality_index}</td>
                    <td className="hidden px-3 text-right tabular-nums md:table-cell">{x.requirements}</td>
                    <td className="hidden px-3 text-right tabular-nums md:table-cell">{x.critical}/{x.high}</td>
                    <td className="px-5 text-right meta">{fmtDate(x.analysed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
