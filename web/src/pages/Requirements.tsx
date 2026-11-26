import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { AuditGate } from "../App";
import { Audit, CRIT_RU, CritStatus, SEV_COLOR, SEV_ORDER, TYPE_RU } from "../api";
import AuditHeader from "../components/AuditHeader";
import FindingCard from "../components/FindingCard";

const ST: Record<CritStatus, { t: string; c: string; bg: string }> = {
  ok: { t: "выполнено", c: "#12A150", bg: "#E7F6EE" }, issue: { t: "дефект", c: "#D92D20", bg: "#FDECEA" },
  na: { t: "неприменимо", c: "#98A2B3", bg: "#F3F5F9" }, unknown: { t: "не оценено", c: "#98A2B3", bg: "#FFFFFF" },
};
const CRITS = ["unambiguous", "complete", "verifiable", "consistent", "necessary", "singular", "feasible", "traceable", "correct",
  "implementation_free", "inputs_defined", "outputs_defined", "errors_defined", "acceptance", "boundaries"];

export default function Requirements() {
  return <AuditGate>{(a) => <View a={a} />}</AuditGate>;
}

function View({ a }: { a: Audit }) {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [mode, setMode] = useState<"list" | "matrix">("list");
  const sel = params.get("r") || a.requirements[0]?.id;
  const asm = useMemo(() => Object.fromEntries(a.assessments.map((x) => [x.req_id, x])), [a]);
  const findingsOf = (id: string) => a.findings.filter((f) => f.req_ids.includes(id));
  const types = [...new Set(a.requirements.map((r) => r.type))];
  const list = a.requirements.filter((r) => (!type || r.type === type) &&
    (!q || (r.id + " " + (r.source_id || "") + " " + r.quote).toLowerCase().includes(q.toLowerCase())));
  const r = a.requirements.find((x) => x.id === sel);

  return (
    <div>
      <AuditHeader a={a} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input className="input pl-9" placeholder="Поиск по ID или тексту" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label="Тип требования">
          <option value="">Все типы</option>
          {types.map((t) => <option key={t} value={t}>{TYPE_RU[t] || t}</option>)}
        </select>
        <div className="flex rounded-xl border border-line bg-white p-0.5">
          {(["list", "matrix"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`rounded-lg px-3 py-1.5 text-sm ${mode === m ? "bg-signal-wash text-signal" : "text-ink-soft"}`}>
              {m === "list" ? "Карточки" : "Матрица критериев"}
            </button>
          ))}
        </div>
      </div>

      {mode === "matrix" ? (
        <div className="card overflow-auto">
          <table className="text-[12.5px]">
            <thead><tr className="bg-canvas">
              <th className="sticky left-0 bg-canvas px-4 py-2 text-left font-medium">Требование</th>
              <th className="px-2 font-medium">Балл</th>
              {CRITS.map((k) => <th key={k} className="px-1 py-2 font-medium text-ink-soft"><div className="w-[74px] leading-tight">{CRIT_RU[k]}</div></th>)}
            </tr></thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.id} className="border-t border-line">
                  <td className="sticky left-0 bg-white px-4 py-1.5"><button className="font-medium hover:text-signal" onClick={() => { setMode("list"); setParams({ r: x.id }); }}>{x.id}</button> <span className="text-ink-faint">{x.source_id_kind === "explicit" ? x.source_id : ""}</span></td>
                  <td className="px-2 text-center tabular-nums">{asm[x.id]?.score.toFixed(0)}</td>
                  {CRITS.map((k) => {
                    const st = ST[asm[x.id]?.criteria[k] || "unknown"];
                    return <td key={k} className="p-1"><div title={`${CRIT_RU[k]}: ${st.t}`} className="mx-auto h-5 w-[74px] rounded" style={{ background: st.bg, border: `1px solid ${st.c}33` }} /></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap gap-4 border-t border-line px-4 py-3 meta">
            {(Object.keys(ST) as CritStatus[]).map((k) => <span key={k} className="flex items-center gap-1.5"><span className="h-3 w-5 rounded" style={{ background: ST[k].bg, border: `1px solid ${ST[k].c}55` }} />{ST[k].t}</span>)}
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
                  <button onClick={() => setParams({ r: x.id })} className={`w-full px-4 py-3 text-left transition-colors ${sel === x.id ? "bg-signal-wash" : "hover:bg-canvas"}`}>
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className="font-semibold">{x.id}</span>
                      {x.source_id_kind === "explicit" && <span className="text-ink-soft">{x.source_id}</span>}
                      <span className="ml-auto flex items-center gap-1 text-ink-faint">
                        {worst && <span className="h-2 w-2 rounded-full" style={{ background: SEV_COLOR[worst] }} />}{fs.length || ""}
                      </span>
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[13.5px] text-ink-soft">{x.summary}</div>
                  </button>
                </li>
              );
            })}
            {!list.length && <li className="meta p-4">Ничего не найдено.</li>}
          </ul>
          {r && (
            <div className="min-w-0 space-y-4">
              <div className="card p-6">
                <div className="flex flex-wrap items-baseline gap-3">
                  <h2 className="text-xl font-semibold">{r.id}</h2>
                  <span className="meta">в документе: {r.source_id_kind === "explicit" ? r.source_id : r.source_id ? `нет номера (${r.source_id})` : "нет номера"}</span>
                  <span className="chip ml-auto bg-canvas text-ink-soft">{TYPE_RU[r.type] || r.type}</span>
                </div>
                <div className="meta mt-1">{r.section} · строки {r.loc.line_start}–{r.loc.line_end}{r.loc.page ? ` · стр. ${r.loc.page}` : ""} · балл {asm[r.id]?.score.toFixed(0)}/100</div>
                <blockquote className="mt-4 whitespace-pre-wrap rounded-lg border-l-2 border-sky bg-sky-wash px-4 py-3 font-mono text-[13px] leading-relaxed">{r.quote}</blockquote>
                <div className="mt-5 flex flex-wrap gap-1.5">
                  {CRITS.map((k) => {
                    const st = ST[asm[r.id]?.criteria[k] || "unknown"];
                    return <span key={k} className="chip border" style={{ color: st.c, background: st.bg, borderColor: st.c + "33" }}>{CRIT_RU[k]}</span>;
                  })}
                </div>
              </div>
              <div className="h2">Замечания ({findingsOf(r.id).length})</div>
              {findingsOf(r.id).map((f) => <FindingCard key={f.id} f={f} />)}
              {!findingsOf(r.id).length && <p className="meta">По проверенным критериям дефектов не найдено.</p>}
              {a.questions.filter((x) => x.req_ids.includes(r.id)).length > 0 && (
                <Link to={`/audits/${a.id}/clarifications`} className="btn-line">Вопросы по {r.id}: {a.questions.filter((x) => x.req_ids.includes(r.id)).length}</Link>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
