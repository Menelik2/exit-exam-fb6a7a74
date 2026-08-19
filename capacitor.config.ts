import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Exit Exam Practice — Android / iOS shell
 *
 * This app is a WebView that opens your LIVE site (Vercel).
 * Server-side features (Gemini question generation) keep working.
 *
 * 1. Set server.url to your production URL (no trailing slash).
 * 2. Run: npx cap add android && npx cap sync
 * 3. Open Android Studio → Build → Build APK
 */
const config: CapacitorConfig = {
  appId: "com.menelik.exitexam",
  appName: "Exit Exam Practice",
  webDir: "public",
  server: {
    // ★ Change this to your real Vercel / custom domain
    url: "https://exam-r3zzvpl1w-t4tsas-projects.vercel.app",
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: "#4f46e5",
      showSpinner: false,
    },
  },
};

export default config;
