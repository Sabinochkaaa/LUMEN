import { Suspense, lazy, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { useT } from "../i18n";
import { AGENTS, AGENT_COLORS } from "./agents";

const AgentTeam3D = lazy(() => import("./AgentTeam3D"));

/** Which agent owns which pipeline stage (the translator is not part of a review). */
export const STAGE_AGENT: Record<string, number> = {
  upload: 0, validate: 0, parse: 0, segment: 0, extract: 0, classify: 0, individual: 0, consistency: 0, completeness: 0,
  clarify: 0, stats: 0, verify: 1, fintech: 2, report: 4, save: 4,
};

type Stage = { key: string; status?: string; message?: string };

/** The live «agent office»: robots at their desks, the one doing the current stage types, a feed of what they did. */
export default function AgentOffice({ stages, finished }: { stages: Stage[]; finished: boolean }) {
  const { t, lang } = useT();
  const running = stages.filter((s) => s.status === "running");
  const current = running[running.length - 1];
  const working = current ? STAGE_AGENT[current.key] ?? 0 : -1;
  const state = useMemo(() => AGENTS.map((_, i) => {
    const own = stages.filter((s) => STAGE_AGENT[s.key] === i);
    if (!own.length) return "free";
    if (own.some((s) => s.status === "running")) return "work";
    if (own.every((s) => s.status && s.status !== "running")) return "done";
    return "wait";
  }), [stages]);
  const feed = stages.filter((s) => s.status === "done" || s.status === "running" || s.status === "error").slice(-4).reverse();

  return (
    <div className="card relative overflow-hidden">
      <div className="relative h-[300px] md:h-[340px]"
        style={{ background: "radial-gradient(120% 100% at 50% 0%, rgb(var(--surface)) 0%, rgb(var(--canvas)) 100%)" }}>
        <Suspense fallback={null}>
          <AgentTeam3D mode="office" working={working} finished={finished} className="h-full w-full" label={t("office.title")} />
        </Suspense>
        <div className="pointer-events-none absolute left-4 top-4 max-w-[70%]">
          <AnimatePresence mode="wait">
            <motion.div key={finished ? "fin" : current?.key ?? "idle"} initial={{ opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}
              className="rounded-2xl rounded-bl-md border border-line bg-surface/95 px-3.5 py-2 shadow-lift backdrop-blur">
              {finished ? (
                <div className="text-[13.5px] font-medium">{t("office.done")}</div>
              ) : current ? (<>
                <div className="text-[11.5px] font-semibold" style={{ color: working === 1 ? "#7B8496" : AGENT_COLORS[working] }}>{AGENTS[working].name[lang]}</div>
                <div className="text-[13.5px]">{t(`stage.${current.key}`)}…</div>
              </>) : <div className="text-[13.5px]">{t("office.wait")}</div>}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      <div className="grid grid-cols-5 border-t border-line">
        {AGENTS.map((a, i) => (
          <div key={i} className="flex flex-col items-center gap-1 border-r border-line px-1 py-2.5 last:border-r-0">
            <span className="h-1.5 w-6 rounded-full" style={{ background: AGENT_COLORS[i], opacity: state[i] === "free" ? 0.3 : 1 }} />
            <span className="truncate text-[12px] font-medium">{a.name[lang]}</span>
            <span className={`flex items-center gap-1 text-[11px] ${state[i] === "work" ? "text-signal" : state[i] === "done" ? "text-ok" : "text-ink-faint"}`}>
              {state[i] === "work" && <Loader2 size={11} className="animate-spin" />}
              {state[i] === "done" && <Check size={11} />}
              {t(state[i] === "done" ? "office.done_" : state[i] === "wait" ? "office.wait_" : `office.${state[i]}`)}
            </span>
          </div>
        ))}
      </div>
      {feed.length > 0 && (
        <ul className="space-y-1 border-t border-line px-4 py-3" aria-live="polite">
          <AnimatePresence initial={false} mode="popLayout">
            {feed.map((s) => (
              <motion.li key={s.key + s.status} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                className="flex items-center gap-2 text-[12.5px]">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: AGENT_COLORS[STAGE_AGENT[s.key] ?? 0] }} />
                <span className="font-medium">{AGENTS[STAGE_AGENT[s.key] ?? 0].name[lang]}</span>
                <span className="truncate text-ink-soft">{t(`stage.${s.key}`)}{s.status === "running" ? "…" : ""}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
