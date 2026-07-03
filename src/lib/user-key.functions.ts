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
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("user_gemini_keys")
      .upsert(
        { user_id: userId, api_key: data.apiKey, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
    if (error) throw new Error(error.message);
    return { ok: true, last4: data.apiKey.slice(-4) };
  });

export const getGeminiKeyStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_gemini_keys")
      .select("api_key, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { hasKey: false as const };
    return {
      hasKey: true as const,
      last4: (data.api_key as string).slice(-4),
      updatedAt: data.updated_at as string,
    };
  });

export const deleteGeminiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("user_gemini_keys")
      .delete()
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
