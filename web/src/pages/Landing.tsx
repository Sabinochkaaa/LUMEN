import { ReactNode, Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, ArrowUpRight, Bot, Check, ChevronLeft, ChevronRight, FileCheck2, FileDown, FileStack, FileUp, Gauge, GitFork, Globe, HelpCircle, KeyRound, Landmark, Lock, Menu, MessagesSquare, Quote, ScanSearch, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { Severity } from "../api";
import { Lang, useT } from "../i18n";
import { LangSwitch, Logo, Num, ThemeSwitch } from "../components/ui";
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

// «How it works»: four steps, each with what you get out of it
const STEPS = [
  { icon: FileUp, tone: "#2F6BFF" },
  { icon: ScanSearch, tone: "#7C4DFF" },
  { icon: MessagesSquare, tone: "#F28C28" },
  { icon: FileDown, tone: "#12A150" },
];

// «Everything a review needs»: one colour per feature so the eye can tell the cards apart at a glance
const FEATURES = [
  { icon: Quote, k: "f1", tone: "#2F6BFF" }, { icon: HelpCircle, k: "f2", tone: "#7C4DFF" }, { icon: Landmark, k: "f3", tone: "#F28C28" },
  { icon: GitFork, k: "f4", tone: "#F0453A" }, { icon: FileStack, k: "f5", tone: "#0EA5E9" }, { icon: Bot, k: "f6", tone: "#12A150" },
];

// «Bank-grade security»: the six measures, in the order of land.secD
const SECURITY = [Lock, Globe, FileCheck2, Gauge, KeyRound, ShieldAlert];

const H2 = "text-[28px] font-semibold leading-9 tracking-[-0.015em] md:text-[36px] md:leading-[44px]";

function Eyebrow({ children, light }: { children: ReactNode; light?: boolean }) {
  return <div className={`mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] ${light ? "text-white/60" : "text-signal"}`}>{children}</div>;
}

function Header() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onResize = () => { if (window.innerWidth >= 768) setOpen(false); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // the page under the open menu stays put
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); window.removeEventListener("resize", onResize); };
  }, [open]);
  const links = [["#team", "land.navTeam"], ["#how", "land.navHow"], ["#features", "land.navFeatures"], ["#security", "land.navSecurity"]];
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas">
      <div className="mx-auto flex max-w-[1200px] items-center gap-4 px-5 py-3">
        <Link to="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}><Logo size={36} /><span className="text-[16px] font-semibold tracking-[0.06em]">LÜMEN</span></Link>
        <nav className="ml-6 hidden gap-6 text-sm text-ink-soft md:flex">
          {links.map(([h, k]) => <a key={h} href={h} className="transition-colors hover:text-ink">{t(k)}</a>)}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden lg:block"><LangSwitch /></div>
          <div className="hidden md:block"><ThemeSwitch compact /></div>
          <Link to="/dashboard" className="btn-line hidden md:inline-flex">{t("land.open")}</Link>
          <Link to="/new" className="btn-primary hidden sm:inline-flex">{t("land.cta")}</Link>
          <button className="btn-ghost h-10 w-10 px-0 md:hidden" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="mobile-menu"
            aria-label={t("ui.menu")}>
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (<>
          <motion.div className="fixed inset-0 top-[61px] z-[-1] bg-black/30 md:hidden" aria-hidden onClick={() => setOpen(false)}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} />
          <motion.nav id="mobile-menu" aria-label={t("ui.menu")} className="absolute inset-x-0 top-full border-b border-line bg-canvas shadow-lift md:hidden"
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
            <div className="mx-auto max-w-[1200px] px-5 pb-5 pt-2">
              {links.map(([h, k]) => (
                <a key={h} href={h} onClick={() => setOpen(false)}
                  className="flex items-center justify-between border-b border-line py-3.5 text-[17px] font-medium">
                  {t(k)}<ChevronRight size={18} className="text-ink-faint" />
                </a>
              ))}
              <div className="mt-4 flex items-center justify-between gap-3">
                <LangSwitch />
                <ThemeSwitch />
              </div>
              <div className="mt-4 grid gap-2">
                <Link to="/new" className="btn-primary h-11 text-[15px]" onClick={() => setOpen(false)}>{t("land.cta")}<ArrowRight size={16} /></Link>
                <Link to="/dashboard" className="btn-line h-11 text-[15px]" onClick={() => setOpen(false)}>{t("land.open")}</Link>
              </div>
            </div>
          </motion.nav>
        </>)}
      </AnimatePresence>
    </header>
  );
}

