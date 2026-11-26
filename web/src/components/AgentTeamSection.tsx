import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useT } from "../i18n";
import { AGENTS, AGENT_COLORS } from "./agents";

const AgentTeam3D = lazy(() => import("./AgentTeam3D"));

export default function AgentTeamSection() {
  const { lang, t } = useT();
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  const go = (i: number) => {
    setActive(i);
    refs.current[i]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (seen) setActive(Number((seen.target as HTMLElement).dataset.i));
    }, { rootMargin: "-40% 0px -40% 0px", threshold: [0, 0.5, 1] });
    refs.current.forEach((r) => r && io.observe(r));
    return () => io.disconnect();
  }, []);

  return (
    <section id="team" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-24">
      <h2 className="max-w-2xl text-[32px] font-semibold leading-tight tracking-[-0.02em] md:text-[40px]">{t("team.title")}</h2>
      <p className="meta mt-3 max-w-2xl text-[16px] leading-relaxed">{t("team.sub")}</p>
      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_1.1fr]">
        <div className="order-2 lg:order-1">
          {AGENTS.map((a, i) => (
            <div key={i} data-i={i} ref={(el) => { refs.current[i] = el; }} className="flex min-h-[46vh] items-center py-6 lg:min-h-[62vh]">
              <motion.div onClick={() => go(i)} animate={{ opacity: active === i ? 1 : 0.35, x: active === i ? 0 : -6 }} transition={{ duration: 0.4 }}
                className="max-w-md cursor-pointer border-l-4 pl-6" style={{ borderColor: AGENT_COLORS[i] }}>
                <div className="text-[13px] font-semibold" style={{ color: AGENT_COLORS[i] === "#C9CED8" ? "#7B8496" : AGENT_COLORS[i] }}>{a.role[lang]}</div>
                <h3 className="mt-1 text-[28px] font-semibold tracking-[-0.02em] md:text-[34px]">{a.name[lang]}</h3>
                <p className="mt-3 text-[16px] leading-relaxed text-ink-soft">{a.text[lang]}</p>
              </motion.div>
            </div>
          ))}
        </div>
        <div className="sticky top-16 z-10 order-1 self-start lg:static lg:order-2 lg:self-stretch">
          <div className="card h-[260px] overflow-hidden shadow-lift md:h-[420px] lg:sticky lg:top-24 lg:h-[560px]"
            style={{ background: "radial-gradient(120% 90% at 50% 0%, rgb(var(--surface)) 0%, rgb(var(--canvas)) 100%)" }}>
            <Suspense fallback={null}><AgentTeam3D active={active} onPick={go} className="h-full w-full" label={t("team.title")} /></Suspense>
            <div className="absolute inset-x-0 bottom-4 flex flex-wrap justify-center gap-1.5 px-3">
              {AGENTS.map((a, i) => (
                <button key={i} onClick={() => go(i)} aria-pressed={active === i}
                  className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-all hover:scale-105 ${active === i ? "shadow-md" : "hidden hover:bg-ink/5 sm:inline"}`}
                  style={{ background: active === i ? AGENT_COLORS[i] : undefined, color: active === i ? (i === 1 ? "#101C36" : "#fff") : "rgb(var(--ink-soft))" }}>
                  {a.name[lang]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
