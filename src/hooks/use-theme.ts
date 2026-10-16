import { useCallback, useEffect, useState } from "react";

const THEME_KEY = "exam-generator-theme-v1";

export type ThemeMode = "light" | "dark" | "system";

function getSystemDark() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const dark = mode === "dark" || (mode === "system" && getSystemDark());
  root.classList.toggle("dark", dark);
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY) as ThemeMode | null;
      const initial: ThemeMode =
        saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
      setModeState(initial);
      applyTheme(initial);
    } catch {
      applyTheme("system");
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode, ready]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
    applyTheme(next);
  }, []);

  const cycle = useCallback(() => {
    setMode(mode === "light" ? "dark" : mode === "dark" ? "system" : "light");
  }, [mode, setMode]);

  const isDark =
    mode === "dark" || (mode === "system" && typeof window !== "undefined" && getSystemDark());

  return { mode, setMode, cycle, isDark, ready };
}
