import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Readiness, READY_RU, Severity, SEV_COLOR, SEV_RU } from "../api";

export function SevBadge({ sev, short }: { sev: Severity; short?: boolean }) {
  const c = SEV_COLOR[sev];
  return (
    <span className="chip" style={{ background: c + "18", color: c }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {short ? sev : SEV_RU[sev]}
    </span>
  );
}

const TONES: Record<string, string> = {
  ready: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  cond: "bg-amber-50 text-amber-800 ring-amber-200",
  not: "bg-red-50 text-red-700 ring-red-200",
  none: "bg-slate-100 text-slate-600 ring-slate-200",
};

export function ReadinessBadge({ r, large }: { r: Readiness; large?: boolean }) {
  const info = READY_RU[r];
  return (
    <span className={`inline-flex items-center gap-2 rounded-full ring-1 ${TONES[info.tone]} ${large ? "px-4 py-1.5 text-sm font-semibold" : "px-2.5 py-0.5 text-xs font-medium"}`}>
      <span className="h-2 w-2 rounded-full bg-current" />
      {info.label}
    </span>
  );
}

/** Quality index as a thin arc; the number is the hero, the arc only gives scale. */
export function QualityArc({ value, size = 150 }: { value: number; size?: number }) {
  const r = size / 2 - 10, c = Math.PI * r;
  const pct = Math.max(0, Math.min(100, value)) / 100;
  const color = value >= 80 ? "#12A150" : value >= 60 ? "#1F4FD8" : value >= 40 ? "#E8620C" : "#D92D20";
  return (
    <div className="relative" style={{ width: size, height: size / 2 + 18 }}>
      <svg width={size} height={size / 2 + 10} viewBox={`0 0 ${size} ${size / 2 + 10}`} aria-hidden>
        <path d={`M10 ${size / 2} A ${r} ${r} 0 0 1 ${size - 10} ${size / 2}`} fill="none" stroke="#E4E8F0" strokeWidth="8" strokeLinecap="round" />
        <path d={`M10 ${size / 2} A ${r} ${r} 0 0 1 ${size - 10} ${size / 2}`} fill="none" stroke={color} strokeWidth="8"
          strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} style={{ transition: "stroke-dasharray 1.2s cubic-bezier(.2,.8,.2,1)" }} />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <div className="text-[34px] font-semibold leading-none tracking-tight tabular-nums">{value.toFixed(1)}</div>
        <div className="meta mt-1">индекс качества из 100</div>
      </div>
    </div>
  );
}

export function Stat({ value, label, tone, to }: { value: ReactNode; label: string; tone?: string; to?: string }) {
  const body = (
    <div className="card px-5 py-4 h-full hover:border-signal/30 transition-colors">
      <div className="text-[26px] font-semibold tabular-nums tracking-tight" style={tone ? { color: tone } : undefined}>{value}</div>
      <div className="meta mt-0.5">{label}</div>
    </div>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center px-8 py-16 text-center">
      <svg width="56" height="56" viewBox="0 0 56 56" className="mb-4" aria-hidden>
        <rect x="12" y="6" width="32" height="44" rx="6" fill="#EAF0FF" />
        {[16, 23, 30, 37].map((y, i) => <rect key={y} x="18" y={y} width={i === 2 ? 12 : 20} height="3" rx="1.5" fill="#B7C8F5" />)}
        <circle cx="40" cy="40" r="9" fill="none" stroke="#1F4FD8" strokeWidth="3" />
        <path d="M46.5 46.5 51 51" stroke="#1F4FD8" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <div className="h2">{title}</div>
      <p className="meta mt-1 max-w-md">{text}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Loading({ text = "Загружаем…" }: { text?: string }) {
  return (
    <div className="flex items-center gap-3 meta py-10">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-signal border-t-transparent" />
      {text}
    </div>
  );
}

export function ErrorBox({ error }: { error: string }) {
  return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
}

export function PageHead({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="h1">{title}</h1>
        {sub && <div className="meta mt-1.5">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}
