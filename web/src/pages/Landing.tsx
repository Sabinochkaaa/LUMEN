import { Suspense, lazy, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Bot, Check, FileStack, GitFork, HelpCircle, Landmark, Quote } from "lucide-react";
import { SEV_COLOR, Severity } from "../api";
import { Lang, useT } from "../i18n";
import { LangSwitch, Logo, Num, ReadinessBadge, SevBadge, ThemeSwitch } from "../components/ui";
import { AGENTS, AGENT_COLORS } from "../components/agents";
import RobotIcon from "../components/RobotIcon";

const HeroTeam3D = lazy(() => import("../components/HeroTeam3D"));

const DOC: Record<Lang, string[]> = {
  ru: ["## Функциональные требования", "Ф-1. Клиент задаёт порог от 1 000 до 1 000 000 ₸.", "Ф-2. В расходы входят проведённые покупки.",
    "Ф-3. Система быстро отправляет push-уведомление.", "Ф-4. Сумма хранится в тиынах, порог — в тенге.", "", "## REST API",
    "REST type: GET  ·  /alerts/saveLimit", "200 OK: {\"result\":\"ERROR\"}", "", "## Критерии приёмки", "Покупка 31.01 23:58 → февральский счётчик"],
  kk: ["## Функционалдық талаптар", "Ф-1. Клиент 1 000-нан 1 000 000 ₸-ге дейін шек қояды.", "Ф-2. Шығысқа өткізілген сатып алулар кіреді.",
    "Ф-3. Жүйе push-хабарламаны жылдам жібереді.", "Ф-4. Сома тиынмен, шек теңгемен сақталады.", "", "## REST API",
    "REST type: GET  ·  /alerts/saveLimit", "200 OK: {\"result\":\"ERROR\"}", "", "## Қабылдау өлшемдері", "Сатып алу 31.01 23:58 → ақпан есептегіші"],
  en: ["## Functional requirements", "F-1. The client sets a threshold of 1,000–1,000,000 ₸.", "F-2. Spending includes posted purchases.",
    "F-3. The system sends a push notification quickly.", "F-4. Amounts stored in tiyn, threshold in tenge.", "", "## REST API",
    "REST type: GET  ·  /alerts/saveLimit", "200 OK: {\"result\":\"ERROR\"}", "", "## Acceptance criteria", "Purchase 31 Jan 23:58 → February counter"],
};
const HITS: { line: number; sev: Severity; label: Record<Lang, string> }[] = [
  { line: 7, sev: "CRITICAL", label: { ru: "GET меняет состояние", kk: "GET күйді өзгертеді", en: "GET changes state" } },
  { line: 11, sev: "CRITICAL", label: { ru: "Противоречит Ф-2", kk: "Ф-2-ге қайшы", en: "Contradicts F-2" } },
  { line: 3, sev: "HIGH", label: { ru: "«Быстро» — без числа", kk: "«Жылдам» — сансыз", en: "“Quickly” — no number" } },
  { line: 2, sev: "MEDIUM", label: { ru: "Авторизация или клиринг?", kk: "Авторизация ма, клиринг пе?", en: "Authorization or clearing?" } },
  { line: 4, sev: "MEDIUM", label: { ru: "Тиыны и тенге: ×100", kk: "Тиын мен теңге: ×100", en: "Tiyn vs tenge: ×100" } },
];


/** Static picture of the team for slow devices, no WebGL, reduced motion — and while three.js loads. */
function TeamPoster({ active, onPick }: { active: number; onPick: (i: number) => void }) {
  return (
    <div className="flex h-full items-end justify-center gap-3 pb-20 sm:gap-6">
      {AGENTS.map((_, i) => (
        <button key={i} onClick={() => onPick(i)} aria-hidden tabIndex={-1}
          className={`transition-transform ${active === i ? "-translate-y-2" : ""}`} style={{ marginBottom: Math.abs(i - 2) * -10 }}>
          <RobotIcon agent={i} size={i === 2 ? 76 : 64} />
        </button>
      ))}
    </div>
  );
}

