import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, CheckCircle2, FileSpreadsheet, FileText, FileType, Lock, Send } from "lucide-react";
import { Aurora } from "../App";
import { CRIT_I18N, Lang, pick, useT } from "../i18n";
import { LangSwitch, Logo, ThemeSwitch } from "../components/ui";

const DOC: Record<Lang, string[]> = {
  ru: ["## Функциональные требования", "Ф-1. Клиент задаёт порог от 1 000 до 1 000 000 ₸.", "Ф-2. В расходы входят проведённые покупки.",
    "Ф-3. Система быстро отправляет push-уведомление.", "Ф-4. Сумма хранится в тиынах, порог — в тенге.", "## REST API",
    "REST type: GET · /alerts/saveLimit", "200 OK: {\"result\":\"ERROR\"}", "## Критерии приёмки", "Покупка 31.01 в 23:58 → счётчик февраля"],
  kk: ["## Функционалдық талаптар", "Ф-1. Клиент 1 000-нан 1 000 000 ₸-ге дейін шек қояды.", "Ф-2. Шығысқа өткізілген сатып алулар кіреді.",
    "Ф-3. Жүйе push-хабарламаны жылдам жібереді.", "Ф-4. Сома тиынмен, шек теңгемен сақталады.", "## REST API",
    "REST type: GET · /alerts/saveLimit", "200 OK: {\"result\":\"ERROR\"}", "## Қабылдау өлшемдері", "Сатып алу 31.01, 23:58 → ақпан есептегіші"],
  en: ["## Functional requirements", "F-1. The client sets a threshold of 1,000–1,000,000 ₸.", "F-2. Spending includes posted purchases.",
    "F-3. The system sends a push notification quickly.", "F-4. Amounts stored in tiyn, threshold in tenge.", "## REST API",
    "REST type: GET · /alerts/saveLimit", "200 OK: {\"result\":\"ERROR\"}", "## Acceptance criteria", "Purchase 31 Jan 23:58 → February counter"],
};
const NOTES: { line: number; sev: string; mark: string; text: Record<Lang, string> }[] = [
  { line: 3, sev: "HIGH", mark: "#FFB061", text: { ru: "«Быстро» — без числа и условий измерения", kk: "«Жылдам» — сансыз және өлшеу шартынсыз", en: "“Quickly” — no number or measurement conditions" } },
  { line: 2, sev: "HIGH", mark: "#FFD43B", text: { ru: "«Проведённая» — авторизация или клиринг?", kk: "«Өткізілген» — авторизация ма, клиринг пе?", en: "“Posted” — authorization or clearing?" } },
  { line: 6, sev: "HIGH", mark: "#FF8A8A", text: { ru: "GET не должен менять состояние (RFC 9110)", kk: "GET күйді өзгертпеуі тиіс (RFC 9110)", en: "GET must not change state (RFC 9110)" } },
  { line: 9, sev: "CRITICAL", mark: "#FF8A8A", text: { ru: "Противоречит Ф-2: месяц по дате покупки", kk: "Ф-2-ге қайшы: ай сатып алу күні бойынша", en: "Contradicts F-2: month by purchase date" } },
];
const SEVC: Record<string, string> = { CRITICAL: "#E5484D", HIGH: "#F2711C" };

