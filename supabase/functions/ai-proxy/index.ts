// Proxy AI ze wspólnym kluczem admina. Klient buduje zapytanie do Gemini/Anthropic jak zwykle
// (src/ai.js), ale bez klucza; proxy sprawdza konto, model i dzienny limit, dokłada klucz z bazy
// (tabela ai_config, niewidoczna dla klientów) i zwraca odpowiedź dostawcy bez zmian.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkTarget, providerHeaders, withinLimit } from "./policy.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// Limit funkcji na darmowym planie to 150 s – przerywamy wcześniej, żeby oddać czytelny błąd.
const PROVIDER_TIMEOUT_MS = 140_000;

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "content-type": "application/json" } });
const fail = (status: number, code: string, message: string) => json(status, { source: "proxy", code, message });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail(405, "bad_request", "Użyj metody POST.");

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = await admin.auth.getUser(jwt);
  if (authErr || !auth?.user) return fail(401, "auth_session", "Sesja wygasła. Zaloguj się ponownie.");
  const uid = auth.user.id;

  const { data: profile } = await admin.from("profiles").select("role, blocked").eq("id", uid).single();
  if (!profile || profile.blocked) return fail(403, "blocked", "Twoje konto jest zablokowane. Skontaktuj się z adminem.");
  const isAdmin = profile.role === "admin";

  const { data: cfg } = await admin.from("ai_config").select("provider, model, api_key, daily_limit").eq("id", 1).single();
  if (!cfg || !cfg.api_key) return fail(409, "no_shared_key", "Admin nie ustawił wspólnego klucza AI. Dodaj własny klucz w zakładce Zasady.");

  let payload: { url?: string; method?: string; body?: unknown };
  try { payload = await req.json(); } catch { return fail(400, "bad_request", "Nieprawidłowe zapytanie."); }
  const target = checkTarget(cfg, payload);
  if (!target.ok) return fail(400, "bad_target", target.message);

  if (target.generate) {
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(new Date());
    const { data: usage } = await admin.from("ai_usage").select("count").eq("user_id", uid).eq("day", today).maybeSingle();
    if (!withinLimit({ isAdmin, usedToday: usage?.count, dailyLimit: cfg.daily_limit })) {
      return fail(429, "daily_limit", `Wykorzystano dzienny limit analiz (${cfg.daily_limit}). Spróbuj jutro albo dodaj własny klucz w zakładce Zasady.`);
    }
  }

  let res: Response;
  try {
    res = await fetch(payload.url!, {
      method: (payload.method || "POST").toUpperCase(),
      headers: providerHeaders(cfg),
      body: payload.body ? JSON.stringify(payload.body) : undefined,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) {
      return fail(504, "timeout", "Analiza trwała ponad 140 s i serwer ją przerwał (limit darmowego planu). Spróbuj ponownie za chwilę.");
    }
    return fail(502, "network", "Serwer nie połączył się z dostawcą AI. Spróbuj ponownie.");
  }
  const text = await res.text();
  // Liczą się tylko udane analizy – przeciążenia (503) i błędy nie zjadają limitu.
  // Admin też jest liczony (statystyka w panelu), ale nie ma limitu.
  if (target.generate && res.ok) await admin.rpc("bump_ai_usage", { p_user: uid });
  return new Response(text, {
    status: res.status,
    headers: { ...CORS, "content-type": res.headers.get("content-type") || "application/json" },
  });
});
