import { useMemo, useState } from "react";
import { Background, Controls, Edge, MarkerType, Node, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AuditGate } from "../App";
import { Audit, SEV_COLOR, SEV_ORDER, TYPE_RU } from "../api";
import AuditHeader from "../components/AuditHeader";

const COLS = ["business_goal", "functional", "nonfunctional", "data", "integration", "architecture", "ui", "acceptance", "api", "security", "testing", "other"];
const REL: Record<string, { ru: string; c: string }> = {
  conflicts_with: { ru: "противоречит", c: "#D92D20" }, duplicates: { ru: "дублирует", c: "#E8620C" },
  depends_on: { ru: "зависит от", c: "#1F4FD8" }, refines: { ru: "уточняет", c: "#3BA7E8" },
  implements: { ru: "реализует", c: "#12A150" }, traces_to: { ru: "прослеживается к", c: "#6D4AE0" },
};

export default function Graph() {
  return <AuditGate>{(a) => <View a={a} />}</AuditGate>;
}

function View({ a }: { a: Audit }) {
  const [sel, setSel] = useState<string | null>(null);
  const [onlyLinked, setOnlyLinked] = useState(true);
  const linked = useMemo(() => new Set(a.relations.flatMap((r) => [r.source, r.target])), [a]);
  const { nodes, edges } = useMemo(() => {
    const reqs = a.requirements.filter((r) => !onlyLinked || linked.has(r.id));
    const cols = COLS.filter((c) => reqs.some((r) => (COLS.includes(r.type) ? r.type : "other") === c));
    const rowOf: Record<string, number> = {};
    const nodes: Node[] = reqs.map((r) => {
      const col = cols.indexOf(COLS.includes(r.type) ? r.type : "other");
      const row = (rowOf[col] = (rowOf[col] ?? -1) + 1);
      const fs = a.findings.filter((f) => f.req_ids.includes(r.id) && f.status === "confirmed");
      const worst = SEV_ORDER.find((s) => fs.some((f) => f.severity === s));
      const c = worst && worst !== "INFO" ? SEV_COLOR[worst] : "#CBD5E1";
      return {
        id: r.id, position: { x: col * 380 + (row % 2) * 150, y: row * 104 },
        data: { label: (
          <div className="text-left">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{r.id}{r.source_id_kind === "explicit" && <span className="font-normal text-ink-soft">{r.source_id}</span>}</div>
            <div className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-ink-soft">{r.summary}</div>
          </div>) },
        style: { width: 210, borderRadius: 12, border: `1.5px solid ${sel === r.id ? "#1F4FD8" : c}`, background: "#fff", padding: 8, fontFamily: "inherit" },
      };
    });
    const ids = new Set(reqs.map((r) => r.id));
    const edges: Edge[] = a.relations.filter((r) => ids.has(r.source) && ids.has(r.target)).map((r, i) => ({
      id: `e${i}`, source: r.source, target: r.target, label: REL[r.type]?.ru, animated: r.type === "conflicts_with",
      style: { stroke: REL[r.type]?.c, strokeWidth: r.type === "conflicts_with" ? 2.2 : 1.5, strokeDasharray: r.status === "confirmed" ? undefined : "5 4" },
      labelStyle: { fontSize: 10, fill: REL[r.type]?.c }, labelBgStyle: { fill: "#fff" },
      markerEnd: { type: MarkerType.ArrowClosed, color: REL[r.type]?.c },
    }));
    return { nodes, edges };
  }, [a, onlyLinked, linked, sel]);

  const rels = a.relations.filter((r) => r.source === sel || r.target === sel);
  const orphans = a.requirements.filter((r) => (r.type === "functional" || r.type === "nonfunctional") && !linked.has(r.id));

  return (
    <div>
      <AuditHeader a={a} />
      <div className="mb-3 flex flex-wrap items-center gap-4">
        {Object.entries(REL).map(([k, v]) => (
          <span key={k} className="meta flex items-center gap-1.5"><span className="h-0.5 w-5" style={{ background: v.c }} />{v.ru} {a.relations.filter((r) => r.type === k).length}</span>
        ))}
        <span className="meta flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed border-ink-faint" />требует подтверждения</span>
        <label className="meta ml-auto flex items-center gap-2"><input type="checkbox" checked={onlyLinked} onChange={(e) => setOnlyLinked(e.target.checked)} />только связанные</label>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="card h-[640px] overflow-hidden">
          {nodes.length ? (
            <ReactFlow nodes={nodes} edges={edges} fitView onNodeClick={(_, n) => setSel(n.id)} nodesConnectable={false} proOptions={{ hideAttribution: true }}>
              <Background color="#E4E8F0" gap={20} />
              <Controls showInteractive={false} />
            </ReactFlow>
          ) : <div className="meta p-6">Связи между требованиями не установлены. Снимите флажок «только связанные», чтобы увидеть все требования.</div>}
        </div>
        <aside className="space-y-4">
          <div className="card p-5">
            <div className="h2">{sel ?? "Выберите узел"}</div>
            {sel ? (
              <ul className="mt-3 space-y-3 text-[13.5px]">
                {rels.map((r, i) => (
                  <li key={i}>
                    <span className="font-medium">{r.source}</span> <span style={{ color: REL[r.type]?.c }}>{REL[r.type]?.ru}</span> <span className="font-medium">{r.target}</span>
                    <div className="meta">{r.status === "confirmed" ? "подтверждена" : "требует подтверждения"}{r.note ? ` · ${r.note}` : ""}</div>
                  </li>
                ))}
                {!rels.length && <li className="meta">Связей нет.</li>}
              </ul>
            ) : <p className="meta mt-1">Цвет рамки — самая высокая критичность дефектов требования. Связи построены по тексту документа и найденным противоречиям, а не для красоты.</p>}
          </div>
          <div className="card p-5">
            <div className="h2">Без связей</div>
            <p className="meta mt-1">Функциональные и нефункциональные требования, для которых не найдено ни критерия приёмки, ни зависимости ({orphans.length}).</p>
            <div className="mt-3 flex flex-wrap gap-1.5">{orphans.map((r) => <button key={r.id} onClick={() => { setOnlyLinked(false); setSel(r.id); }} className="chip bg-canvas text-ink-soft hover:text-signal">{r.id} · {TYPE_RU[r.type]}</button>)}</div>
          </div>
        </aside>
      </div>
    </div>
  );
}
