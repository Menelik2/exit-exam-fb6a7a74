import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SaveSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(20, "That doesn't look like a valid Gemini API key")
    .max(200),
});

export const saveGeminiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // Verify the key is a real, working Gemini key before storing it.
    // Never log the key or the raw Google response body.
    const check = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(data.apiKey)}`,
    );
    if (!check.ok) {
      if (check.status === 400 || check.status === 401 || check.status === 403) {
        throw new Error(
          "That Gemini API key was rejected by Google. Paste a real key from aistudio.google.com/apikey.",
        );
      }
      throw new Error(`Could not verify the key with Google (${check.status}). Please try again.`);
    }

    const { encryptApiKey } = await import("@/lib/key-crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin.from("user_gemini_keys").upsert(
      {
        user_id: userId,
        key_ciphertext: await encryptApiKey(data.apiKey),
        key_last4: data.apiKey.slice(-4),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error("Could not save your key. Please try again.");
    return { ok: true, last4: data.apiKey.slice(-4) };
  });

export const getGeminiKeyStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("user_gemini_keys")
      .select("key_last4, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error("Could not read your key status.");
    if (!data) return { hasKey: false as const };
    return {
      hasKey: true as const,
      last4: data.key_last4,
      updatedAt: data.updated_at,
    };
  });

export const deleteGeminiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("user_gemini_keys").delete().eq("user_id", userId);
    if (error) throw new Error("Could not remove your key. Please try again.");
    return { ok: true };
  });
