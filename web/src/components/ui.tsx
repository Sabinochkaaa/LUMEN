import { ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { motion, Variants } from "framer-motion";
import { Check, FileSearch, Moon, Sun } from "lucide-react";
import { Readiness, Severity, SEV_COLOR } from "../api";
import { LANGS, useT } from "../i18n";
import { Theme, useTheme } from "../theme";

/** Design 2.0 mark: the same L-with-a-dot, one colour (docs/DESIGN.md §6). */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="rgb(var(--primary))" />
      <path d="M10.5 7.5v17h11" stroke="rgb(var(--on-primary))" strokeWidth="3" fill="none" strokeLinecap="square" />
      <circle cx="21.5" cy="11" r="2.75" fill="rgb(var(--on-primary))" />
    </svg>
  );
}

export function SevBadge({ sev, short }: { sev: Severity; short?: boolean }) {
  const { t } = useT();
  const c = SEV_COLOR[sev];
  return (
    <span className="chip" style={{ background: c + "1A", color: c }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {short ? sev : t(`sev.${sev}`)}
    </span>
  );
}

const TONE: Record<Readiness, string> = {
  "READY": "bg-ok/10 text-ok border-ok/30",
  "READY WITH CONDITIONS": "bg-warn/10 text-warn border-warn/30",
  "NOT READY": "bg-bad/10 text-bad border-bad/30",
  "INSUFFICIENT DATA": "bg-surface-2 text-ink-soft border-line",
};
export function ReadinessBadge({ r, large }: { r: Readiness; large?: boolean }) {
  const { t } = useT();
  return (
    <span className={`inline-flex items-center gap-2 rounded border ${TONE[r]} ${large ? "px-3 py-1.5 text-sm font-semibold" : "px-2 py-0.5 text-xs font-medium"}`}>
      <span className="h-2 w-2 rounded-full bg-current" />
      {t(`ready.${r}`)}
    </span>
  );
}

/** A number formatted for the current language — no count-up animation in 2.0. */
export function Num({ value, decimals = 0, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const { lang } = useT();
  const loc = lang === "kk" ? "kk-KZ" : lang === "en" ? "en-GB" : "ru-RU";
  const s = (Number.isFinite(value) ? value : 0).toLocaleString(loc, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return <span className="tabular-nums">{s}{suffix}</span>;
}

/** Quality index 0–100 as a bar with the verdict thresholds at 60 and 80. Name kept for existing callers. */
export function QualityArc({ value, size = 150 }: { value: number; size?: number }) {
  const { t } = useT();
  const pct = Math.max(0, Math.min(100, value));
  const tone = pct >= 80 ? "rgb(var(--ok))" : pct >= 60 ? "rgb(var(--warn))" : "rgb(var(--bad))";
  return (
    <div style={{ width: Math.max(size, 180) }}>
      <div className="meta">{t("home.quality")}</div>
      <div className="mt-1 text-[32px] font-medium leading-10 tracking-tight"><Num value={value} decimals={1} /></div>
      <div className="relative mt-2 h-2 rounded-sm bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("home.quality")}>
        <motion.div className="h-full rounded-sm" style={{ background: tone }} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5, ease: "easeOut" }} />
        {[60, 80].map((m) => <span key={m} className="absolute -top-1 h-4 w-px bg-ink/30" style={{ left: `${m}%` }} />)}
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-ink-faint tabular-nums">
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2" style={{ left: "60%" }}>60</span>
        <span className="absolute -translate-x-1/2" style={{ left: "80%" }}>80</span>
        <span className="absolute right-0">100</span>
      </div>
    </div>
  );
}

export function Stat({ value, label, tone, to, decimals = 0, suffix = "" }: { value: number; label: string; tone?: string; to?: string; decimals?: number; suffix?: string }) {
  const body = (
    <div className={`card h-full px-5 py-4 ${to ? "card-hover" : ""}`}>
      <div className="meta">{label}</div>
      <div className="mt-1 text-[28px] font-medium leading-8 tracking-tight" style={tone ? { color: tone } : undefined}><Num value={value} decimals={decimals} suffix={suffix} /></div>
    </div>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center px-8 py-14 text-center">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-md border border-line bg-surface-2 text-ink-soft"><FileSearch size={20} strokeWidth={1.6} /></div>
      <div className="h2">{title}</div>
      <p className="meta mt-1 max-w-md">{text}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Loading({ text }: { text?: string }) {
  const { t } = useT();
  return (
    <div className="py-6" role="status" aria-live="polite">
      <div className="meta mb-4">{text ?? t("ui.loading")}</div>
      <div className="space-y-2.5">
        <div className="skeleton h-4 w-1/3" />
        <div className="skeleton h-4 w-2/3" />
        <div className="skeleton h-4 w-1/2" />
      </div>
    </div>
  );
}

export function ErrorBox({ error }: { error: string }) {
  return <div className="rounded-md border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad" role="alert">{error}</div>;
}

export function PageHead({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div className="min-w-0">
        <h1 className="h1">{title}</h1>
        {sub && <div className="meta mt-1 max-w-2xl">{sub}</div>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

const THEMES: { id: Theme; icon: typeof Sun }[] = [{ id: "light", icon: Sun }, { id: "dark", icon: Moon }];

function Segmented({ label, children }: { label: string; children: ReactNode }) {
  return <div className="inline-flex rounded-md border border-line bg-surface p-0.5" role="radiogroup" aria-label={label}>{children}</div>;
}
const segBtn = (on: boolean) => `flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${on ? "bg-surface-2 text-ink shadow-[inset_0_0_0_1px_rgb(var(--line))]" : "text-ink-soft hover:text-ink"}`;

export function ThemeSwitch({ compact }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const { t } = useT();
  return (
    <Segmented label={t("ui.theme")}>
      {THEMES.map(({ id, icon: Icon }) => (
        <button key={id} role="radio" aria-checked={theme === id} title={t(`theme.${id}`)} onClick={() => setTheme(id)} className={segBtn(theme === id)}>
          <Icon size={14} />
          {!compact && <span>{t(`theme.${id}`)}</span>}
        </button>
      ))}
    </Segmented>
  );
}

export function LangSwitch() {
  const { lang, setLang, t } = useT();
  return (
    <Segmented label={t("ui.language")}>
      {LANGS.map((l) => (
        <button key={l.code} role="radio" aria-checked={lang === l.code} title={l.label} onClick={() => setLang(l.code)} className={segBtn(lang === l.code)}>
          {l.short}
        </button>
      ))}
    </Segmented>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useT();
  const [done, setDone] = useStateFlag();
  return (
    <button className="btn-line" onClick={async () => { await navigator.clipboard.writeText(text); setDone(); }}>
      {done ? <><Check size={15} />{t("ui.copied")}</> : label}
    </button>
  );
}

function useStateFlag(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  return [on, () => { setOn(true); setTimeout(() => setOn(false), 1600); }];
}

export function fmtDate(iso: string, lang = "ru") {
  try {
    return new Date(iso).toLocaleString(lang === "kk" ? "kk-KZ" : lang === "en" ? "en-GB" : "ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

// page entrance: short and blur-free (docs/DESIGN.md §7)
export const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.04 } } };
export const rise: Variants = { hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: "easeOut" } } };
