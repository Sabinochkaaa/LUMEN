import { createContext, ReactNode, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark";
const Ctx = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: "light", setTheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem("lumen.theme");
    if (saved === "light" || saved === "dark") return saved;
    if (saved === "aurora") return "dark"; // design 1.0 theme, removed in 2.0
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const setTheme = (t: Theme) => { localStorage.setItem("lumen.theme", t); setThemeState(t); };
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>;
}
export const useTheme = () => useContext(Ctx);
