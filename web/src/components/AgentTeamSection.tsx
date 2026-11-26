import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Lang, useT } from "../i18n";
import { AGENT_COLORS } from "./agents";

const AgentTeam3D = lazy(() => import("./AgentTeam3D"));

type Agent = { name: Record<Lang, string>; role: Record<Lang, string>; text: Record<Lang, string> };

const AGENTS: Agent[] = [
  { name: { ru: "Аналитик", kk: "Талдаушы", en: "Analyst" },
    role: { ru: "Читает ТЗ целиком", kk: "ТТ-ны толық оқиды", en: "Reads the whole spec" },
    text: { ru: "Делит документ на требования и проверяет каждое по 15 критериям ISO/IEC/IEEE 29148 и IEEE 830: однозначность, проверяемость, полнота, противоречия.",
            kk: "Құжатты талаптарға бөліп, әрқайсысын ISO/IEC/IEEE 29148 және IEEE 830 бойынша 15 өлшеммен тексереді: бірмәнділік, тексерілуі, толықтығы, қайшылықтар.",
            en: "Splits the document into requirements and checks each against 15 ISO/IEC/IEEE 29148 and IEEE 830 criteria: unambiguous, verifiable, complete, consistent." } },
  { name: { ru: "Скептик", kk: "Скептик", en: "Skeptic" },
    role: { ru: "Не верит на слово", kk: "Сөзге сенбейді", en: "Trusts nothing" },
    text: { ru: "Сверяет каждую цитату с исходным файлом и перепроверяет критичные замечания. Нет совпадения — замечание не влияет на вердикт.",
            kk: "Әр дәйексөзді бастапқы файлмен салыстырып, маңызды ескертулерді қайта тексереді. Сәйкестік болмаса — ескерту қорытындыға әсер етпейді.",
            en: "Matches every quote against the source file and re-checks critical findings. No match — the finding does not affect the verdict." } },
  { name: { ru: "FinTech-эксперт", kk: "FinTech-сарапшы", en: "FinTech expert" },
    role: { ru: "Думает о деньгах клиента", kk: "Клиент ақшасын ойлайды", en: "Thinks about client money" },
    text: { ru: "Проверяет 20 банковских аспектов: тиыны и тенге, повторные платежи, возвраты, статусы операций, часовой пояс, персональные данные.",
            kk: "20 банктік аспектіні тексереді: тиын мен теңге, қайталанған төлемдер, қайтарулар, операция мәртебелері, уақыт белдеуі, дербес деректер.",
            en: "Checks 20 banking aspects: tiyn vs tenge, duplicate payments, refunds, operation statuses, time zones, personal data." } },
  { name: { ru: "Переводчик", kk: "Аудармашы", en: "Translator" },
    role: { ru: "Говорит на трёх языках", kk: "Үш тілде сөйлейді", en: "Speaks three languages" },
    text: { ru: "Переводит ТЗ между русским, казахским и английским с сохранением структуры, а на фото кладёт перевод прямо поверх текста.",
            kk: "ТТ-ны орыс, қазақ және ағылшын тілдері арасында құрылымын сақтап аударады, ал фотода аударманы мәтіннің үстіне қояды.",
            en: "Translates specs between Russian, Kazakh and English keeping the structure, and lays the translation right over the text on photos." } },
  { name: { ru: "Поддержка", kk: "Қолдау", en: "Support" },
    role: { ru: "На связи 24/7", kk: "24/7 байланыста", en: "On call 24/7" },
    text: { ru: "Отвечает на вопросы о LÜMEN и о вашем отчёте на сайте и в Telegram. Не знает ответа — честно говорит и передаёт вопрос команде.",
            kk: "LÜMEN және сіздің есебіңіз туралы сұрақтарға сайтта және Telegram-да жауап береді. Жауабын білмесе — шынын айтып, сұрақты командаға береді.",
            en: "Answers questions about LÜMEN and your report on the site and in Telegram. Doesn’t know — says so and hands the question to the team." } },
];

export default function AgentTeamSection() {
  const { lang, t } = useT();
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

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
              <motion.div animate={{ opacity: active === i ? 1 : 0.35, x: active === i ? 0 : -6 }} transition={{ duration: 0.4 }}
                className="max-w-md border-l-4 pl-6" style={{ borderColor: AGENT_COLORS[i] }}>
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
            <Suspense fallback={null}><AgentTeam3D active={active} className="h-full w-full" /></Suspense>
            <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center gap-2">
              {AGENTS.map((a, i) => (
                <span key={i} className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-all ${active === i ? "" : "hidden sm:inline"}`}
                  style={{ background: active === i ? AGENT_COLORS[i] : "transparent", color: active === i ? (i === 1 ? "#101C36" : "#fff") : "rgb(var(--ink-faint))" }}>
                  {a.name[lang]}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
