import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { animate, motion, useInView, Variants } from "framer-motion";
import { Check } from "lucide-react";
import { Readiness, Severity, SEV_COLOR } from "../api";
import { useT } from "../i18n";
import { Logo } from "./ui";

/**
 * Panel content kit from design 1.0 (gradients, count-up numbers, the quality arc).
 * The menu, logo, theme and language switches stay on the current design and are re-exported from ./ui.
 */
export { LangSwitch, Logo, ThemeSwitch } from "./ui";

export function SevBadge({ sev, short }: { sev: Severity; short?: boolean }) {
  const { t } = useT();
  const c = SEV_COLOR[sev];
  return (
    <span className="chip" style={{ background: c + "22", color: c }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {short ? sev : t(`sev.${sev}`)}
    </span>
  );
}

const TONE: Record<Readiness, string> = {
  "READY": "bg-ok/15 text-ok ring-ok/30",
  "READY WITH CONDITIONS": "bg-warn/15 text-warn ring-warn/30",
  "NOT READY": "bg-bad/15 text-bad ring-bad/30",
  "INSUFFICIENT DATA": "bg-ink/5 text-ink-soft ring-line",
};
export function ReadinessBadge({ r, large }: { r: Readiness; large?: boolean }) {
  const { t } = useT();
  return (
    <span className={`inline-flex items-center gap-2 rounded-full ring-1 ${TONE[r]} ${large ? "px-4 py-1.5 text-sm font-semibold" : "px-2.5 py-0.5 text-xs font-medium"}`}>
      <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-40" /><span className="relative h-2 w-2 rounded-full bg-current" /></span>
      {t(`ready.${r}`)}
    </span>
  );
}

/** Counts up when it scrolls into view. */
export function Num({ value, decimals = 0, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true });
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!seen) return;
    const c = animate(0, value, { duration: 1.1, ease: [0.2, 0.8, 0.2, 1], onUpdate: setV });
    return () => c.stop();
  }, [seen, value]);
  return <span ref={ref} className="tabular-nums">{v.toFixed(decimals)}{suffix}</span>;
}

export function QualityArc({ value, size = 150 }: { value: number; size?: number }) {
  const { t } = useT();
  const arcId = "arc" + useId().replace(/:/g, "");
  const r = size / 2 - 10, c = Math.PI * r;
  const pct = Math.max(0, Math.min(100, value)) / 100;
  return (
    <div className="relative" style={{ width: size, height: size / 2 + 22 }}>
      <svg width={size} height={size / 2 + 10} viewBox={`0 0 ${size} ${size / 2 + 10}`} aria-hidden>
        <defs><linearGradient id={arcId} x1="0" x2="1"><stop offset="0" stopColor="rgb(var(--signal))" /><stop offset=".5" stopColor="rgb(var(--violet))" /><stop offset="1" stopColor="rgb(var(--sky))" /></linearGradient></defs>
        <path d={`M10 ${size / 2} A ${r} ${r} 0 0 1 ${size - 10} ${size / 2}`} fill="none" stroke="rgb(var(--line))" strokeWidth="9" strokeLinecap="round" />
        <motion.path d={`M10 ${size / 2} A ${r} ${r} 0 0 1 ${size - 10} ${size / 2}`} fill="none" stroke={`url(#${arcId})`} strokeWidth="9"
          strokeLinecap="round" initial={{ strokeDasharray: `0 ${c}` }} animate={{ strokeDasharray: `${c * pct} ${c}` }} transition={{ duration: 1.3, ease: [0.2, 0.8, 0.2, 1] }} />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <div className="text-[36px] font-semibold leading-none tracking-tight"><Num value={value} decimals={1} /></div>
        <div className="meta mt-1">{t("home.quality")}</div>
      </div>
    </div>
  );
}

export function Stat({ value, label, tone, to, decimals = 0, suffix = "" }: { value: number; label: string; tone?: string; to?: string; decimals?: number; suffix?: string }) {
  const body = (
    <div className="card card-hover h-full px-5 py-4">
      <div className="text-[28px] font-semibold tracking-tight" style={tone ? { color: tone } : undefined}><Num value={value} decimals={decimals} suffix={suffix} /></div>
      <div className="meta mt-0.5">{label}</div>
    </div>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card flex flex-col items-center justify-center px-8 py-16 text-center">
      <div className="mb-5 animate-floaty"><Logo size={56} /></div>
      <div className="h2">{title}</div>
      <p className="meta mt-1 max-w-md">{text}</p>
      {action && <div className="mt-6">{action}</div>}
    </motion.div>
  );
}

export function Loading({ text }: { text?: string }) {
  const { t } = useT();
  return (
    <div className="flex items-center gap-3 meta py-10">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-signal border-t-transparent" />
      {text ?? t("ui.loading")}
    </div>
  );
}

export function ErrorBox({ error }: { error: string }) {
  return <div className="rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">{error}</div>;
}

export function PageHead({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="h1">{title}</h1>
        {sub && <div className="meta mt-1.5 max-w-2xl">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useT();
  const [done, setDone] = useState(false);
  return (
    <button className="btn-line" onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600); }}>
      {done ? <><Check size={15} />{t("ui.copied")}</> : label}
    </button>
  );
}

export function fmtDate(iso: string, lang = "ru") {
  try {
    return new Date(iso).toLocaleString(lang === "kk" ? "kk-KZ" : lang === "en" ? "en-GB" : "ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

export const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
export const rise: Variants = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.2, 0.8, 0.2, 1] as const } } };
