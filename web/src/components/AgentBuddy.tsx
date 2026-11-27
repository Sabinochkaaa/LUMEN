import { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useT } from "../i18n";
import { AGENTS, AGENT_COLORS } from "./agents";
import RobotIcon from "./RobotIcon";

/**
 * One agent «on duty» for a page. Design 2.0: a compact hint strip with a flat portrait (no 3D in the panel,
 * docs/DESIGN.md §9) — the agent's name, its role and what it says about this page right now.
 */
export default function AgentBuddy({ agent, mood, say, onPick, children, compact = false }: {
  agent: number; mood: "idle" | "working" | "done"; say: string; tint?: string; onPick?: () => void; children?: ReactNode;
  /** a lower strip for pages where the content matters more than the robot */
  compact?: boolean;
}) {
  const { lang, t } = useT();
  const a = AGENTS[agent];
  const color = AGENT_COLORS[agent];
  return (
    <div className={`card flex items-start gap-3.5 ${compact ? "mb-5 px-4 py-3" : "mb-6 px-4 py-3.5"}`} style={{ borderLeft: `3px solid ${color}` }}>
      <button type="button" onClick={onPick} disabled={!onPick} aria-label={a.name[lang]}
        className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 disabled:cursor-default">
        <RobotIcon agent={agent} size={28} active={mood === "working"} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-[13px]">
          <span className="font-semibold text-ink">{a.name[lang]}</span>
          <span className="text-ink-faint">{a.role[lang]}</span>
          {mood === "working" && <span className="chip bg-signal/10 text-signal">{t("ui.loading")}</span>}
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p key={say} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
            className="mt-0.5 max-w-3xl text-[14px] leading-[22px] text-ink-soft">
            {say}
          </motion.p>
        </AnimatePresence>
        {children}
      </div>
      {onPick && (
        <button type="button" onClick={onPick} className="btn-ghost hidden h-8 shrink-0 px-2 sm:inline-flex" aria-label={a.name[lang]}>
          <ArrowRight size={16} />
        </button>
      )}
    </div>
  );
}
