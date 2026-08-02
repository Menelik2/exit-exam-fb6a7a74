ALTER TABLE public.user_gemini_keys DROP COLUMN api_key;
ALTER TABLE public.user_gemini_keys ADD COLUMN key_ciphertext text NOT NULL DEFAULT '';
ALTER TABLE public.user_gemini_keys ADD COLUMN key_last4 text NOT NULL DEFAULT '';
DELETE FROM public.user_gemini_keys;
ALTER TABLE public.user_gemini_keys ALTER COLUMN key_ciphertext DROP DEFAULT;
ALTER TABLE public.user_gemini_keys ALTER COLUMN key_last4 DROP DEFAULT;

DROP POLICY IF EXISTS own_select ON public.user_gemini_keys;
DROP POLICY IF EXISTS own_insert ON public.user_gemini_keys;
DROP POLICY IF EXISTS own_update ON public.user_gemini_keys;
DROP POLICY IF EXISTS own_delete ON public.user_gemini_keys;

REVOKE ALL ON public.user_gemini_keys FROM anon, authenticated;
GRANT ALL ON public.user_gemini_keys TO service_role;
ALTER TABLE public.user_gemini_keys ENABLE ROW LEVEL SECURITY;