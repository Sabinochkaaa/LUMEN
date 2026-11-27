import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import { api, AuditSummary } from "../api";
import { useT } from "../i18n";
import ReportLink from "../components/ReportLink";
import AgentBuddy from "../components/AgentBuddy";
import { useApp } from "../App";
import { Empty, ErrorBox, Loading, PageHead, ReadinessBadge, fmtDate, rise, stagger } from "../components/panelUi";

export default function Reports() {
  const { t, lang } = useT();
  const { admin } = useApp();
  const [items, setItems] = useState<AuditSummary[] | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const load = () => api.list().then((r) => setItems(r.items.filter((x) => !x.demo))).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const remove = async (id: string) => { try { await api.remove(id); setConfirm(null); load(); } catch (e: any) { setError(e.message); } };
  if (!items && !error) return <Loading />;
  return (
    <div>
      <PageHead title={t("rep.title")} sub={t("rep.sub")} />
      {items && (() => {
        const last = items[0];
        const notReady = items.filter((x) => x.readiness === "NOT READY").length;
        const avg = items.length ? Math.round(items.reduce((a, x) => a + (x.quality_index || 0), 0) / items.length) : 0;
        return (
          <AgentBuddy agent={4} mood={last ? "done" : "idle"}
            say={last ? t("buddy.repSay", { n: items.length, title: last.document_title || last.document_name, q: last.quality_index }) : t("buddy.repEmpty")}
            onPick={() => window.dispatchEvent(new Event("lumen:support"))}>
            {last && (
              <div className="flex flex-wrap gap-2 text-[12.5px]">
                <span className="rounded-full border border-line px-2.5 py-1">{t("buddy.repTotal", { n: items.length })}</span>
                <span className="rounded-full border border-line px-2.5 py-1">{t("buddy.repAvg", { n: avg })}</span>
                <span className="rounded-full border border-line px-2.5 py-1 text-bad">{t("buddy.repNot", { n: notReady })}</span>
                <span className="meta self-center">{t("buddy.repHint")}</span>
              </div>
            )}
          </AgentBuddy>
        );
      })()}
      {error && <div className="mb-4"><ErrorBox error={error} /></div>}
      {items && !items.length && <Empty title={t("rep.emptyT")} text={t("rep.emptyD")} action={<Link to="/new" className="btn-primary">{t("nav.new")}</Link>} />}
      <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-3">
        {items?.map((x) => (
          <motion.div variants={rise} key={x.id} className="card card-hover flex flex-wrap items-center gap-4 px-5 py-4">
            <div className="min-w-[240px] flex-1">
              <Link to={`/audits/${x.id}`} className="font-medium hover:text-signal">{x.document_title || x.document_name}</Link>
              <div className="meta mt-0.5">{x.document_name} · {fmtDate(x.analysed_at, lang)} · {x.model}</div>
            </div>
            <ReadinessBadge r={x.readiness} />
            <div className="text-right text-sm tabular-nums"><div className="font-semibold">{x.quality_index}</div><div className="meta">{x.requirements} {t("rep.req")} · {x.findings} {t("rep.find")}</div></div>
            <div className="flex flex-wrap items-center gap-1">
              {(["pdf", "docx", "xlsx", "html", "md", "json"] as const).map((f) => (
                <ReportLink key={f} className="btn-ghost px-2.5 py-1.5 text-[13px] uppercase" id={x.id} fmt={f} open={f === "pdf" || f === "html"}>{f === "docx" ? "Word" : f === "xlsx" ? "Excel" : f}</ReportLink>
              ))}
              {admin && (confirm === x.id ? (<>
                <button className="btn-ghost px-2.5 text-bad" onClick={() => remove(x.id)}>{t("rep.delete")}</button>
                <button className="btn-ghost px-2.5" onClick={() => setConfirm(null)}>{t("ui.cancel")}</button>
              </>) : <button className="btn-ghost px-2.5" onClick={() => setConfirm(x.id)} aria-label={t("rep.delete")}><Trash2 size={15} /></button>)}
            </div>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
