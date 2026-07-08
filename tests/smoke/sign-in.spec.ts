import { test, expect } from "@playwright/test";

/**
 * CI smoke test for the sign-in flow.
 *
 * We cannot exercise real Google OAuth in CI (no browser consent, no test
 * Google account), so this covers the two branches the app actually renders:
 *
 *   1. Signed-out home shows the "Sign in / Sign up" CTA and /auth renders
 *      the "Continue with Google" button.
 *   2. When a Supabase session is present in localStorage AND the Supabase
 *      Auth `/user` endpoint returns a user, the AccountPanel loads the user
 *      ID / email and renders the "Signed in with Google" state.
 *
 * We stub the Supabase REST endpoints so no real backend is required.
 */

const PROJECT_REF = process.env.VITE_SUPABASE_PROJECT_ID ?? "imnsqaiwgvxkiozkntyd";
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;
const TEST_USER = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "smoke-test@example.com",
};

test.describe("sign-in smoke", () => {
  test("signed-out home shows the Sign in CTA", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: /sign in \/ sign up/i }),
    ).toBeVisible();
  });

  test("auth page shows the Continue with Google button", async ({ page }) => {
    await page.goto("/auth");
    await expect(
      page.getByRole("button", { name: /continue with google/i }),
    ).toBeVisible();
  });

  test("seeded session loads user ID and renders signed-in panel", async ({
    page,
  }) => {
    // Stub Supabase Auth so getUser() resolves to our test user without any
    // real backend. Every other Supabase call is left untouched.
    await page.route(/\/auth\/v1\/user(\?|$)/, (route) =>
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
    // Some builds also probe /token on load; return a stable session.
    await page.route(/\/auth\/v1\/token/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "smoke-access-token",
          token_type: "bearer",
          expires_in: 3600,
          refresh_token: "smoke-refresh-token",
          user: { id: TEST_USER.id, email: TEST_USER.email },
        }),
      }),
    );

    // Seed the Supabase session BEFORE React mounts so onAuthStateChange
    // sees us as signed in on first render.
    await page.addInitScript(
      ({ key, user }) => {
        const now = Math.floor(Date.now() / 1000);
        const session = {
          access_token: "smoke-access-token",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: now + 3600,
          refresh_token: "smoke-refresh-token",
          user: {
            id: user.id,
            aud: "authenticated",
            role: "authenticated",
            email: user.email,
            app_metadata: { provider: "google" },
            user_metadata: {},
          },
        };
        try {
          window.localStorage.setItem(key, JSON.stringify(session));
        } catch {
          /* storage unavailable — test will fail loudly below */
        }
      },
      { key: STORAGE_KEY, user: TEST_USER },
    );

    await page.goto("/");

    // The signed-in AccountPanel renders the email and a Sign out control.
    await expect(page.getByText(TEST_USER.email)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/signed in with google/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /sign out/i }),
    ).toBeVisible();
  });
});
