import { useMemo, useState } from "react";
import AuditBuddy from "../components/AuditBuddy";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Search } from "lucide-react";
import { AuditGate } from "../App";
import { Audit, CritStatus, SEV_COLOR, SEV_ORDER } from "../api";
import { CRIT_I18N, TYPE_I18N, pick, useT } from "../i18n";
import AuditHeader from "../components/AuditHeader";
import FindingCard from "../components/FindingCard";

const ST: Record<CritStatus, { c: string }> = { ok: { c: "var(--ok)" }, issue: { c: "var(--bad)" }, na: { c: "var(--ink-faint)" }, unknown: { c: "var(--line)" } };
const CRITS = ["unambiguous", "complete", "verifiable", "consistent", "necessary", "singular", "feasible", "traceable", "correct",
  "implementation_free", "inputs_defined", "outputs_defined", "errors_defined", "acceptance", "boundaries"];

export default function Requirements() {
  return <AuditGate>{(a) => <View a={a} />}</AuditGate>;
}

function View({ a }: { a: Audit }) {
  const { t, lang } = useT();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [mode, setMode] = useState<"list" | "matrix">("list");
  const sel = params.get("r") || a.requirements[0]?.id;
  const asm = useMemo(() => Object.fromEntries(a.assessments.map((x) => [x.req_id, x])), [a]);
  const findingsOf = (id: string) => a.findings.filter((f) => f.req_ids.includes(id));
  const types = [...new Set(a.requirements.map((r) => r.type))];
  const list = a.requirements.filter((r) => (!type || r.type === type) && (!q || (r.id + " " + (r.source_id || "") + " " + r.quote).toLowerCase().includes(q.toLowerCase())));
  const r = a.requirements.find((x) => x.id === sel);
  const chip = (st: CritStatus) => ({ color: st === "unknown" ? "rgb(var(--ink-faint))" : `rgb(${ST[st].c})`, background: `rgb(${ST[st].c} / ${st === "unknown" ? 0.3 : 0.12})`, borderColor: `rgb(${ST[st].c} / .35)` });

  return (
    <div>
      <AuditHeader a={a} />
      <AuditBuddy a={a} page="requirements" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input className="input pl-9" placeholder={t("ui.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">{t("req.allTypes")}</option>
          {types.map((x) => <option key={x} value={x}>{pick(TYPE_I18N[x], lang, x)}</option>)}
        </select>
        <div className="flex rounded-md border border-line bg-surface p-0.5">
          {(["list", "matrix"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`relative rounded-lg px-3 py-1.5 text-sm ${mode === m ? "text-white" : "text-ink-soft"}`}>
              {mode === m && <motion.span layoutId="req-mode" className="absolute inset-0 rounded-lg bg-primary" />}
              <span className="relative">{m === "list" ? t("req.cards") : t("req.matrix")}</span>
            </button>
          ))}
        </div>
      </div>
      {mode === "matrix" ? (
        <div className="card overflow-auto">
          <table className="text-[12.5px]">
            <thead><tr className="bg-ink/[0.03]">
              <th className="sticky left-0 bg-surface px-4 py-2 text-left font-medium">{t("req.requirement")}</th>
              <th className="px-2 font-medium">{t("ui.score")}</th>
              {CRITS.map((k) => <th key={k} className="px-1 py-2 font-medium text-ink-soft"><div className="w-[78px] leading-tight">{pick(CRIT_I18N[k], lang, k)}</div></th>)}
            </tr></thead>
            <tbody>
              {list.map((x, i) => (
                <motion.tr key={x.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.012 }} className="border-t border-line">
                  <td className="sticky left-0 bg-surface px-4 py-1.5"><button className="font-medium hover:text-signal" onClick={() => { setMode("list"); setParams({ r: x.id }); }}>{x.id}</button> <span className="text-ink-faint">{x.source_id_kind === "explicit" ? x.source_id : ""}</span></td>
                  <td className="px-2 text-center tabular-nums">{asm[x.id]?.score.toFixed(0)}</td>
                  {CRITS.map((k) => {
                    const st = asm[x.id]?.criteria[k] || "unknown";
                    return <td key={k} className="p-1"><div title={`${pick(CRIT_I18N[k], lang, k)}: ${t(`req.st.${st}`)}`} className="mx-auto h-5 w-[78px] rounded border" style={chip(st)} /></td>;
                  })}
                </motion.tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap gap-4 border-t border-line px-4 py-3 meta">
            {(Object.keys(ST) as CritStatus[]).map((k) => <span key={k} className="flex items-center gap-1.5"><span className="h-3 w-5 rounded border" style={chip(k)} />{t(`req.st.${k}`)}</span>)}
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <ul className="card max-h-[75vh] divide-y divide-line overflow-auto">
            {list.map((x) => {
              const fs = findingsOf(x.id).filter((f) => f.status === "confirmed");
              const worst = SEV_ORDER.find((s) => fs.some((f) => f.severity === s));
              return (
                <li key={x.id}>
                  <button onClick={() => setParams({ r: x.id })} className={`w-full px-4 py-3 text-left transition-colors ${sel === x.id ? "bg-signal/10" : "hover:bg-ink/[0.03]"}`}>
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className="font-semibold">{x.id}</span>
                      {x.source_id_kind === "explicit" && <span className="text-ink-soft">{x.source_id}</span>}
                      <span className="ml-auto flex items-center gap-1 text-ink-faint">{worst && <span className="h-2 w-2 rounded-full" style={{ background: SEV_COLOR[worst] }} />}{fs.length || ""}</span>
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[13.5px] text-ink-soft">{x.summary}</div>
                  </button>
                </li>
              );
            })}
            {!list.length && <li className="meta p-4">{t("ui.nothing")}</li>}
          </ul>
          {r && (
            <motion.div key={r.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="min-w-0 space-y-4">
              <div className="card p-6">
                <div className="flex flex-wrap items-baseline gap-3">
                  <h2 className="text-xl font-semibold">{r.id}</h2>
                  <span className="meta">{t("req.inDoc")}: {r.source_id_kind === "explicit" ? r.source_id : t("req.noId")}</span>
                  <span className="chip ml-auto bg-ink/5 text-ink-soft">{pick(TYPE_I18N[r.type], lang, r.type)}</span>
                </div>
                <div className="meta mt-1">{r.section} · {t("ui.lines")} {r.loc.line_start}–{r.loc.line_end}{r.loc.page ? ` · ${t("ui.page")} ${r.loc.page}` : ""} · {t("ui.score")} {asm[r.id]?.score.toFixed(0)}/100</div>
                <blockquote className="mt-4 whitespace-pre-wrap rounded-lg border-l-2 border-ink/25 bg-surface-2 px-4 py-3 font-mono text-[13px] leading-relaxed">{r.quote}</blockquote>
                <div className="mt-5 flex flex-wrap gap-1.5">
                  {CRITS.map((k) => <span key={k} className="chip border" style={chip(asm[r.id]?.criteria[k] || "unknown")}>{pick(CRIT_I18N[k], lang, k)}</span>)}
                </div>
              </div>
              <div className="h2">{t("req.findings")} ({findingsOf(r.id).length})</div>
              {findingsOf(r.id).map((f) => <FindingCard key={f.id} f={f} />)}
              {!findingsOf(r.id).length && <p className="meta">{t("req.clean")}</p>}
              {a.questions.some((x) => x.req_ids.includes(r.id)) && (
                <Link to={`/audits/${a.id}/clarifications`} className="btn-line">{t("req.questions")}: {a.questions.filter((x) => x.req_ids.includes(r.id)).length}</Link>
              )}
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}
