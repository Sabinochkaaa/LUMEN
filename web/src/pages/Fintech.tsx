import { AuditGate } from "../App";
import { Audit, FintechCheck, SEV_COLOR } from "../api";
import AuditHeader from "../components/AuditHeader";
import FindingCard from "../components/FindingCard";
import { SevBadge } from "../components/ui";

const ST: Record<FintechCheck["status"], { ru: string; c: string }> = {
  missing: { ru: "Не описано", c: "#D92D20" }, partial: { ru: "Описано частично", c: "#C99A06" },
  covered: { ru: "Описано", c: "#12A150" }, na: { ru: "Неприменимо", c: "#98A2B3" }, unknown: { ru: "Не оценено", c: "#98A2B3" },
};

export default function Fintech() {
  return <AuditGate>{(a) => <View a={a} />}</AuditGate>;
}

function View({ a }: { a: Audit }) {
  const order: FintechCheck["status"][] = ["missing", "partial", "covered", "unknown", "na"];
  const checks = [...a.fintech].sort((x, y) => order.indexOf(x.status) - order.indexOf(y.status));
  const fins = a.findings.filter((f) => f.criterion === "fintech");
  return (
    <div>
      <AuditHeader a={a} />
      <h2 className="text-xl font-semibold">LÜMEN Risk Engine</h2>
      <p className="meta mb-5 mt-1 max-w-3xl">
        Отраслевые проверки платёжных систем. Сначала оценивается, применим ли аспект к документу: неприменимое отмечается N/A и не считается
        дефектом. Это экспертные рекомендации, они отделены от нормативных замечаний по ISO/IEEE.
      </p>
      <div className="mb-6 flex flex-wrap gap-3">
        {order.map((s) => (
          <div key={s} className="card px-4 py-3">
            <div className="text-xl font-semibold tabular-nums" style={{ color: ST[s].c }}>{a.fintech.filter((c) => c.status === s).length}</div>
            <div className="meta">{ST[s].ru}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {checks.map((c) => (
          <div key={c.key} className={`card p-5 ${c.status === "na" ? "opacity-60" : ""}`} style={{ borderTop: `3px solid ${ST[c.status].c}` }}>
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium leading-snug">{c.aspect}</div>
              {c.status !== "na" && c.severity !== "INFO" && <SevBadge sev={c.severity} short />}
            </div>
            <div className="mt-1 text-[13px] font-medium" style={{ color: ST[c.status].c }}>{ST[c.status].ru}{c.applicable === "unknown" && c.status === "unknown" ? " · применимость не ясна" : ""}</div>
            {c.note && <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{c.note}</p>}
            {c.recommendation && <p className="mt-2 rounded-lg bg-canvas px-3 py-2 text-[13px]">{c.recommendation}</p>}
            {c.quote && <p className="mt-2 font-mono text-[12px] text-ink-soft">«{c.quote}»</p>}
            {c.req_ids.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{c.req_ids.slice(0, 6).map((r) => <span key={r} className="chip bg-canvas text-ink-soft">{r}</span>)}</div>}
          </div>
        ))}
      </div>
      {fins.length > 0 && (
        <>
          <div className="h2 mb-3 mt-8" style={{ color: SEV_COLOR.HIGH }}>Отраслевые риски, вынесенные в дефекты</div>
          <div className="space-y-3">{fins.map((f) => <FindingCard key={f.id} f={f} />)}</div>
        </>
      )}
    </div>
  );
}
