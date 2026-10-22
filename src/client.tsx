import { RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { getRouter } from "./router";
import appCss from "./styles.css?url";

function ensureStyles() {
  if (typeof document === "undefined") return;

  const cssId = "app-main-css";
  if (!document.getElementById(cssId)) {
    const link = document.createElement("link");
    link.id = cssId;
    link.rel = "stylesheet";
    link.href = appCss;
    document.head.appendChild(link);
  }

  if (!document.querySelector('link[href*="fonts.googleapis.com"]')) {
    const pre1 = document.createElement("link");
    pre1.rel = "preconnect";
    pre1.href = "https://fonts.googleapis.com";
    document.head.appendChild(pre1);
    const pre2 = document.createElement("link");
    pre2.rel = "preconnect";
    pre2.href = "https://fonts.gstatic.com";
    pre2.crossOrigin = "anonymous";
    document.head.appendChild(pre2);
    const fonts = document.createElement("link");
    fonts.rel = "stylesheet";
    fonts.href =
      "https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap";
    document.head.appendChild(fonts);
  }

  // Light mode default on desktop (matches anti-FOUC script)
  try {
    const t = localStorage.getItem("exam-generator-theme-v1");
    const desk = window.matchMedia("(min-width: 1024px)").matches;
    const dark =
      t === "dark" ||
      (t === "system" && !desk && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", !!dark);
  } catch {
    document.documentElement.classList.remove("dark");
  }
}

ensureStyles();

const router = getRouter();
const el = document.getElementById("root");

if (!el) {
  document.body.innerHTML =
    '<p style="font-family:system-ui;padding:2rem">App root missing. Please redeploy.</p>';
} else {
  createRoot(el).render(<RouterProvider router={router} />);
}
