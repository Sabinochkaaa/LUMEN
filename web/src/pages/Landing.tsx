import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Bot, Check, ChevronLeft, ChevronRight, FileStack, GitFork, HelpCircle, Landmark, Quote } from "lucide-react";
import { SEV_COLOR, Severity } from "../api";
import { Lang, useT } from "../i18n";
import { LangSwitch, Logo, Num, ReadinessBadge, SevBadge, ThemeSwitch } from "../components/ui";
import { AGENTS, AGENT_COLORS } from "../components/agents";
import RobotIcon from "../components/RobotIcon";

const TeamShowcase3D = lazy(() => import("../components/TeamShowcase3D"));

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


// colours and order of the 1.0 animated document (kept as it was, by request)
const LENS_COLOR: Record<string, string> = { CRITICAL: "#E5484D", HIGH: "#F76B15", MEDIUM: "#E2A30F" };
const LENS_ORDER = [3, 2, 7, 11, 4];

/**
 * The 1.0 hero document: a scan line runs over the spec and findings pop up line by line.
 * 3.0: semi-transparent so the robot behind it shows through; the finding tags are short enough
 * not to overlap on neighbouring lines, and the floating badges sit where nothing else moves.
 */
function HeroLens() {
  const { lang, t } = useT();
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % (HITS.length + 3)), 1400);
    return () => clearInterval(id);
  }, []);
  const order = LENS_ORDER.map((l) => HITS.find((h) => h.line === l)!);
  const shown = order.slice(0, Math.min(step, order.length));
  const lines = DOC[lang];
  return (
    <div className="relative">
      <div className="relative overflow-hidden rounded-xl border border-line/80 bg-surface/70 shadow-[0_24px_60px_-24px_rgb(47_107_255_/_.40),0_2px_6px_rgb(15_27_45_/_.05)] backdrop-blur-[2px]">
        <div className="flex items-center gap-2 border-b border-line/70 px-3.5 py-2">
          <span className="h-2 w-2 rounded-full bg-[#E5484D]/80" /><span className="h-2 w-2 rounded-full bg-[#E2A30F]/80" /><span className="h-2 w-2 rounded-full bg-[#12A150]/70" />
          <span className="ml-1.5 text-[11.5px] text-ink-faint">requirements.md</span>
          <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-ink-soft">
            <span className="hidden h-1.5 w-1.5 animate-pulse rounded-full bg-signal sm:inline-block" /><span className="hidden sm:inline">{t("lens.scan")}</span>
            <span className="rounded-full bg-signal/10 px-2 py-0.5 font-semibold text-signal tabular-nums">{shown.length} {t("lens.found")}</span>
          </span>
        </div>
        {/* only the newest finding carries its tag: tags on neighbouring lines would overlap */}
        <div className="relative py-2 font-mono text-[11px] leading-[1.95] sm:text-[11.5px]">
          <div className="lens-beam" />
          {lines.map((ln, i) => {
            const hit = shown.find((h) => h.line === i);
            const c = hit ? LENS_COLOR[hit.sev] : undefined;
            return (
              <div key={i} className="lens-line-hit relative flex pr-3" style={{ background: c ? c + "24" : undefined }}>
                <span className="relative w-8 shrink-0 select-none pr-2.5 text-right text-ink-faint">
                  {c && <motion.span layoutId={`dot-${i}`} className="absolute left-1 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full" style={{ background: c }} />}
                  {i + 1}
                </span>
                <span className={`min-w-0 truncate ${ln.startsWith("##") ? "font-semibold text-ink" : "text-ink/80"}`}>{ln || " "}</span>
                <AnimatePresence>
                  {hit && hit === shown[shown.length - 1] && (
                    <motion.span initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
                      className="absolute right-2 top-1/2 hidden max-w-[48%] -translate-y-1/2 truncate rounded-full px-2 font-sans text-[10px] font-semibold leading-4 text-white sm:block"
                      style={{ background: c }}>
                      {hit.label[lang]}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
      <motion.div className="absolute -top-14 left-2 hidden items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2 shadow-lift md:flex"
        animate={{ y: [0, -6, 0] }} transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}>
        <HelpCircle size={15} className="text-violet" /><span className="text-[12px] font-medium">11 · {t("ov.questions")}</span>
      </motion.div>
      <motion.div className="absolute -bottom-9 left-6 hidden rounded-xl border border-line bg-surface px-3.5 py-2 shadow-lift md:block"
        animate={{ y: [0, 6, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}>
        <div className="text-[10.5px] text-ink-faint">{t("ready.NOT READY")}</div>
        <div className="text-xl font-semibold leading-6 text-signal tabular-nums">72.3</div>
      </motion.div>
    </div>
  );
}

/** Hero picture: the LÜMEN robot floats in the air, the animated document sits in front of it. */
function HeroVisual() {
  const calm = useReducedMotion();
  return (
    <div className="relative mx-auto h-[460px] w-full max-w-[600px] sm:h-[560px]">
      <div className="hero-glow absolute inset-0" aria-hidden />
      <motion.img src="/hero-robot.webp" alt="" aria-hidden draggable={false} width={900} height={914}
        className="absolute -right-2 top-0 w-[74%] max-w-[440px] select-none"
        animate={calm ? undefined : { y: [0, -16, 0], rotate: [0, 1.5, 0] }}
        transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }} />
      <motion.div className="robot-shadow absolute right-[10%] top-[78%] h-6 w-[40%] max-w-[260px]" aria-hidden
        animate={calm ? undefined : { scaleX: [1, 0.82, 1], opacity: [0.9, 0.55, 0.9] }}
        transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }} />
      <div className="absolute bottom-10 left-0 z-10 w-[82%] max-w-[420px]"><HeroLens /></div>
    </div>
  );
}

/** Fallback for the showcase when 3D is off (no WebGL, data saver, reduced motion) and while three.js loads. */
function ShowcasePoster({ active, onPick }: { active: number; onPick: (i: number) => void }) {
  return (
    <div className="flex h-full items-center justify-center gap-3 px-4 sm:gap-8">
      {AGENTS.map((a, i) => (
        <button key={i} onClick={() => onPick(i)} tabIndex={-1} aria-hidden
          className={`transition-all duration-300 ${active < 0 ? "" : active === i ? "scale-125" : "opacity-30"}`}>
          <RobotIcon agent={i} size={active === i ? 120 : 72} />
        </button>
      ))}
    </div>
  );
}

/**
 * The team on one screen. All five robots stand on stage; a click on a robot (or its name) brings the camera close
 * and opens its card. Arrows or ← → switch agents, «Whole team» or Esc goes back, and scrolling the page away
 * cancels the close-up too.
 */
function TeamShowcase() {
  const { t, lang } = useT();
  const nav = useNavigate();
  const ref = useRef<HTMLElement>(null);
  const [active, setActive] = useState(-1);
  const [flat, setFlat] = useState(() =>
    typeof window !== "undefined" && (window.matchMedia("(prefers-reduced-motion: reduce)").matches || (navigator as any).connection?.saveData === true));
  const n = AGENTS.length;
  const open = active >= 0;
  // while the page glides to the section after a pick, its own scroll must not count as «the user scrolled away»
  const guard = useRef({ until: 0, y: 0 });
  const pick = useCallback((i: number) => {
    guard.current = { until: Date.now() + 1000, y: window.scrollY };
    const el = ref.current;
    if (el && Math.abs(el.getBoundingClientRect().top) > 4) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(i);
  }, []);
  const step = useCallback((d: number) => setActive((a) => (a < 0 ? 0 : (a + d + n) % n)), [n]);
  useEffect(() => {
    if (!open) return;
    guard.current = { ...guard.current, y: window.scrollY };
    const onScroll = () => {
      const g = guard.current;
      if (Date.now() < g.until) { g.y = window.scrollY; return; }
      if (Math.abs(window.scrollY - g.y) > 40) setActive(-1);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(-1);
      else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("keydown", onKey); };
  }, [open, step]);
  const go = [() => nav("/new"), () => nav("/pick/issues"), () => nav("/pick/fintech"), () => nav("/translate"), () => window.dispatchEvent(new Event("lumen:support"))];
  const a = open ? AGENTS[active] : null;
  const c = open ? AGENT_COLORS[active] : undefined;
  return (
    <section id="team" ref={ref} className="relative h-[100svh] min-h-[620px] overflow-hidden bg-canvas" aria-label={t("team.title")}>
      <div className="absolute inset-0">
        {flat ? <ShowcasePoster active={active} onPick={pick} /> : (
          <Suspense fallback={<ShowcasePoster active={active} onPick={pick} />}>
            <TeamShowcase3D active={active} onPick={pick} onFail={() => setFlat(true)} className="absolute inset-0" label={a ? a.name[lang] : t("team.title")} />
          </Suspense>
        )}
      </div>

      <div className="pointer-events-none absolute inset-0 mx-auto max-w-[1200px] px-5">
        <AnimatePresence mode="wait" initial={false}>
          {!open ? (
            <motion.div key="team" className="flex h-full flex-col items-center justify-between pb-8 pt-20 text-center"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              <div>
                <h2 className="text-[28px] font-semibold leading-9 tracking-[-0.01em] md:text-[36px] md:leading-[44px]">{t("team.title")}</h2>
                <p className="meta mt-2 text-[15px]">{t("hero.pick")}</p>
              </div>
              <div className="pointer-events-auto flex flex-wrap justify-center gap-2" role="group" aria-label={t("team.title")}>
                {AGENTS.map((x, i) => (
                  <button key={i} onClick={() => pick(i)}
                    className="inline-flex items-center gap-2 rounded-md border border-line bg-surface/90 px-3 py-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:border-ink/25 hover:text-ink">
                    <span className="h-2 w-2 rounded-full" style={{ background: AGENT_COLORS[i] }} />{x.name[lang]}
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div key="agent" className="flex h-full items-end pb-5 pt-20 lg:items-center lg:pb-0"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              <div className="pointer-events-auto w-full rounded-xl border border-line bg-surface/95 p-5 shadow-lift lg:w-[400px] lg:p-6" aria-live="polite">
                <div className="flex items-center justify-between gap-3">
                  <button onClick={() => setActive(-1)} className="btn-ghost -ml-2 h-8 px-2 text-[13px]"><ArrowLeft size={15} />{t("team.all")}</button>
                  <span className="font-mono text-[12.5px] text-ink-faint tabular-nums">{String(active + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}</span>
                </div>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={active} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22, ease: "easeOut" }}
                    className="mt-3 border-l-[3px] pl-4" style={{ borderColor: c }}>
                    <div className="text-[13px] font-semibold" style={{ color: active === 1 ? "#7B8496" : c }}>{a!.role[lang]}</div>
                    <h3 className="mt-0.5 text-[26px] font-semibold leading-tight tracking-[-0.01em] lg:text-[34px]">{a!.name[lang]}</h3>
                    <p className="mt-2 text-[14px] leading-[22px] text-ink-soft lg:text-[15px] lg:leading-6">{a!.text[lang]}</p>
                  </motion.div>
                </AnimatePresence>
                <button onClick={go[active]} className="btn-primary mt-4">{t(`hero.go${active}`)}<ArrowRight size={16} /></button>
                <div className="mt-5 flex items-center gap-2 border-t border-line pt-4">
                  <button onClick={() => step(-1)} className="btn-line h-8 w-8 px-0" aria-label={t("team.prev")}><ChevronLeft size={16} /></button>
                  <div className="flex flex-1 justify-center gap-1.5">
                    {AGENTS.map((x, i) => (
                      <button key={i} onClick={() => setActive(i)} aria-pressed={active === i} aria-label={x.name[lang]} title={x.name[lang]}
                        className="flex h-6 items-center px-0.5">
                        <span className="block h-2 rounded-full transition-all duration-200" style={{ width: active === i ? 22 : 8, background: active === i ? AGENT_COLORS[i] : "rgb(var(--line))" }} />
                      </button>
                    ))}
                  </div>
                  <button onClick={() => step(1)} className="btn-line h-8 w-8 px-0" aria-label={t("team.next")}><ChevronRight size={16} /></button>
                </div>
                <p className="mt-3 hidden text-center text-[12px] text-ink-faint lg:block">{t("team.keys")}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
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
          <Link to="/" className="flex items-center gap-2.5"><Logo size={36} /><span className="text-[16px] font-semibold tracking-[0.06em]">LÜMEN</span></Link>
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
          <div className="min-w-0"><HeroVisual /></div>
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

        <TeamShowcase />

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
          <span className="flex items-center gap-2"><Logo size={24} />LÜMEN Requirements Intelligence</span>
          <span>{t("land.foot")}</span>
        </div>
      </footer>
    </div>
  );
}
