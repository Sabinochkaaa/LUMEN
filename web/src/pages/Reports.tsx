import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download, ExternalLink, Trash2 } from "lucide-react";
import { api, AuditSummary, MODE_RU } from "../api";
import { Empty, ErrorBox, Loading, PageHead, ReadinessBadge, fmtDate } from "../components/ui";

export default function Reports() {
  const [items, setItems] = useState<AuditSummary[] | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const load = () => api.list().then((r) => setItems(r.items)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const remove = async (id: string) => {
    try { await api.remove(id); setConfirm(null); load(); } catch (e: any) { setError(e.message); }
  };
  if (!items && !error) return <Loading />;
  return (
    <div>
      <PageHead title="Отчёты" sub="История прогонов. Каждый отчёт сформирован агентом и содержит паспорт прогона: модель, дату, версию и коммит." />
      {error && <div className="mb-4"><ErrorBox error={error} /></div>}
      {items && !items.length && <Empty title="Отчётов пока нет" text="Запустите аудит — отчёт в PDF, Word, Excel, Markdown, HTML и JSON появится здесь." action={<Link to="/new" className="btn-primary">Новый аудит</Link>} />}
      <div className="space-y-3">
        {items?.map((x) => (
          <div key={x.id} className="card flex flex-wrap items-center gap-4 px-5 py-4">
            <div className="min-w-[240px] flex-1">
              <Link to={`/audits/${x.id}`} className="font-medium hover:text-signal">{x.document_title || x.document_name}</Link>
              {x.demo && <span className="chip ml-2 bg-amber-50 text-amber-800">демо</span>}
              <div className="meta mt-0.5">{x.document_name} · {fmtDate(x.analysed_at)} · {x.model} · {MODE_RU[x.mode as keyof typeof MODE_RU] ?? x.mode}</div>
            </div>
            <ReadinessBadge r={x.readiness} />
            <div className="text-right text-sm tabular-nums"><div className="font-semibold">{x.quality_index}</div><div className="meta">{x.requirements} треб. · {x.findings} зам.</div></div>
            <div className="flex items-center gap-1">
              <a className="btn-ghost px-2.5" href={api.reportUrl(x.id, "md", true)} title="Скачать Markdown"><Download size={15} />MD</a>
              <a className="btn-ghost px-2.5" href={api.reportUrl(x.id, "html")} target="_blank" rel="noreferrer" title="Открыть HTML"><ExternalLink size={15} />HTML</a>
              <a className="btn-ghost px-2.5" href={api.reportUrl(x.id, "pdf")} target="_blank" rel="noreferrer" title="Открыть PDF">PDF</a>
              <a className="btn-ghost px-2.5" href={api.reportUrl(x.id, "docx", true)} title="Скачать Word">Word</a>
              <a className="btn-ghost px-2.5" href={api.reportUrl(x.id, "xlsx", true)} title="Скачать Excel">Excel</a>
              <a className="btn-ghost px-2.5" href={api.reportUrl(x.id, "json", true)} title="Скачать JSON">JSON</a>
              {confirm === x.id ? (
                <>
                  <button className="btn-ghost px-2.5 text-red-600" onClick={() => remove(x.id)}>Удалить навсегда</button>
                  <button className="btn-ghost px-2.5" onClick={() => setConfirm(null)}>Отмена</button>
                </>
              ) : <button className="btn-ghost px-2.5" onClick={() => setConfirm(x.id)} aria-label="Удалить"><Trash2 size={15} /></button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
