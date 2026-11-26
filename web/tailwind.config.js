/** LÜMEN design tokens — every colour is a CSS variable so the three themes switch instantly. */
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
        signal: { DEFAULT: v("signal"), dark: v("signal-dark") },
        sky: v("sky"),
        violet: v("violet"),
        pink: v("pink"),
        ok: v("ok"), warn: v("warn"), bad: v("bad"),
        sev: { critical: "#E5484D", high: "#F76B15", medium: "#E2A30F", low: "#3E8BFF", info: "#8B95A7" },
      },
      fontFamily: {
        sans: ['"Onest Variable"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        lift: "0 1px 2px rgb(var(--shadow) / .06), 0 12px 32px -14px rgb(var(--shadow) / .28)",
        glow: "0 0 0 1px rgb(var(--signal) / .25), 0 10px 40px -10px rgb(var(--signal) / .55)",
      },
      keyframes: {
        floaty: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-8px)" } },
        shimmer: { "0%": { backgroundPosition: "0% 50%" }, "100%": { backgroundPosition: "200% 50%" } },
      },
      animation: { floaty: "floaty 6s ease-in-out infinite", shimmer: "shimmer 6s linear infinite" },
    },
  },
  plugins: [],
};
