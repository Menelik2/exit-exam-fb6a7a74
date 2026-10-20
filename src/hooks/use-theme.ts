import { useCallback, useEffect, useState } from "react";

const THEME_KEY = "exam-generator-theme-v1";

export type ThemeMode = "light" | "dark" | "system";

/** Desktop (lg+) defaults to light; narrow screens may follow system if mode is "system". */
function isDesktopViewport() {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(min-width: 1024px)").matches;
}

function getSystemDark() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // Explicit dark always wins; system only goes dark on non-desktop; light stays light
  const dark =
    mode === "dark" ||
    (mode === "system" && !isDesktopViewport() && getSystemDark());
  root.classList.toggle("dark", dark);
}

function resolveInitialMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY) as ThemeMode | null;
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    /* ignore */
  }
  // Default: light on desktop; system on mobile (so phone OS theme can still apply)
  return isDesktopViewport() ? "light" : "system";
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const initial = resolveInitialMode();
    setModeState(initial);
    applyTheme(initial);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const vq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    vq.addEventListener("change", onChange);
    return () => {
      mq.removeEventListener("change", onChange);
      vq.removeEventListener("change", onChange);
    };
  }, [mode, ready]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore */
    }
    applyTheme(next);
  }, []);

  const cycle = useCallback(() => {
    setMode(mode === "light" ? "dark" : mode === "dark" ? "system" : "light");
  }, [mode, setMode]);

  const isDark =
    mode === "dark" ||
    (mode === "system" &&
      typeof window !== "undefined" &&
      !isDesktopViewport() &&
      getSystemDark());

  return { mode, setMode, cycle, isDark, ready };
}
