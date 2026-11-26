import { useMemo, useState } from "react";
import AuditBuddy from "../components/AuditBuddy";
import { AuditGate } from "../App";
import { Audit, SEV_COLOR, SEV_ORDER, Severity } from "../api";
import { CRIT_I18N, pick, useT } from "../i18n";
import AuditHeader from "../components/AuditHeader";
import DocumentLens from "../components/DocumentLens";
import FindingCard from "../components/FindingCard";

export default function Issues() {
  return <AuditGate>{(a) => <View a={a} />}</AuditGate>;
}

function View({ a }: { a: Audit }) {
  const { t, lang } = useT();
  const [sev, setSev] = useState<Set<Severity>>(new Set(SEV_ORDER));
  const [scope, setScope] = useState<"" | "requirement" | "set">("");
  const [crit, setCrit] = useState("");
  const [review, setReview] = useState(true);
  const [line, setLine] = useState<number | null>(null);
  const crits = useMemo(() => [...new Set(a.findings.map((f) => f.criterion))], [a]);
  const list = a.findings.filter((f) => sev.has(f.severity) && (!scope || f.scope === scope) && (!crit || f.criterion === crit) && (review || f.status === "confirmed"));
  const toggle = (s: Severity) => { const n = new Set(sev); n.has(s) ? n.delete(s) : n.add(s); setSev(n); };
  return (
    <div>
      <AuditHeader a={a} />
      <AuditBuddy a={a} page="issues" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {SEV_ORDER.map((s) => (
          <button key={s} onClick={() => toggle(s)} aria-pressed={sev.has(s)} className="chip border px-3 py-1 text-[13px] transition-all"
            style={sev.has(s) ? { background: SEV_COLOR[s] + "22", color: SEV_COLOR[s], borderColor: SEV_COLOR[s] + "66" } : { color: "rgb(var(--ink-faint))", borderColor: "rgb(var(--line))" }}>
            {s} {a.findings.filter((f) => f.severity === s).length}
          </button>
        ))}
        <select className="input w-auto" value={scope} onChange={(e) => setScope(e.target.value as any)}>
          <option value="">{t("iss.allLevels")}</option><option value="requirement">{t("iss.req")}</option><option value="set">{t("iss.set")}</option>
        </select>
        <select className="input w-auto" value={crit} onChange={(e) => setCrit(e.target.value)}>
          <option value="">{t("iss.allCrit")}</option>
          {crits.map((c) => <option key={c} value={c}>{pick(CRIT_I18N[c], lang, c)}</option>)}
        </select>
        <label className="meta ml-auto flex items-center gap-2"><input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} />{t("iss.showReview")}</label>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-3">
          <div className="meta">{t("iss.shown", { a: list.length, b: a.findings.length })}</div>
          {list.map((f) => <FindingCard key={f.id} f={f} onLocate={setLine} />)}
        </div>
        <div className="hidden xl:block"><div className="sticky top-6"><DocumentLens lines={a.source} findings={list} focusLine={line} onLine={(n) => setLine(n)} height="calc(100vh - 120px)" dim /></div></div>
      </div>
    </div>
  );
}
