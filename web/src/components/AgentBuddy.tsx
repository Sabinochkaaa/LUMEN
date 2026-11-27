import { ReactNode, Suspense, lazy } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useT } from "../i18n";
import { AGENTS, AGENT_COLORS } from "./agents";

const AgentTeam3D = lazy(() => import("./AgentTeam3D"));

/**
 * One agent «on duty» for a page: a live 3D robot that follows the pointer, holds a glowing tablet,
 * works while the page is busy and celebrates when it is done, plus what it says right now.
 */
export default function AgentBuddy({ agent, mood, say, tint, onPick, children, compact = false }: {
  agent: number; mood: "idle" | "working" | "done"; say: string; tint?: string; onPick?: () => void; children?: ReactNode;
  /** a lower strip for pages where the content matters more than the robot */
  compact?: boolean;
}) {
  const { lang } = useT();
  const a = AGENTS[agent];
  const color = AGENT_COLORS[agent];
  return (
    <div className={`card relative flex items-stretch overflow-hidden ${compact ? "mb-5 flex-row" : "mb-6 flex-col sm:flex-row"}`}>
      <div className="pointer-events-none absolute inset-0 opacity-[0.10]"
        style={{ background: `radial-gradient(60% 120% at 12% 50%, ${tint ?? color} 0%, transparent 70%)` }} />
      <div className={`relative shrink-0 ${compact ? "h-[128px] w-[120px] sm:w-[150px]" : "h-[190px] sm:h-[200px] sm:w-[220px]"}`}>
        <Suspense fallback={null}>
          <AgentTeam3D mode="solo" agent={agent} mood={mood} tint={tint} onPick={onPick ? () => onPick() : undefined}
            className="h-full w-full" label={a.name[lang]} />
        </Suspense>
      </div>
      <div className={`relative flex min-w-0 flex-1 flex-col justify-center ${compact ? "gap-2 py-3 pr-4" : "gap-3 px-5 pb-5 sm:py-5 sm:pl-0"}`}>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            {mood === "working" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: color }} />}
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          </span>
          <span className="font-semibold" style={{ color: agent === 1 ? "#7B8496" : color }}>{a.name[lang]}</span>
          <span className="meta truncate">· {a.role[lang]}</span>
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={say} initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className={`max-w-2xl self-start rounded-2xl rounded-tl-md border border-line bg-surface/95 shadow-lift ${compact ? "px-3.5 py-2 text-[13.5px]" : "px-4 py-2.5 text-[14.5px]"}`}>
            {say}
          </motion.div>
        </AnimatePresence>
        {children}
      </div>
    </div>
  );
}