function HowItWorks() {
  const { t } = useT();
  return (
    <section id="how" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 py-20 md:py-24">
      <motion.div {...UP} className="max-w-2xl">
        <Eyebrow>{t("land.navHow")}</Eyebrow>
        <h2 className={H2}>{t("land.hTitle")}</h2>
        <p className="mt-3 text-[16px] leading-[26px] text-ink-soft">{t("land.hSub")}</p>
      </motion.div>
      <ol className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4 lg:gap-5">
        {STEPS.map(({ icon: Icon, tone }, i) => (
          <motion.li key={i} {...UP} transition={{ ...UP.transition, delay: i * 0.06 }} className="relative">
            {/* arrow to the next step (wide screens) / a rail down the left (phones) */}
            {i < 3 && <span className="absolute -right-[14px] top-[38px] z-10 hidden h-6 w-6 items-center justify-center rounded-full border border-line bg-canvas text-ink-faint lg:flex" aria-hidden><ChevronRight size={14} /></span>}
            <div className="flex h-full flex-col rounded-xl border border-line bg-surface p-5 transition-colors hover:border-ink/20">
              <div className="flex items-center justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ background: tone + "1A", color: tone }}><Icon size={22} strokeWidth={1.8} /></span>
                <span className="font-mono text-[13px] text-ink-faint tabular-nums">{String(i + 1).padStart(2, "0")}</span>
              </div>
              <h3 className="mt-5 text-[17px] font-semibold leading-6">{t(`land.h${i + 1}`)}</h3>
              <p className="mt-1.5 flex-1 text-[14px] leading-[22px] text-ink-soft">{t(`land.h${i + 1}d`)}</p>
              <div className="mt-5 flex items-start gap-2 border-t border-line pt-3.5 text-[13px] leading-5">
                <Check size={15} className="mt-0.5 shrink-0" style={{ color: tone }} />
                <span><span className="text-ink-faint">{t("land.hOut")}: </span><span className="font-medium">{t(`land.h${i + 1}o`)}</span></span>
              </div>
            </div>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}

function Features() {
  const { t } = useT();
  return (
    <section id="features" className="scroll-mt-20 border-t border-line bg-surface">
      <div className="mx-auto max-w-[1200px] px-5 py-20 md:py-24">
        <motion.div {...UP} className="max-w-2xl">
          <Eyebrow>{t("land.navFeatures")}</Eyebrow>
          <h2 className={H2}>{t("land.fTitle")}</h2>
          <p className="mt-3 text-[16px] leading-[26px] text-ink-soft">{t("land.fSub")}</p>
        </motion.div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, k, tone }, i) => (
            <motion.div key={k} {...UP} transition={{ ...UP.transition, delay: (i % 3) * 0.06 }}
              className="group relative overflow-hidden rounded-xl border border-line bg-canvas p-6 transition-colors hover:border-ink/20">
              <span className="absolute inset-x-0 top-0 h-[3px] opacity-0 transition-opacity group-hover:opacity-100" style={{ background: tone }} aria-hidden />
              <span className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ background: tone + "1A", color: tone }}><Icon size={21} strokeWidth={1.8} /></span>
              <h3 className="mt-5 text-[17px] font-semibold leading-6">{t(`land.${k}`)}</h3>
              <p className="mt-2 text-[14px] leading-[22px] text-ink-soft">{t(`land.${k}d`)}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Security() {
  const { t } = useT();
  const items = t("land.secD").replace(/\.$/, "").split(/,\s+/);
  return (
    <section id="security" className="scroll-mt-20 bg-[#0B1F3A] text-white">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-5 py-20 md:py-24 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <motion.div {...UP}>
          <Eyebrow light>{t("land.navSecurity")}</Eyebrow>
          <span className="mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-white/10"><ShieldCheck size={28} strokeWidth={1.7} /></span>
          <h2 className={H2}>{t("land.secTitle")}</h2>
          <p className="mt-4 max-w-md text-[16px] leading-[26px] text-white/70">{t("land.secLead")}</p>
        </motion.div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((s, i) => {
            const Icon = SECURITY[i] ?? Check;
            return (
              <motion.li key={s} {...UP} transition={{ ...UP.transition, delay: (i % 2) * 0.05 }}
                className="flex gap-4 rounded-xl border border-white/10 bg-white/[0.04] p-5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[#7FB2FF]"><Icon size={19} strokeWidth={1.8} /></span>
                <div>
                  <div className="text-[15px] font-semibold leading-6">{s.charAt(0).toUpperCase() + s.slice(1)}</div>
                  <p className="mt-1 text-[13.5px] leading-[21px] text-white/65">{t(`land.sec${i + 1}`)}</p>
                </div>
              </motion.li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

const UP = { initial: { opacity: 0, y: 12 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-60px" }, transition: { duration: 0.3, ease: "easeOut" as const } };

export default function Landing() {
  const { t } = useT();
  return (
    <div className="relative min-h-full overflow-x-clip">
      <Header />

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
        <HowItWorks />
        <Features />
        <Security />
      </main>
      <footer className="border-t border-line py-7">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-5 text-[13px] text-ink-faint">
          <span className="flex items-center gap-2"><Logo size={24} />LÜMEN Requirements Intelligence</span>
          <a href="https://bcchubagents.mnu.kz/" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline decoration-line underline-offset-4 transition-colors hover:text-ink hover:decoration-ink/40">
            {t("land.foot")}<ArrowUpRight size={14} />
          </a>
        </div>
      </footer>
    </div>
  );
}
