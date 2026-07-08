import { test, expect, type Route } from "@playwright/test";

/**
 * Vercel-host smoke: Google sign-in against the deployed app.
 *
 * We can't complete real Google consent in CI, so we:
 *   1. Point the test at the deployed Vercel host (VERCEL_SMOKE_URL).
 *   2. Click "Continue with Google" and intercept the Supabase
 *      `/auth/v1/authorize?provider=google` redirect. That URL is what the
 *      Vercel branch of src/routes/auth.tsx hits (raw Supabase OAuth, no
 *      Lovable `/~oauth/*` broker) — proving no 404 on the callback path.
 *   3. Simulate Supabase's redirect back to `${origin}/#access_token=...`
 *      and assert the session loads (AccountPanel shows the user email).
 *
 * Skipped unless VERCEL_SMOKE_URL is set, so it never runs against .lovable.app.
 */

const VERCEL_URL = process.env.VERCEL_SMOKE_URL;
const PROJECT_REF =
  process.env.VITE_SUPABASE_PROJECT_ID ?? "imnsqaiwgvxkiozkntyd";

const TEST_USER = {
  id: "00000000-0000-4000-8000-0000000000a1",
  email: "vercel-smoke@example.com",
};

test.describe("google sign-in on Vercel", () => {
  test.skip(!VERCEL_URL, "Set VERCEL_SMOKE_URL to run against the deployed app");

  test("clicking Continue with Google reaches Supabase authorize (no 404) and hydrates a session", async ({
    page,
    context,
  }) => {
    const origin = new URL(VERCEL_URL!).origin;

    // 1. Stub Supabase `/auth/v1/user` so getUser() resolves after we plant
    //    the session below.
    await context.route(/\/auth\/v1\/user(\?|$)/, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: TEST_USER.id,
          aud: "authenticated",
          role: "authenticated",
          email: TEST_USER.email,
          app_metadata: { provider: "google" },
          user_metadata: {},
        }),
      }),
    );

    // 2. Intercept the Supabase OAuth authorize call. This is the key
    //    assertion: on Vercel the app must NOT hit `/~oauth/*` (Lovable
    //    broker, 404 on Vercel) — it must call Supabase directly.
    let authorizeHit = false;
    await context.route(
      /\/auth\/v1\/authorize\?.*provider=google/,
      (route: Route) => {
        authorizeHit = true;
        // Instead of forwarding to Google, redirect straight back to the app
        // with a synthetic implicit-flow hash so supabase-js parses a session.
        const hash = new URLSearchParams({
          access_token: "vercel-smoke-access-token",
          refresh_token: "vercel-smoke-refresh-token",
          token_type: "bearer",
          expires_in: "3600",
          provider_token: "google-provider-token",
        }).toString();
        route.fulfill({
          status: 302,
          headers: { location: `${origin}/#${hash}` },
          body: "",
        });
      },
    );

    // Fail loudly if any request hits the Lovable broker path on Vercel.
    const brokerHits: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/~oauth/")) brokerHits.push(req.url());
    });

    await page.goto(`${origin}/auth`, { waitUntil: "domcontentloaded" });

    await Promise.all([
      page.waitForURL(new RegExp(`^${origin}/#access_token=`), {
        timeout: 15_000,
      }),
      page.getByRole("button", { name: /continue with google/i }).click(),
    ]);

    expect(authorizeHit, "Supabase authorize endpoint was called").toBe(true);
    expect(brokerHits, "no requests hit the Lovable /~oauth broker").toEqual(
      [],
    );

    // Supabase-js should have parsed the hash and stored a session.
    const storageKey = `sb-${PROJECT_REF}-auth-token`;
    await expect
      .poll(
        async () =>
          page.evaluate((k) => window.localStorage.getItem(k), storageKey),
        { timeout: 10_000 },
      )
      .not.toBeNull();

    // AccountPanel should now render the signed-in state.
    await expect(page.getByText(TEST_USER.email)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/signed in with google/i)).toBeVisible();
  });
});
