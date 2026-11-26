import { useNavigate } from "react-router-dom";
import type { Audit } from "../api";
import { useT } from "../i18n";
import AgentBuddy from "./AgentBuddy";

type Page = "home" | "requirements" | "issues" | "graph" | "clarifications" | "fintech" | "compare";

/** Which agent is on duty for each tab of an audit, and what it says about this very report. */
export default function AuditBuddy({ a, page }: { a: Audit; page: Page }) {
  const { t } = useT();
  const nav = useNavigate();
  const s = a.scores;
  const confirmed = a.findings.filter((f) => f.status === "confirmed");
  const review = a.findings.length - confirmed.length;
  const touched = new Set(a.findings.flatMap((f) => f.req_ids));
  const clean = a.requirements.filter((r) => !touched.has(r.id)).length;
  const crit = s.by_severity?.CRITICAL ?? 0;
  const high = s.by_severity?.HIGH ?? 0;
  const verdict = t(`ready.${a.readiness}`);
  const conflicts = a.relations.filter((r) => r.type === "conflicts_with").length;
  const fin = confirmed.filter((f) => f.criterion === "fintech");
  const gaps = a.fintech.filter((c) => c.status === "missing" || c.status === "partial").length;
  const open = a.questions.filter((q) => q.status === "open").length;
  const top = confirmed.find((f) => f.severity === "CRITICAL") ?? confirmed.find((f) => f.severity === "HIGH");

  const cfg: Record<Page, { agent: number; say: string; mood?: "idle" | "done"; go?: string }> = {
    home: { agent: 0, mood: a.readiness === "READY" ? "done" : "idle", go: "issues",
      say: t("ab.home", { req: s.total_requirements, f: confirmed.length, verdict, crit, high }) },
    requirements: { agent: 0, say: t("ab.req", { req: a.requirements.length, clean }) },
    issues: { agent: 1, say: top ? t("ab.issues", { f: confirmed.length, nv: review, id: top.id, title: top.title }) : t("ab.issuesNone", { f: confirmed.length, nv: review }) },
    graph: { agent: 0, say: t("ab.graph", { rel: a.relations.length, conf: conflicts }) },
    clarifications: { agent: 4, mood: open === 0 && a.questions.length ? "done" : "idle",
      say: open ? t("ab.q", { open, all: a.questions.length }) : t("ab.qDone") },
    fintech: { agent: 2, go: "issues", say: t("ab.fin", { n: fin.length, gaps, all: a.fintech.length }) },
    compare: { agent: 1, say: t("ab.cmp") },
  };
  const c = cfg[page];
  return (
    <AgentBuddy agent={c.agent} mood={c.mood ?? "idle"} say={c.say}
      onPick={c.go ? () => nav(`/audits/${a.id}/${c.go}`) : c.agent === 4 ? () => window.dispatchEvent(new Event("lumen:support")) : undefined} />
  );
}
