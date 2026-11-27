import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useT } from "../i18n";
import { AGENTS, AGENT_COLORS } from "./agents";
import RobotIcon from "./RobotIcon";

/** Dashboard: the agent team on shift. Design 2.0 — a flat panel (3D lives on the landing): pick an agent, get its job. */
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
  const a = AGENTS[active];
  return (
    <section className="card mb-6" aria-label={t("deck.title")}>
      <div className="panel-head"><h2 className="h2">{t("deck.title")}</h2></div>
      <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="flex flex-wrap gap-2 p-4 md:flex-col md:flex-nowrap md:border-r md:border-line">
          {AGENTS.map((x, i) => (
            <button key={i} onClick={() => setActive(i)} aria-pressed={active === i}
              className={`flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left text-[13px] transition-colors ${active === i ? "border-ink/20 bg-surface-2 font-medium text-ink" : "border-transparent text-ink-soft hover:bg-surface-2 hover:text-ink"}`}>
              <RobotIcon agent={i} size={22} active={active === i} />
              <span>{x.name[lang]}</span>
              <span className="ml-auto hidden h-1.5 w-1.5 rounded-full md:block" style={{ background: AGENT_COLORS[i] }} />
            </button>
          ))}
        </div>
        <div className="flex flex-col border-t border-line p-5 md:border-t-0">
          <div className="label">{a.role[lang]}</div>
          <div className="mt-1 text-[18px] font-semibold">{a.name[lang]}</div>
          <p className="mt-2 text-[14px] leading-[22px] text-ink-soft">{a.text[lang]}</p>
          <button onClick={actions[active]} className="btn-primary mt-4 self-start md:mt-auto">
            {t(`deck.act${active}`)}<ArrowRight size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}