function HeroStage() {
  const { t, lang } = useT();
  const nav = useNavigate();
  const [active, setActive] = useState(-1);
  const [flat, setFlat] = useState(() =>
    typeof window !== "undefined" && (window.matchMedia("(prefers-reduced-motion: reduce)").matches || (navigator as any).connection?.saveData === true));
  const go = [() => nav("/new"), () => nav("/pick/issues"), () => nav("/pick/fintech"), () => nav("/translate"), () => window.dispatchEvent(new Event("lumen:support"))];
  const a = active >= 0 ? AGENTS[active] : null;
  return (
    <div id="team" className="relative scroll-mt-24">
      <div className="stage-floor relative h-[340px] sm:h-[420px] lg:h-[460px]">
        {flat ? <TeamPoster active={active} onPick={setActive} /> : (
          <Suspense fallback={<TeamPoster active={active} onPick={setActive} />}>
            <HeroTeam3D active={active} onPick={setActive} onFail={() => setFlat(true)} className="absolute inset-0" label={t("team.title")} />
          </Suspense>
        )}
      </div>
      <div className="relative -mt-14 flex flex-wrap justify-center gap-1.5 px-2" role="group" aria-label={t("team.title")}>
        {AGENTS.map((x, i) => (
          <button key={i} onClick={() => setActive(active === i ? -1 : i)} aria-pressed={active === i}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12.5px] font-medium transition-colors ${active === i ? "border-ink/25 bg-surface text-ink" : "border-line bg-surface/80 text-ink-soft hover:text-ink"}`}>
            <span className="h-2 w-2 rounded-full" style={{ background: AGENT_COLORS[i] }} />{x.name[lang]}
          </button>
        ))}
      </div>
      <div className="mx-auto mt-4 min-h-[132px] max-w-xl">
        <AnimatePresence mode="wait" initial={false}>
          {a ? (
            <motion.div key={active} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
              className="card px-5 py-4" style={{ borderLeft: `3px solid ${AGENT_COLORS[active]}` }} aria-live="polite">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-[15px] font-semibold">{a.name[lang]}</div>
                <div className="label">{a.role[lang]}</div>
              </div>
              <p className="mt-1.5 text-[14px] leading-[22px] text-ink-soft">{a.text[lang]}</p>
              <button onClick={go[active]} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-signal hover:underline">
                {t(`hero.go${active}`)}<ArrowRight size={15} />
              </button>
            </motion.div>
          ) : (
            <motion.p key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="meta pt-3 text-center">{t("hero.pick")}</motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function SampleReport() {
  const { lang, t } = useT();
  const lines = DOC[lang];
  return (
    <div className="card overflow-hidden">
      <div className="panel-head">
        <div className="flex items-center gap-2 text-[13px] text-ink-soft"><span className="font-mono">requirements.md</span></div>
        <div className="flex items-center gap-3">
          <span className="meta hidden sm:inline">{t("ov.index")} <span className="font-medium text-ink tabular-nums"><Num value={72.3} decimals={1} /></span></span>
          <ReadinessBadge r="NOT READY" />
        </div>
      </div>
      <div className="grid lg:grid-cols-[1fr_1fr]">
        <div className="border-b border-line py-2 font-mono text-[12.5px] leading-[1.85] lg:border-b-0 lg:border-r">
          {lines.map((ln, i) => {
            const hit = HITS.find((h) => h.line === i);
            const c = hit ? SEV_COLOR[hit.sev] : undefined;
            return (
              <div key={i} className="flex pr-4" style={c ? { boxShadow: `inset 2px 0 0 ${c}`, background: c + "0F" } : undefined}>
                <span className="w-10 shrink-0 select-none pr-3 text-right text-ink-faint">{i + 1}</span>
                <span className={`min-w-0 truncate ${ln.startsWith("##") ? "font-semibold text-ink" : "text-ink/80"}`}
                  style={c ? { textDecoration: `underline ${c}`, textDecorationThickness: 2, textUnderlineOffset: 4 } : undefined}>{ln || " "}</span>
              </div>
            );
          })}
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>{t("land.colSev")}</th><th className="text-right">{t("land.colLine")}</th><th>{t("land.colIssue")}</th></tr></thead>
            <tbody>
              {HITS.map((h) => (
                <tr key={h.line}><td className="whitespace-nowrap"><SevBadge sev={h.sev} /></td><td className="text-right tabular-nums text-ink-soft">{h.line + 1}</td><td>{h.label[lang]}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const FEATURES = [
  { icon: Quote, k: "f1" }, { icon: HelpCircle, k: "f2" }, { icon: Landmark, k: "f3" },
  { icon: GitFork, k: "f4" }, { icon: FileStack, k: "f5" }, { icon: Bot, k: "f6" },
];

export default function Landing() {
  const { t } = useT();
  const up = { initial: { opacity: 0, y: 12 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-60px" }, transition: { duration: 0.3, ease: "easeOut" as const } };
  const security = t("land.secD").replace(/\.$/, "").split(/,\s+/);
  return (
    <div className="relative min-h-full overflow-x-clip">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/95">
        <div className="mx-auto flex max-w-[1200px] items-center gap-4 px-5 py-3">
          <Link to="/" className="flex items-center gap-2.5"><Logo size={28} /><span className="text-[16px] font-semibold tracking-[0.06em]">LÜMEN</span></Link>
          <nav className="ml-6 hidden gap-6 text-sm text-ink-soft md:flex">
            <a href="#team" className="hover:text-ink">{t("land.navTeam")}</a>
            <a href="#how" className="hover:text-ink">{t("land.navHow")}</a>
            <a href="#features" className="hover:text-ink">{t("land.navFeatures")}</a>
            <a href="#security" className="hover:text-ink">{t("land.navSecurity")}</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden sm:block"><LangSwitch /></div>
            <ThemeSwitch compact />
            <Link to="/dashboard" className="btn-line hidden md:inline-flex">{t("land.open")}</Link>
            <Link to="/new" className="btn-primary hidden sm:inline-flex">{t("land.cta")}</Link>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-[1200px] items-center gap-10 px-5 pb-16 pt-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:pt-16">
          <motion.div className="min-w-0" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: "easeOut" }}>
            <div className="label mb-4">ISO/IEC/IEEE 29148 · IEEE 830</div>
            <h1 className="hyphens-auto break-words text-[32px] font-semibold leading-[40px] tracking-[-0.015em] md:text-[44px] md:leading-[52px]">{t("land.title")}</h1>
            <p className="mt-5 max-w-xl text-[16px] leading-[26px] text-ink-soft">{t("land.sub")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/new" className="btn-primary h-11 px-5 text-[15px]">{t("land.cta")}<ArrowRight size={17} /></Link>
              <Link to="/dashboard" className="btn-line h-11 px-5 text-[15px]">{t("land.open")}</Link>
            </div>
            <div className="mt-7 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-faint">
              {["PDF", "Word", "Excel", "Markdown", "HTML", "RTF", "OCR"].map((f) => <span key={f}>{f}</span>)}
            </div>
          </motion.div>
          <div className="min-w-0"><HeroStage /></div>
        </section>

        <section className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-[1200px] grid-cols-2 px-5 md:grid-cols-4">
            {[[15, "land.s1"], [6, "land.s2"], [3, "land.s3"], [25, "land.s4"]].map(([n, k], i) => (
              <div key={k as string} className={`py-7 ${i ? "md:border-l md:border-line md:pl-8" : ""} ${i % 2 ? "border-l border-line pl-6 md:pl-8" : ""}`}>
                <div className="text-[32px] font-medium leading-10 tracking-tight"><Num value={n as number} /></div>
                <div className="meta mt-1">{t(k as string)}</div>
              </div>
            ))}
          </div>
        </section>

        <section id="how" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 py-20">
          <motion.h2 {...up} className="text-[28px] font-semibold leading-9 tracking-[-0.01em] md:text-[32px] md:leading-10">{t("land.hTitle")}</motion.h2>
          <ol className="relative mt-10 grid gap-8 md:grid-cols-4 md:gap-6">
            <div className="absolute left-0 right-0 top-4 hidden h-px bg-line md:block" aria-hidden />
            {[1, 2, 3, 4].map((n) => (
              <motion.li key={n} {...up} className="relative">
                <div className="relative flex h-8 w-8 items-center justify-center rounded-full border border-ink/20 bg-canvas text-sm font-semibold tabular-nums">{n}</div>
                <div className="mt-4 text-[16px] font-semibold">{t(`land.h${n}`)}</div>
                <p className="meta mt-1">{t(`land.h${n}d`)}</p>
              </motion.li>
            ))}
          </ol>
        </section>

        <section className="mx-auto max-w-[1200px] px-5 pb-20">
          <motion.div {...up}>
            <h2 className="text-[28px] font-semibold leading-9 tracking-[-0.01em] md:text-[32px] md:leading-10">{t("land.sample")}</h2>
            <p className="meta mt-2 max-w-2xl text-[15px] leading-6">{t("land.sampleD")}</p>
            <div className="mt-8"><SampleReport /></div>
          </motion.div>
        </section>

        <section id="features" className="border-t border-line bg-surface">
          <div className="mx-auto max-w-[1200px] scroll-mt-20 px-5 py-20">
            <motion.h2 {...up} className="max-w-2xl text-[28px] font-semibold leading-9 tracking-[-0.01em] md:text-[32px] md:leading-10">{t("land.fTitle")}</motion.h2>
            <div className="mt-10 grid gap-x-10 gap-y-9 md:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, k }) => (
                <motion.div key={k} {...up} className="border-t border-line pt-5">
                  <Icon size={20} strokeWidth={1.6} className="text-ink-soft" />
                  <div className="mt-3 text-[16px] font-semibold">{t(`land.${k}`)}</div>
                  <p className="meta mt-1.5 text-[14px] leading-[22px]">{t(`land.${k}d`)}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section id="security" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 py-20">
          <motion.div {...up} className="grid gap-8 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <h2 className="text-[28px] font-semibold leading-9 tracking-[-0.01em] md:text-[32px] md:leading-10">{t("land.secTitle")}</h2>
            <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {security.map((s) => (
                <li key={s} className="flex items-start gap-2.5 text-[15px] leading-6"><Check size={18} className="mt-0.5 shrink-0 text-ok" />{s.charAt(0).toUpperCase() + s.slice(1)}</li>
              ))}
            </ul>
          </motion.div>
        </section>
      </main>
      <footer className="border-t border-line py-7">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-5 text-[13px] text-ink-faint">
          <span className="flex items-center gap-2"><Logo size={20} />LÜMEN Requirements Intelligence</span>
          <span>{t("land.foot")}</span>
        </div>
      </footer>
    </div>
  );
}
