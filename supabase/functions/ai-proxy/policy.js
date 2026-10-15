// Czysta logika proxy AI (bez Deno/Supabase), żeby dało się ją testować w Node (tests/proxy.test.js).
// Proxy dokłada wspólny klucz admina, więc przepuszcza tylko zapytania do skonfigurowanego modelu.

export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
export const ANTHROPIC_MESSAGES = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_MODELS = "https://api.anthropic.com/v1/models/";

// Górne limity tokenów – chronią klucz admina przed bardzo drogimi zapytaniami.
export const MAX_TOKENS = { gemini: 40000, anthropic: 8000 };

const cleanModel = m => decodeURIComponent(String(m || "")).trim().replace(/^models\//, "");

/**
 * Sprawdza zapytanie klienta względem ustawień admina.
 * cfg = { provider, model }; req = { url, method, body }
 * Zwraca { ok: true, generate } albo { ok: false, message }.
 * generate = true dla zapytań, które coś generują (liczą się do dziennego limitu).
 */
export function checkTarget(cfg, req) {
  const url = String((req && req.url) || "");
  const method = String((req && req.method) || "POST").toUpperCase();
  const body = (req && req.body) || {};
  const bad = message => ({ ok: false, message });
  if (url.includes("?") || url.includes("#")) return bad("Niedozwolony adres zapytania.");

  if (cfg.provider === "gemini") {
    if (!url.startsWith(GEMINI_BASE)) return bad("Wspólny klucz obsługuje tylko Gemini API.");
    const rest = url.slice(GEMINI_BASE.length);
    const [modelPart, action] = rest.split(":");
    if (cleanModel(modelPart) !== cleanModel(cfg.model)) return bad(`Wspólny klucz działa tylko z modelem ${cfg.model}.`);
    if (method === "GET" && action === undefined) return { ok: true, generate: false };
    if (method === "POST" && action === "generateContent") {
      const max = Number(body.generationConfig && body.generationConfig.maxOutputTokens) || 0;
      if (max > MAX_TOKENS.gemini) return bad("Za duży limit tokenów odpowiedzi.");
      return { ok: true, generate: true };
    }
    return bad("Niedozwolona operacja Gemini API.");
  }

  if (cfg.provider === "anthropic") {
    if (method === "GET" && url.startsWith(ANTHROPIC_MODELS)) {
      return cleanModel(url.slice(ANTHROPIC_MODELS.length)) === cleanModel(cfg.model)
        ? { ok: true, generate: false } : bad(`Wspólny klucz działa tylko z modelem ${cfg.model}.`);
    }
    if (method === "POST" && url === ANTHROPIC_MESSAGES) {
      if (cleanModel(body.model) !== cleanModel(cfg.model)) return bad(`Wspólny klucz działa tylko z modelem ${cfg.model}.`);
      if ((Number(body.max_tokens) || 0) > MAX_TOKENS.anthropic) return bad("Za duży limit tokenów odpowiedzi.");
      return { ok: true, generate: true };
    }
    return bad("Niedozwolona operacja Anthropic API.");
  }
  return bad("Admin nie ustawił dostawcy AI.");
}

/** Nagłówki do dostawcy: tylko te, które ustala proxy (klient nie przemyci swoich). */
export function providerHeaders(cfg) {
  return cfg.provider === "gemini"
    ? { "content-type": "application/json", "x-goog-api-key": cfg.api_key }
    : { "content-type": "application/json", "x-api-key": cfg.api_key, "anthropic-version": "2023-06-01" };
}

/** Czy użytkownik może wykonać kolejną analizę dzisiaj (admin bez limitu). */
export function withinLimit({ isAdmin, usedToday, dailyLimit }) {
  return isAdmin || Number(usedToday || 0) < Number(dailyLimit || 0);
}
