export const GEMINI_LS_KEY = "exam-gen-gemini-key-v1";
export const PROVIDER_LS_KEY = "exam-gen-provider-v1";

export function readKey(): string {
  try {
    return (localStorage.getItem(GEMINI_LS_KEY) || "").trim();
  } catch {
    return "";
  }
}
