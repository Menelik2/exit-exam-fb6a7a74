# Build an Android APK (Exit Exam Practice)

Your app is a **website**. The APK is a thin native shell that opens the live site inside a full-screen browser (Capacitor). That way Gemini generation and server functions still work.

## What you need on your computer

1. **Node.js** 20+ ([nodejs.org](https://nodejs.org))
2. **Android Studio** ([developer.android.com/studio](https://developer.android.com/studio))
   - During setup, install: Android SDK, Android SDK Platform, Android Virtual Device
3. Your **live site URL** (Vercel production URL)

## Step 1 — Clone and install

```bash
git clone https://github.com/Menelik2/exit-exam-fb6a7a74.git
cd exit-exam-fb6a7a74
npm install
```

## Step 2 — Install Capacitor

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/splash-screen
npx cap init "Exit Exam Practice" com.menelik.exitexam --web-dir public
```

If `capacitor.config.ts` already exists in the repo, skip `cap init` and only install packages.

## Step 3 — Set your live URL

Open `capacitor.config.ts` and set:

```ts
server: {
  url: "https://YOUR-VERCEL-URL.vercel.app",  // no trailing slash
  cleartext: false,
},
```

Example:
`https://exam-r3zzvpl1w-t4tsas-projects.vercel.app`

## Step 4 — Add Android project

```bash
npx cap add android
npx cap sync
```

This creates an `android/` folder (native project).

## Step 5 — Open in Android Studio

```bash
npx cap open android
```

Or open the `android` folder manually in Android Studio.

Wait until Gradle finishes syncing (bottom status bar).

## Step 6 — Build the APK

### Option A — Debug APK (quick install on your phone)

1. Menu **Build → Build Bundle(s) / APK(s) → Build APK(s)**
2. When done, click **locate**
3. File path is usually:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

Copy that file to your phone and open it to install  
(Settings → allow **Install unknown apps** for Files / Chrome).

### Option B — Release APK (sharable / Play Store)

1. **Build → Generate Signed Bundle / APK**
2. Choose **APK**
3. Create a new keystore (save the password!)
4. Build **release**
5. Output:

```
android/app/build/outputs/apk/release/app-release.apk
```

## Install on phone

1. Transfer the `.apk` (USB, Drive, Telegram, etc.)
2. Open the file on the phone
3. Allow install from that source if asked
4. Open **Exit Exam Practice**

## Update the app later

After you change the **website** on Vercel, the APK already shows the new version (it loads the live URL).  

Only rebuild the APK when you change:

- App name / icon
- Package id
- Native permissions
- Capacitor plugins

```bash
npx cap sync
npx cap open android
# Build APK again
```

## Common issues

| Problem | Fix |
|--------|-----|
| Blank white screen | Wrong `server.url` or site down — open the URL in phone Chrome first |
| Gradle errors | Android Studio → **File → Sync Project with Gradle Files**; use JDK 17 |
| `sdk not found` | Android Studio → Settings → Android SDK → install Platform 34+ |
| App can’t reach internet | Phone needs network; site must be **https** |

## Optional: app icon

Replace files under:

```
android/app/src/main/res/mipmap-*/
```

Or use Android Studio **Image Asset** tool (right-click `res` → New → Image Asset).

## iOS (optional)

Needs a Mac + Xcode:

```bash
npm install @capacitor/ios
npx cap add ios
npx cap open ios
```

---

**Summary:** Install Android Studio → set URL in `capacitor.config.ts` → `npx cap add android` → Build APK → copy to phone.
