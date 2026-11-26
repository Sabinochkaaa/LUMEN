import type { Lang } from "../i18n";

export const AGENT_COLORS = ["#2F6BFF", "#C9CED8", "#F28C28", "#7C4DFF", "#F0453A"];

export type Agent = { name: Record<Lang, string>; role: Record<Lang, string>; text: Record<Lang, string> };

export const AGENTS: Agent[] = [
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

