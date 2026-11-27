import { motion } from "framer-motion";
import AuditBuddy from "../components/AuditBuddy";
import { AuditGate } from "../App";
import { Audit, FintechCheck } from "../api";
import { useT } from "../i18n";
import AuditHeader from "../components/AuditHeader";
import FindingCard from "../components/FindingCard";
import { SevBadge, rise, stagger } from "../components/panelUi";

const ST: Record<FintechCheck["status"], string> = { missing: "bad", partial: "warn", covered: "ok", na: "ink-faint", unknown: "ink-faint" };

export default function Fintech() {
  return <AuditGate>{(a) => <View a={a} />}</AuditGate>;
}

function View({ a }: { a: Audit }) {
  const { t } = useT();
  const order: FintechCheck["status"][] = ["missing", "partial", "covered", "unknown", "na"];
  const checks = [...a.fintech].sort((x, y) => order.indexOf(x.status) - order.indexOf(y.status));
  const fins = a.findings.filter((f) => f.criterion === "fintech");
  return (
    <div>
      <AuditHeader a={a} />
      <AuditBuddy a={a} page="fintech" />
      <h2 className="text-xl font-semibold">{t("fin.title")}</h2>
      <p className="meta mb-5 mt-1 max-w-3xl">{t("fin.sub")}</p>
      <div className="mb-6 flex flex-wrap gap-3">
        {order.map((s) => (
          <div key={s} className="card px-4 py-3">
            <div className="text-xl font-semibold tabular-nums" style={{ color: `rgb(var(--${ST[s]}))` }}>{a.fintech.filter((c) => c.status === s).length}</div>
            <div className="meta">{t(`fin.${s}`)}</div>
          </div>
        ))}
      </div>
      <motion.div variants={stagger} initial="hidden" animate="show" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {checks.map((c) => (
          <motion.div variants={rise} key={c.key} className={`card card-hover p-5 ${c.status === "na" ? "opacity-60" : ""}`} style={{ borderTop: `3px solid rgb(var(--${ST[c.status]}))` }}>
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium leading-snug">{c.aspect}</div>
              {c.status !== "na" && c.severity !== "INFO" && <SevBadge sev={c.severity} short />}
            </div>
            <div className="mt-1 text-[13px] font-medium" style={{ color: `rgb(var(--${ST[c.status]}))` }}>{t(`fin.${c.status}`)}</div>
            {c.note && <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{c.note}</p>}
            {c.recommendation && <p className="mt-2 rounded-lg bg-ink/5 px-3 py-2 text-[13px]">{c.recommendation}</p>}
            {c.req_ids.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{c.req_ids.slice(0, 6).map((r) => <span key={r} className="chip bg-ink/5 text-ink-soft">{r}</span>)}</div>}
          </motion.div>
        ))}
      </motion.div>
      {fins.length > 0 && (<>
        <div className="h2 mb-3 mt-8">{t("fin.defects")}</div>
        <div className="space-y-3">{fins.map((f) => <FindingCard key={f.id} f={f} />)}</div>
      </>)}
    </div>
  );
}
