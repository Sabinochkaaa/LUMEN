import { Suspense, lazy, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useT } from "../i18n";
import { AGENTS, AGENT_COLORS } from "./agents";

const AgentTeam3D = lazy(() => import("./AgentTeam3D"));

/** Dashboard header: the agent team on shift. Click a robot or its name — it steps forward and offers its job. */
export default function AgentDeck({ lastId }: { lastId?: string }) {
  const { t, lang } = useT();
  const nav = useNavigate();
  const [active, setActive] = useState(0);
  const actions: (() => void)[] = [
    () => nav("/new"),
    () => nav(lastId ? `/audits/${lastId}/issues` : "/reports"),
    () => nav(lastId ? `/audits/${lastId}/fintech` : "/pick/fintech"),
    () => nav("/translate"),
    () => window.dispatchEvent(new Event("lumen:support")),
  ];
  return (
    <div className="card mb-6 grid overflow-hidden md:grid-cols-[1.35fr_1fr]">
      <div className="relative h-[240px] md:h-[300px]"
        style={{ background: "radial-gradient(120% 100% at 50% 0%, rgb(var(--surface)) 0%, rgb(var(--canvas)) 100%)" }}>
        <Suspense fallback={null}><AgentTeam3D active={active} onPick={setActive} className="h-full w-full" label={t("deck.title")} /></Suspense>
      </div>
      <div className="flex flex-col border-t border-line p-6 md:border-l md:border-t-0">
        <div className="meta">{t("deck.title")}</div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {AGENTS.map((a, i) => (
            <button key={i} onClick={() => setActive(i)} aria-pressed={active === i}
              className="rounded-full border px-3 py-1 text-[12.5px] font-medium transition-all hover:-translate-y-0.5"
              style={active === i ? { background: AGENT_COLORS[i], borderColor: AGENT_COLORS[i], color: i === 1 ? "#101C36" : "#fff" }
                : { borderColor: "rgb(var(--line))", color: "rgb(var(--ink-soft))" }}>
              {a.name[lang]}
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={active} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22 }} className="mt-5 flex flex-1 flex-col">
            <div className="text-[13px] font-semibold" style={{ color: active === 1 ? "#7B8496" : AGENT_COLORS[active] }}>{AGENTS[active].role[lang]}</div>
            <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-soft">{AGENTS[active].text[lang]}</p>
            <button onClick={actions[active]} className="btn-primary mt-4 self-start md:mt-auto">
              {t(`deck.act${active}`)}<ArrowRight size={16} />
            </button>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
