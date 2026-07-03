CREATE TABLE public.user_gemini_keys (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_gemini_keys TO authenticated;
GRANT ALL ON public.user_gemini_keys TO service_role;
ALTER TABLE public.user_gemini_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_select" ON public.user_gemini_keys FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own_insert" ON public.user_gemini_keys FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_update" ON public.user_gemini_keys FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_delete" ON public.user_gemini_keys FOR DELETE TO authenticated USING (user_id = auth.uid());