function ReviewDoc() {
  const { lang, t } = useT();
  const [n, setN] = useState(0);
  useEffect(() => { const id = setInterval(() => setN((x) => (x + 1) % (NOTES.length + 3)), 1500); return () => clearInterval(id); }, []);
  const shown = NOTES.slice(0, Math.min(n, NOTES.length));
  const lines = DOC[lang];
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_230px]">
      <div className="card relative overflow-hidden shadow-lift">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[12px] text-ink-faint">
          <FileText size={14} />requirements.md
          <span className="ml-auto rounded-md bg-ink/5 px-2 py-0.5 font-medium tabular-nums text-ink-soft">{shown.length} / {NOTES.length}</span>
        </div>
        <div className="relative py-3 font-mono text-[12.5px] leading-[1.95]">
          <div className="lens-beam" />
          {lines.map((ln, i) => {
            const note = shown.find((h) => h.line === i);
            const head = ln.startsWith("##");
            return (
              <div key={i} className="relative flex pr-4">
                <span className="w-10 shrink-0 select-none pr-3 text-right text-ink-faint">{i + 1}</span>
                <span className={`min-w-0 truncate ${head ? "font-sans font-semibold text-ink" : "text-ink/80"}`}>
                  <motion.span animate={{ backgroundSize: note ? "100% 100%" : "0% 100%" }} transition={{ duration: 0.5, ease: "easeOut" }}
                    style={{ backgroundImage: note ? `linear-gradient(100deg, transparent .5%, ${note.mark} 2%, ${note.mark}cc 97%, transparent 99%)` : undefined,
                      backgroundRepeat: "no-repeat", color: note ? "#0B1F33" : undefined, borderRadius: 4, padding: "1px 3px" }}>
                    {head ? ln.slice(3) : ln}
                  </motion.span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <div className="text-[12px] font-medium text-ink-faint">{t("land.margin")}</div>
        <AnimatePresence initial={false}>
          {shown.map((h) => (
            <motion.div key={h.line} layout initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
              className="card px-3 py-2.5 text-[12.5px] leading-snug" style={{ borderLeft: `3px solid ${h.mark}` }}>
              <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: SEVC[h.sev] }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: SEVC[h.sev] }} />{h.sev} · {t("ui.line")} {h.line + 1}
              </div>
              {h.text[lang]}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function AskTile() {
  const { t } = useT();
  const [pick_, setPick] = useState<number | null>(null);
  const opts = [t("land.demoO1"), t("land.demoO2"), t("land.demoO3")];
  return (
    <div className="mt-5 rounded-xl border border-line bg-surface-2 p-4">
      <div className="text-[14.5px] font-medium">{t("land.demoQ")}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {opts.map((o, i) => (
          <motion.button key={o} whileTap={{ scale: 0.96 }} onClick={() => setPick(i)}
            className={`rounded-lg border px-3 py-1.5 text-[13px] transition-colors ${pick_ === i ? "border-transparent bg-marker text-[#0B1F33]" : "border-line hover:border-ink/30"}`}>{o}</motion.button>
        ))}
      </div>
      <div className="mt-3 h-5 text-[12.5px]">
        <AnimatePresence mode="wait">
          {pick_ === null ? <motion.span key="h" className="text-ink-faint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>{t("land.demoPick")}</motion.span>
            : <motion.span key="d" className="flex items-center gap-1.5 font-medium text-ok" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}><CheckCircle2 size={14} />{t("land.demoDone")}</motion.span>}
        </AnimatePresence>
      </div>
    </div>
  );
}

const CRITS = ["unambiguous", "verifiable", "complete", "consistent", "singular", "feasible", "traceable", "correct", "necessary",
  "implementation_free", "acceptance", "boundaries", "errors_defined", "set_consistent", "integration_contract", "terminology", "ranked", "modifiable"];

export default function Landing() {
  const { t, lang } = useT();
  const up = { initial: { opacity: 0, y: 22 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-60px" }, transition: { duration: 0.55, ease: [0.2, 0.8, 0.2, 1] as const } };
  const tile = "card card-hover p-6";
  return (
    <div className="relative min-h-full overflow-hidden">
      <Aurora />
      <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3.5">
          <Link to="/" className="flex items-center gap-2.5"><Logo /><span className="font-display text-[18px] font-semibold tracking-[0.06em]">LÜMEN</span></Link>
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
        <section className="mx-auto max-w-6xl px-5 pb-16 pt-14 lg:pt-20">
          <motion.div className="min-w-0 max-w-3xl" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <h1 className="hyphens-auto break-words md:hyphens-manual text-[34px] font-bold leading-[1.06] tracking-[-0.035em] sm:text-[46px] md:text-[60px]">{t("land.title")}</h1>
            <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-ink-soft">{t("land.sub")}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/new" className="btn-primary px-6 py-3 text-[15px]">{t("land.cta")}</Link>
              <Link to="/dashboard" className="btn-line px-6 py-3 text-[15px]">{t("land.open")}</Link>
            </div>
          </motion.div>
          <motion.div className="mt-12 min-w-0" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.15 }}>
            <ReviewDoc />
          </motion.div>
        </section>

        <section aria-label={t("land.checks")} className="border-y border-line bg-surface/60 py-4">
          <div className="flex overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
            <div className="flex shrink-0 animate-marquee gap-8 pr-8 hover:[animation-play-state:paused]">
              {[...CRITS, ...CRITS].map((k, i) => (
                <span key={i} className="flex items-center gap-2 whitespace-nowrap text-[14px] text-ink-soft">
                  <Check size={14} className="text-ok" />{pick(CRIT_I18N[k], lang, k)}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
          <motion.h2 {...up} className="max-w-2xl text-[30px] font-bold leading-tight tracking-[-0.03em] md:text-[42px]">{t("land.fTitle")}</motion.h2>
          <div className="mt-10 grid gap-4 md:grid-cols-6">
            <motion.div {...up} className={`${tile} md:col-span-4`}>
              <div className="text-[19px] font-semibold"><span className="mark">{t("land.f2")}</span></div>
              <p className="meta mt-2 max-w-xl leading-relaxed">{t("land.f2d")}</p>
              <AskTile />
            </motion.div>
            <motion.div {...up} className={`${tile} md:col-span-2`}>
              <div className="text-[17px] font-semibold">{t("land.f1")}</div>
              <p className="meta mt-2 leading-relaxed">{t("land.f1d")}</p>
              <div className="mt-4 rounded-lg border-l-2 border-marker bg-marker/10 px-3 py-2 font-mono text-[12px]">
                <span className="text-ink-faint">38 │ </span>{DOC[lang][2]}
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-ok"><CheckCircle2 size={13} />{t("land.quoteOk")}</div>
            </motion.div>
            <motion.div {...up} className={`${tile} md:col-span-2`}>
              <div className="text-[17px] font-semibold">{t("land.f5")}</div>
              <p className="meta mt-2 leading-relaxed">{t("land.f5d")}</p>
              <div className="mt-5 flex gap-2">
                {[{ i: FileType, n: "PDF", c: "#E5484D" }, { i: FileText, n: "Word", c: "#2F86E8" }, { i: FileSpreadsheet, n: "Excel", c: "#13A36E" }].map(({ i: Icon, n, c }, k) => (
                  <motion.div key={n} whileHover={{ y: -4, rotate: k - 1 }} className="flex flex-1 flex-col items-center gap-1 rounded-xl border border-line bg-surface-2 py-3 text-[12px] font-medium">
                    <Icon size={22} style={{ color: c }} />{n}
                  </motion.div>
                ))}
              </div>
            </motion.div>
            <motion.div {...up} className={`${tile} md:col-span-2`}>
              <div className="text-[17px] font-semibold">{t("land.f6")}</div>
              <p className="meta mt-2 leading-relaxed">{t("land.f6d")}</p>
              <div className="mt-4 space-y-2 text-[13px]">
                <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-fill px-3 py-2 text-white">{t("land.tgUser")}</div>
                <div className="w-fit max-w-[90%] rounded-2xl rounded-bl-md border border-line bg-surface-2 px-3 py-2">{t("land.tgBot")}</div>
                <div className="flex w-fit items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2"><FileSpreadsheet size={16} className="text-ok" />lumen_report.xlsx</div>
              </div>
            </motion.div>
            <motion.div {...up} className={`${tile} md:col-span-2`}>
              <div className="text-[17px] font-semibold">{t("land.f3")}</div>
              <p className="meta mt-2 leading-relaxed">{t("land.f3d")}</p>
              <ul className="mt-4 space-y-1.5 text-[13px]">
                {[["land.finA1", "fin.missing", "bad"], ["land.finA2", "fin.partial", "warn"], ["land.finA3", "fin.na", "ink-faint"]].map(([a, s, c]) => (
                  <li key={a} className="flex items-center justify-between rounded-lg bg-ink/[0.04] px-3 py-1.5">
                    <span>{t(a)}</span><span className="text-[12px] font-medium" style={{ color: `rgb(var(--${c}))` }}>{t(s)}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
            <motion.div {...up} className={`${tile} md:col-span-3`}>
              <div className="text-[17px] font-semibold">{t("land.f4")}</div>
              <p className="meta mt-2 leading-relaxed">{t("land.f4d")}</p>
              <svg viewBox="0 0 360 110" className="mt-4 w-full" aria-hidden>
                <path d="M70 55 C 130 10, 170 10, 230 40" stroke="#E5484D" strokeWidth="2" fill="none" strokeDasharray="5 4"><animate attributeName="stroke-dashoffset" from="18" to="0" dur="1s" repeatCount="indefinite" /></path>
                <path d="M70 55 C 130 100, 220 100, 290 75" stroke="rgb(var(--brand))" strokeWidth="1.6" fill="none" />
                {[[40, 55, lang === "en" ? "F-2" : "Ф-2"], [230, 40, lang === "en" ? "AC-2" : "КП-2"], [300, 75, "API"]].map(([x, y, l], i) => (
                  <g key={i}><rect x={(x as number) - 30} y={(y as number) - 14} width="60" height="28" rx="8" fill="rgb(var(--surface-2))" stroke={i === 1 ? "#E5484D" : "rgb(var(--line))"} strokeWidth="1.5" />
                    <text x={x as number} y={(y as number) + 4} textAnchor="middle" fontSize="12" fill="rgb(var(--ink))" fontFamily="Onest Variable">{l}</text></g>
                ))}
              </svg>
            </motion.div>
            <motion.div {...up} id="security" className={`${tile} scroll-mt-24 md:col-span-3`}>
              <div className="flex items-center gap-2 text-[17px] font-semibold"><Lock size={18} className="text-ok" />{t("land.secTitle")}</div>
              <p className="meta mt-2 leading-relaxed">{t("land.secD")}</p>
              <div className="mt-4 flex flex-wrap gap-1.5 text-[12px]">
                {["AES-256-GCM", "HTTPS · HSTS", "CSP", "Rate limits", "RLS", "OCR"].map((x) => <span key={x} className="rounded-md border border-line px-2 py-0.5 text-ink-soft">{x}</span>)}
              </div>
            </motion.div>
          </div>
        </section>

        <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-5 pb-24">
          <motion.h2 {...up} className="text-[30px] font-bold tracking-[-0.03em] md:text-[42px]">{t("land.hTitle")}</motion.h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-4">
            {[1, 2, 3, 4].map((n) => (
              <motion.li key={n} {...up} transition={{ ...up.transition, delay: 0.1 * n }} className="border-t-2 border-ink pt-4">
                <div className="font-display text-[44px] font-bold leading-none tracking-tight"><span className="mark px-1">{String(n).padStart(2, "0")}</span></div>
                <div className="mt-4 text-[17px] font-semibold">{t(`land.h${n}`)}</div>
                <p className="meta mt-1.5">{t(`land.h${n}d`)}</p>
              </motion.li>
            ))}
          </ol>
        </section>
      </main>
      <footer className="relative z-[1] border-t border-line py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 text-[13px] text-ink-faint">
          <span className="flex items-center gap-2"><Logo size={20} />LÜMEN Requirements Intelligence</span>
          <span className="flex items-center gap-1.5"><Send size={13} />Telegram · Web · API · CLI</span>
          <span>{t("land.foot")}</span>
        </div>
      </footer>
    </div>
  );
}
