import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Bot, FileStack, GitFork, HelpCircle, Landmark, Lock, Quote, ShieldCheck } from "lucide-react";
import { Aurora } from "../App";
import { Lang, useT } from "../i18n";
import { LangSwitch, Logo, Num, ThemeSwitch } from "../components/ui";

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
const HITS: { line: number; color: string; label: Record<Lang, string> }[] = [
  { line: 3, color: "#F76B15", label: { ru: "«Быстро» — без числа", kk: "«Жылдам» — сансыз", en: "“Quickly” — no number" } },
  { line: 2, color: "#E2A30F", label: { ru: "Авторизация или клиринг?", kk: "Авторизация ма, клиринг пе?", en: "Authorization or clearing?" } },
  { line: 7, color: "#E5484D", label: { ru: "GET меняет состояние", kk: "GET күйді өзгертеді", en: "GET changes state" } },
  { line: 11, color: "#E5484D", label: { ru: "Противоречит Ф-2", kk: "Ф-2-ге қайшы", en: "Contradicts F-2" } },
  { line: 4, color: "#E2A30F", label: { ru: "Тиыны и тенге: ×100", kk: "Тиын мен теңге: ×100", en: "Tiyn vs tenge: ×100" } },
];

function HeroLens() {
  const { lang, t } = useT();
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % (HITS.length + 3)), 1400);
    return () => clearInterval(id);
  }, []);
  const shown = HITS.slice(0, Math.min(step, HITS.length));
  const lines = DOC[lang];
  return (
    <div className="relative">
      <div className="absolute -inset-6 rounded-[32px] opacity-60 blur-2xl grad-bg" style={{ opacity: 0.25 }} />
      <div className="card relative overflow-hidden shadow-lift">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-bad/70" /><span className="h-2.5 w-2.5 rounded-full bg-warn/70" /><span className="h-2.5 w-2.5 rounded-full bg-ok/70" />
          <span className="ml-2 text-[12px] text-ink-faint">requirements.md</span>
          <span className="ml-auto flex items-center gap-2 text-[12px] text-ink-soft">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" />{t("lens.scan")}
            <span className="rounded-full bg-signal/10 px-2 py-0.5 font-semibold text-signal tabular-nums">{shown.length} {t("lens.found")}</span>
          </span>
        </div>
        <div className="relative py-3 font-mono text-[12.5px] leading-[1.85]">
          <div className="lens-beam" />
          {lines.map((ln, i) => {
            const hit = shown.find((h) => h.line === i);
            return (
              <div key={i} className="lens-line-hit relative flex pr-4" style={{ background: hit ? hit.color + "1F" : undefined }}>
                <span className="relative w-10 shrink-0 select-none pr-3 text-right text-ink-faint">
                  {hit && <motion.span layoutId={`dot-${i}`} className="absolute left-1.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full" style={{ background: hit.color }} />}
                  {i + 1}
                </span>
                <span className={`min-w-0 truncate ${ln.startsWith("##") ? "font-semibold text-ink" : "text-ink/80"}`}>{ln || " "}</span>
                <AnimatePresence>
                  {hit && (
                    <motion.span initial={{ opacity: 0, x: 12, scale: 0.9 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0 }}
                      className="absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-full px-2.5 py-0.5 font-sans text-[11px] font-semibold text-white shadow-lg sm:block"
                      style={{ background: hit.color }}>
                      {hit.label[lang]}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
      <motion.div className="absolute -bottom-10 -left-8 hidden rounded-2xl border border-line bg-surface px-4 py-3 shadow-lift md:block"
        animate={{ y: [0, -8, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}>
        <div className="text-[11px] text-ink-faint">{t("ready.NOT READY")}</div>
        <div className="text-2xl font-semibold grad-text">72.3</div>
      </motion.div>
      <motion.div className="absolute -right-4 -top-12 hidden items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-2.5 shadow-lift md:flex"
        animate={{ y: [0, 8, 0] }} transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}>
        <HelpCircle size={16} className="text-violet" /><span className="text-[12.5px] font-medium">11 · {t("ov.questions")}</span>
      </motion.div>
    </div>
  );
}

const FEATURES = [
  { icon: Quote, k: "f1", c: "from-[#2557EB] to-[#0EA5E9]" },
  { icon: HelpCircle, k: "f2", c: "from-[#7C3AED] to-[#DB2777]" },
  { icon: Landmark, k: "f3", c: "from-[#0EA5E9] to-[#10B981]" },
  { icon: GitFork, k: "f4", c: "from-[#F76B15] to-[#E5484D]" },
  { icon: FileStack, k: "f5", c: "from-[#2557EB] to-[#7C3AED]" },
  { icon: Bot, k: "f6", c: "from-[#0EA5E9] to-[#7C3AED]" },
];

export default function Landing() {
  const { t } = useT();
  const up = { initial: { opacity: 0, y: 24 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-60px" }, transition: { duration: 0.6, ease: [0.2, 0.8, 0.2, 1] as const } };
  return (
    <div className="relative min-h-full overflow-hidden">
      <Aurora />
      <header className="sticky top-0 z-30 border-b border-line/60 bg-canvas/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3.5">
          <Link to="/" className="flex items-center gap-2.5"><Logo /><span className="text-[17px] font-semibold tracking-[0.08em]">LÜMEN</span></Link>
          <nav className="ml-6 hidden gap-6 text-sm text-ink-soft md:flex">
            <a href="#features" className="hover:text-ink">{t("land.navFeatures")}</a>
            <a href="#how" className="hover:text-ink">{t("land.navHow")}</a>
            <a href="#security" className="hover:text-ink">{t("land.navSecurity")}</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden sm:block"><LangSwitch /></div>
            <ThemeSwitch compact />
            <Link to="/dashboard" className="btn-line hidden md:inline-flex">{t("land.open")}</Link>
          </div>
        </div>
      </header>

      <main className="relative z-[1]">
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-5 pb-20 pt-16 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
          <motion.div className="min-w-0" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-[12.5px] text-ink-soft">
              <ShieldCheck size={14} className="text-ok" />ISO/IEC/IEEE 29148 · IEEE 830
            </div>
            <h1 className="hyphens-auto break-words text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[44px] md:text-[56px]">{t("land.title")}</h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-ink-soft">{t("land.sub")}</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link to="/new" className="btn-primary px-6 py-3 text-[15px]">{t("land.cta")}<ArrowRight size={17} /></Link>
              <Link to="/dashboard" className="btn-line px-6 py-3 text-[15px]">{t("land.open")}</Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-2 text-[12px] text-ink-faint">
              {["PDF", "Word", "Excel", "Markdown", "HTML", "RTF", "OCR"].map((f) => <span key={f} className="rounded-md border border-line bg-surface/60 px-2 py-0.5">{f}</span>)}
            </div>
          </motion.div>
          <motion.div className="min-w-0" initial={{ opacity: 0, scale: 0.96, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.15, ease: [0.2, 0.8, 0.2, 1] }}>
            <HeroLens />
          </motion.div>
        </section>

        <section className="mx-auto max-w-6xl px-5">
          <motion.div {...up} className="card grid grid-cols-2 divide-line overflow-hidden md:grid-cols-4 md:divide-x">
            {[[15, "land.s1"], [6, "land.s2"], [3, "land.s3"], [25, "land.s4"]].map(([n, k]) => (
              <div key={k as string} className="px-6 py-7 text-center">
                <div className="text-[40px] font-semibold leading-none grad-text"><Num value={n as number} /></div>
                <div className="meta mt-2">{t(k as string)}</div>
              </div>
            ))}
          </motion.div>
        </section>

        <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-24">
          <motion.h2 {...up} className="max-w-2xl text-[32px] font-semibold leading-tight tracking-[-0.02em] md:text-[40px]">{t("land.fTitle")}</motion.h2>
          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, k, c }, i) => (
              <motion.div key={k} {...up} transition={{ ...up.transition, delay: i * 0.06 }} className="card card-hover group p-6">
                <div className={`mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${c} text-white shadow-lg transition-transform group-hover:scale-110 group-hover:rotate-3`}>
                  <Icon size={21} />
                </div>
                <div className="text-[17px] font-semibold">{t(`land.${k}`)}</div>
                <p className="meta mt-2 leading-relaxed">{t(`land.${k}d`)}</p>
              </motion.div>
            ))}
          </div>
        </section>

        <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-5 pb-24">
          <motion.h2 {...up} className="text-[32px] font-semibold tracking-[-0.02em] md:text-[40px]">{t("land.hTitle")}</motion.h2>
          <ol className="relative mt-12 grid gap-6 md:grid-cols-4">
            <motion.div className="absolute left-0 right-0 top-6 hidden h-0.5 origin-left grad-bg md:block" initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }}
              viewport={{ once: true }} transition={{ duration: 1.2, ease: [0.2, 0.8, 0.2, 1] }} />
            {[1, 2, 3, 4].map((n) => (
              <motion.li key={n} {...up} transition={{ ...up.transition, delay: 0.15 * n }} className="relative">
                <div className="relative z-[1] flex h-12 w-12 items-center justify-center rounded-full border-4 border-canvas text-lg font-semibold text-white grad-bg shadow-glow">{n}</div>
                <div className="mt-4 text-[17px] font-semibold">{t(`land.h${n}`)}</div>
                <p className="meta mt-1.5">{t(`land.h${n}d`)}</p>
              </motion.li>
            ))}
          </ol>
        </section>

        <section id="security" className="mx-auto max-w-6xl scroll-mt-20 px-5 pb-24">
          <motion.div {...up} className="card flex flex-col gap-6 p-8 md:flex-row md:items-center">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-ok/15 text-ok"><Lock size={26} /></div>
            <div>
              <div className="text-[22px] font-semibold">{t("land.secTitle")}</div>
              <p className="meta mt-1.5 max-w-3xl leading-relaxed">{t("land.secD")}</p>
            </div>
          </motion.div>
        </section>

      </main>
      <footer className="relative z-[1] border-t border-line py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 text-[13px] text-ink-faint">
          <span className="flex items-center gap-2"><Logo size={20} />LÜMEN Requirements Intelligence</span>
          <span>{t("land.foot")}</span>
        </div>
      </footer>
    </div>
  );
}
