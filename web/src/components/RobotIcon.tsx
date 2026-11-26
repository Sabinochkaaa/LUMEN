import { AGENT_COLORS } from "./agents";

/**
 * A tiny flat portrait of one of the five agents for menus and chips: glossy head, dark visor, glowing eyes, antenna.
 * Active: the robot bobs and its antenna light pulses. Every robot blinks now and then (CSS, respects reduced motion).
 */
export default function RobotIcon({ agent, size = 22, active = false, className = "" }: {
  agent: number; size?: number; active?: boolean; className?: string;
}) {
  const c = AGENT_COLORS[agent] ?? AGENT_COLORS[0];
  const delay = `${(agent * 0.9) % 4}s`;
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true"
      className={`robot-ico ${active ? "robot-ico-on" : ""} ${className}`} style={{ ["--d" as string]: delay }}>
      <g className="robot-ico-body">
        <line x1="16" y1="3.5" x2="16" y2="8" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
        <circle className="robot-ico-tip" cx="16" cy="3.2" r="2" fill={active ? "#7FE7FF" : c} />
        <rect x="3" y="7.5" width="26" height="20" rx="9.5" fill={c} />
        <rect x="3" y="7.5" width="26" height="20" rx="9.5" fill="url(#robot-gloss)" />
        <rect x="6.5" y="12" width="19" height="11" rx="5.5" fill="#0B1020" />
        <g className="robot-ico-eyes">
          <rect x="10.4" y="15.2" width="3" height="4.6" rx="1.5" fill="#7FE7FF" />
          <rect x="18.6" y="15.2" width="3" height="4.6" rx="1.5" fill="#7FE7FF" />
        </g>
      </g>
      <defs>
        <linearGradient id="robot-gloss" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" />
          <stop offset=".45" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}
