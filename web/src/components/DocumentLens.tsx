import { useEffect, useMemo, useRef } from "react";
import { Finding, Line, SEV_COLOR, SEV_ORDER, Severity } from "../api";
import { useT } from "../i18n";

interface Props {
  lines: Line[];
  findings?: Finding[];
  scanning?: boolean;
  focusLine?: number | null;
  onLine?: (no: number, hits: Finding[]) => void;
  height?: number | string;
  dim?: boolean;
}

/** The document itself, with a line gutter; findings attach to the exact lines they cite. */
export default function DocumentLens({ lines, findings = [], scanning, focusLine, onLine, height = 560, dim }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const { t } = useT();
  const hits = useMemo(() => {
    const m = new Map<number, Finding[]>();
    for (const f of findings) {
      if (!f.loc) continue;
      for (let n = f.loc.line_start; n <= f.loc.line_end; n++) m.set(n, [...(m.get(n) || []), f]);
    }
    return m;
  }, [findings]);

  useEffect(() => {
    if (!focusLine || !box.current) return;
    const el = box.current.querySelector<HTMLElement>(`[data-line="${focusLine}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusLine]);

  const top = (fs: Finding[]): Severity => SEV_ORDER.find((s) => fs.some((f) => f.severity === s)) || "INFO";

  return (
    <div ref={box} className="relative overflow-auto rounded-xl border border-line bg-surface-2" style={{ height }}>
      {scanning && <div className="lens-beam" />}
      <div className="py-2 font-mono text-[12.5px] leading-[1.7]">
        {lines.map((ln) => {
          const fs = hits.get(ln.no);
          const sev = fs ? top(fs) : null;
          const c = sev ? SEV_COLOR[sev] : undefined;
          const focused = focusLine === ln.no;
          return (
            <div
              key={ln.no}
              data-line={ln.no}
              onClick={() => fs && onLine?.(ln.no, fs)}
              className={`lens-line-hit group flex ${fs ? "cursor-pointer hover:brightness-110" : ""} ${focused ? "ring-1 ring-inset ring-signal/50" : ""}`}
              style={{ background: c ? c + (focused ? "33" : "1A") : focused ? "rgb(var(--signal) / .12)" : undefined, opacity: dim && !fs ? 0.55 : 1 }}
            >
              <span className="relative w-12 shrink-0 select-none pr-3 text-right text-ink-faint">
                {c && <span className="absolute left-1.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full" style={{ background: c }} />}
                {ln.no}
              </span>
              <span className="whitespace-pre-wrap break-words pr-4 text-ink/80">{ln.text || " "}</span>
              {fs && (
                <span className="ml-auto shrink-0 pr-3 text-[11px] font-sans font-medium opacity-0 transition-opacity group-hover:opacity-100" style={{ color: c }}>
                  {fs.length} · {t("home.found")}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
