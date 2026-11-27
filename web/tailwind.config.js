/** LÜMEN design tokens (design 2.0, docs/DESIGN.md) — every colour is a CSS variable so the two themes switch instantly. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: v("canvas"),
        surface: { DEFAULT: v("surface"), 2: v("surface-2") },
        ink: { DEFAULT: v("ink"), soft: v("ink-soft"), faint: v("ink-faint") },
        line: v("line"),
        primary: { DEFAULT: v("primary"), hover: v("primary-hover") },
        signal: { DEFAULT: v("signal"), dark: v("signal-dark") },
        sky: v("sky"),
        violet: v("violet"),
        pink: v("pink"),
        ok: v("ok"), warn: v("warn"), bad: v("bad"),
        // severity — keep in sync with SEV_COLOR in src/api.ts
        sev: { critical: "#C53030", high: "#D9622B", medium: "#B7791F", low: "#2B6CB0", info: "#718096" },
      },
      fontFamily: {
        sans: ['"Onest Variable"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        // only for floating layers: menus, popovers, dialogs, the support chat
        lift: "0 4px 16px rgb(var(--shadow) / .08), 0 1px 2px rgb(var(--shadow) / .04)",
        glow: "none",
      },
      keyframes: {
        floaty: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" } },
      },
      animation: { floaty: "floaty 6s ease-in-out infinite" },
    },
  },
  plugins: [],
};
