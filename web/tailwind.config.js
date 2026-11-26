/** LÜMEN design tokens */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#F3F5F9",
        ink: { DEFAULT: "#0E1A33", soft: "#475467", faint: "#98A2B3" },
        line: "#E4E8F0",
        signal: { DEFAULT: "#1F4FD8", dark: "#1639A6", wash: "#EAF0FF" },
        sky: { DEFAULT: "#3BA7E8", wash: "#E6F5FD" },
        violet: { DEFAULT: "#6D4AE0", wash: "#F0EBFF" },
        sev: { critical: "#D92D20", high: "#E8620C", medium: "#C99A06", low: "#3B82F6", info: "#98A2B3" },
      },
      fontFamily: {
        sans: ['"Onest Variable"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: { lift: "0 1px 2px rgba(14,26,51,.06), 0 8px 24px -12px rgba(14,26,51,.18)" },
    },
  },
  plugins: [],
};
