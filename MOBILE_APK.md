# Build Android APK — Exit Exam Practice

The APK is a **native shell** (Capacitor) that opens your live site:

**https://yeniexams.vercel.app**

Gemini question generation still runs on the server. Website updates appear in the app automatically — rebuild the APK only for icon/name/native changes.

---

## Requirements (on your PC)

1. **Node.js 20+** — https://nodejs.org  
2. **Android Studio** — https://developer.android.com/studio  
   Install: Android SDK, SDK Platform 34+, JDK 17

---

## Quick build (copy-paste)

```bash
# 1. Clone
git clone https://github.com/Menelik2/exit-exam-fb6a7a74.git
cd exit-exam-fb6a7a74

# 2. Install
npm install

# 3. Add Android project (first time only)
npx cap add android
npx cap sync

# 4. Open Android Studio
npx cap open android
```

In Android Studio:

1. Wait for **Gradle sync** to finish  
2. Menu **Build → Build Bundle(s) / APK(s) → Build APK(s)**  
3. Click **locate** when done  

APK path:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

---

## Install on phone

1. Copy `app-debug.apk` to the phone (USB, Drive, Telegram, etc.)  
2. Open the file → allow **Install unknown apps** if asked  
3. Open **Exit Exam Practice**

---

## Config (already set in repo)

`capacitor.config.ts`:

- **App id:** `com.menelik.exitexam`  
- **Name:** Exit Exam Practice  
- **URL:** `https://yeniexams.vercel.app`

If your production domain changes, edit `server.url` then:

```bash
npx cap sync
```

and rebuild the APK.

---

## Release APK (optional, for sharing / Play Store)

1. **Build → Generate Signed Bundle / APK** → **APK**  
2. Create a keystore (save password)  
3. Build **release**  
4. Output: `android/app/build/outputs/apk/release/app-release.apk`

---

## Troubleshooting

| Issue | Fix |
|--------|-----|
| Blank screen | Open https://yeniexams.vercel.app in phone Chrome first; check `server.url` |
| Gradle / SDK errors | Android Studio → SDK Manager → Platform 34+; use JDK 17 |
| No internet in app | Phone needs data/Wi‑Fi; site must be HTTPS |
| `cap` not found | `npm install` then use `npx cap ...` |

---

**Note:** I cannot produce the `.apk` file from the cloud — Android Studio on your computer is required for the final build step.
