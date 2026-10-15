// Połączenie z AI prosto z przeglądarki, na kluczu API użytkownika
// (przechowywanym tylko w localStorage tej przeglądarki). Dwaj dostawcy:
// Anthropic Messages API (Claude) i Gemini API (Google, endpoint generateContent).

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/";
// Modele Gemini 3.x domyślnie „myślą”, a tokeny myślenia liczą się do maxOutputTokens.
// Zapas, żeby myślenie nie ucięło właściwej odpowiedzi (JSON-a z planem).
const GEMINI_THINKING_ALLOWANCE = 16384;

export class AiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Przy przeciążeniu i limicie zapytań ponawiamy sami, zanim pokażemy błąd.
const RETRY_CODES = new Set(["overloaded", "rate_limited"]);
// Przeciążenia (503 „high demand”) bywają falami po kilkadziesiąt sekund; odpowiedź 503
// przychodzi szybko i nie zużywa limitu, więc próbujemy kilka razy z rosnącą przerwą.
const RETRY_DELAYS = [3000, 8000, 15000, 30000];
// Dłuższe czekanie (np. wyczerpany dzienny limit) nie ma sensu – od razu pokazujemy błąd.
const MAX_RETRY_WAIT_S = 30;

const cancelled = () => new AiError("cancelled", "Zatrzymano analizę.");

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(cancelled()); return; }
    const t = setTimeout(() => { if (signal) signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(cancelled()); };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Wysyła zapytanie i zwraca { text, truncated }. Przy przeciążeniu serwerów
 * lub limicie zapytań ponawia (opóźnienia z `retryDelays` albo z odpowiedzi API).
 * opts = { provider: "anthropic"|"gemini", apiKey, model, prompt, images, signal, maxTokens, onRetry, retryDelays }
 * images: tablica { mediaType, data } z imageFileToData().
 * onRetry(n): wywoływane przed n-tą ponowną próbą.
 */
export async function callAi(opts) {
  // Przy przeciążeniu wybranego modelu (503 mimo ponowień) próbujemy kolejnych z fallbackModels.
  const models = [opts.model, ...(opts.fallbackModels || []).filter(m => m && m !== opts.model)];
  for (let i = 0; ; i++) {
    try {
      const out = await callWithRetry({ ...opts, model: models[i], retryDelays: i === 0 ? opts.retryDelays : (opts.fallbackRetryDelays || [3000]) });
      return { ...out, model: models[i] };
    } catch (e) {
      if (!(e && e.code === "overloaded") || i >= models.length - 1) throw e;
      if (opts.onFallback) opts.onFallback(models[i + 1]);
    }
  }
}

async function callWithRetry(opts) {
  const delays = opts.retryDelays || RETRY_DELAYS;
  for (let attempt = 0; ; attempt++) {
    try { return await callOnce(opts); }
    catch (e) {
      if (!RETRY_CODES.has(e && e.code) || attempt >= delays.length || e.retryAfter > MAX_RETRY_WAIT_S) throw e;
      if (opts.onRetry) opts.onRetry(attempt + 1);
      await wait(Math.max(delays[attempt], (e.retryAfter || 0) * 1000), opts.signal);
    }
  }
}

const PROVIDER_NAME = { anthropic: "Anthropic", gemini: "Google" };

// Klucze API to same znaki ASCII bez spacji. Inny znak (np. „…”, złamanie linii, polska litera
// po wklejeniu) sprawia, że przeglądarka odrzuca nagłówek, zanim zapytanie wyjdzie z telefonu.
export const keyProblem = key => /[^\x21-\x7E]/.test(String(key || ""))
  ? "Klucz API zawiera niedozwolony znak (spację, złamanie linii, „…” albo polską literę). Skopiuj go ponownie i wklej w zakładce Zasady."
  : "";

/**
 * Wysyła zapytanie i zwraca sparsowane body; błędy HTTP i sieci zamienia na AiError.
 * proxy = { url, headers: async () => ({...}) } – zapytanie idzie przez funkcję ai-proxy
 * (wspólny klucz admina); proxy dokłada klucz, a odpowiedź dostawcy oddaje bez zmian.
 */
async function send(provider, { url, method = "POST", headers, body }, apiKey, signal, proxy) {
  if (!proxy) {
    if (!apiKey) throw new AiError("no_key", "Dodaj klucz API w zakładce Zasady.");
    const bad = keyProblem(apiKey);
    if (bad) throw new AiError("auth", bad);
  }
  let res;
  try {
    res = proxy
      ? await fetch(proxy.url, { method: "POST", signal, headers: await proxy.headers(), body: JSON.stringify({ url, method, body }) })
      : await fetch(url, { method, signal, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    if (e && e.name === "AbortError") throw cancelled();
    const detail = e && e.message ? ` Szczegóły: ${e.message}` : "";
    throw new AiError("network", `Zapytanie do API ${PROVIDER_NAME[provider]} nie doszło do serwera. Sprawdź internet, nie przełączaj aplikacji w trakcie analizy i użyj „Sprawdź połączenie” w zakładce Zasady.${detail}`);
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* pusta odpowiedź */ }
  if (!res.ok) {
    // Błędy samego proxy (konto, limit, czas) mają gotowy komunikat i nie są ponawiane.
    if (proxy && data && data.source === "proxy") throw new AiError(data.code || "proxy", data.message || "Serwer odrzucił zapytanie.");
    if (proxy && (res.status === 504 || res.status === 546)) {
      throw new AiError("timeout", "Analiza trwała za długo i serwer ją przerwał (limit 150 s). Spróbuj ponownie za chwilę.");
    }
    if (provider === "gemini") throw geminiError(res.status, data);
    const err = anthropicError(res.status, data);
    err.retryAfter = Number(res.headers && res.headers.get && res.headers.get("retry-after")) || 0;
    throw err;
  }
  return data;
}

async function callOnce(opts) {
  const provider = opts.provider === "gemini" ? "gemini" : "anthropic";
  const req = provider === "gemini" ? geminiRequest(opts) : anthropicRequest(opts);
  const body = await send(provider, req, opts.apiKey, opts.signal, opts.proxy);
  const out = provider === "gemini" ? geminiText(body) : anthropicText(body);
  if (!out.text) throw new AiError("empty", "AI nie zwróciło odpowiedzi. Spróbuj ponownie.");
  return out;
}

/**
 * Sprawdza klucz, sieć i dostęp do modelu jednym lekkim zapytaniem o model
 * (bez generowania odpowiedzi). Zwraca nazwę modelu albo rzuca AiError.
 */
export async function checkAi({ provider, apiKey, model, signal, proxy }) {
  const p = provider === "gemini" ? "gemini" : "anthropic";
  const req = p === "gemini"
    ? { url: geminiModelUrl(model), method: "GET", headers: { "x-goog-api-key": apiKey } }
    : { url: "https://api.anthropic.com/v1/models/" + encodeURIComponent(model), method: "GET", headers: anthropicHeaders(apiKey) };
  const body = await send(p, req, apiKey, signal, proxy);
  return (body && (body.displayName || body.display_name)) || model;
}

/* ---------- Anthropic ---------- */

function anthropicHeaders(apiKey) {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    // Wymagane przez API przy wywołaniu bezpośrednio z przeglądarki (CORS).
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

function anthropicRequest({ apiKey, model, prompt, images = [], maxTokens = 4096 }) {
  const content = [
    ...images.map(i => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.data } })),
    { type: "text", text: prompt },
  ];
  return {
    url: ANTHROPIC_URL,
    headers: anthropicHeaders(apiKey),
    body: { model, max_tokens: maxTokens, messages: [{ role: "user", content }] },
  };
}

function anthropicText(body) {
  const text = (body && Array.isArray(body.content) ? body.content : [])
    .filter(b => b.type === "text").map(b => b.text).join("\n").trim();
  return { text, truncated: !!body && body.stop_reason === "max_tokens" };
}

function anthropicError(status, body) {
  const msg = (body && body.error && body.error.message) || "";
  if (status === 401) return new AiError("auth", "Klucz API jest nieprawidłowy. Sprawdź go w zakładce Zasady.");
  if (status === 403) return new AiError("forbidden", "Ten klucz API nie ma dostępu do wybranego modelu.");
  if (status === 404) return new AiError("model", "Wybrany model nie jest dostępny. Zmień model w zakładce Zasady.");
  if (status === 429) return new AiError("rate_limited", "Za dużo zapytań. Spróbuj za minutę.");
  if (status === 529 || status >= 500) return new AiError("overloaded", "Serwery Anthropic są przeciążone. Spróbuj za chwilę.");
  if (/credit balance/i.test(msg)) return new AiError("credits", "Brak środków na koncie API. Doładuj je na console.anthropic.com.");
  return new AiError("bad_request", "API odrzuciło zapytanie" + (msg ? `: ${msg}` : "."));
}

/* ---------- Gemini ---------- */

// Adres modelu; identyfikator z prefiksem "models/" (jak w liście modeli API) dałby 400.
// Klucz idzie tylko w nagłówku x-goog-api-key – w adresie trafiałby do logów serwerów i proxy.
function geminiModelUrl(model) {
  return GEMINI_URL + encodeURIComponent(String(model || "").trim().replace(/^models\//, ""));
}

function geminiRequest({ apiKey, model, prompt, images = [], maxTokens = 4096 }) {
  const parts = [
    ...images.map(i => ({ inlineData: { mimeType: i.mediaType, data: i.data } })),
    { text: prompt },
  ];
  return {
    url: geminiModelUrl(model) + ":generateContent",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: {
      contents: [{ role: "user", parts }],
      generationConfig: { maxOutputTokens: maxTokens + GEMINI_THINKING_ALLOWANCE, responseMimeType: "application/json" },
    },
  };
}

function geminiText(body) {
  const cand = body && Array.isArray(body.candidates) ? body.candidates[0] : null;
  if (!cand) {
    const reason = body && body.promptFeedback && body.promptFeedback.blockReason;
    throw new AiError("blocked", `Gemini odrzuciło zapytanie${reason ? ` (${reason})` : ""}. Zmień dane i spróbuj ponownie.`);
  }
  // Części z thought:true to podsumowania myślenia modelu – pomijamy je.
  const parts = (cand.content && Array.isArray(cand.content.parts)) ? cand.content.parts : [];
  const text = parts.filter(p => typeof p.text === "string" && !p.thought).map(p => p.text).join("\n").trim();
  const reason = cand.finishReason || "";
  if (!text && reason && !["STOP", "MAX_TOKENS"].includes(reason)) {
    throw new AiError("blocked", `Gemini przerwało odpowiedź (${reason}). Zmień dane i spróbuj ponownie.`);
  }
  return { text, truncated: reason === "MAX_TOKENS" };
}

// Opóźnienie z szczegółów błędu Gemini (RetryInfo.retryDelay, np. "37s"), w sekundach.
function geminiRetryDelay(err) {
  const info = (err.details || []).find(d => d && typeof d.retryDelay === "string");
  return info ? parseFloat(info.retryDelay) || 0 : 0;
}

function geminiError(status, body) {
  const err = (body && body.error) || {};
  const msg = err.message || "";
  const reasons = (err.details || []).map(d => d && d.reason).filter(Boolean);
  let e;
  // Treść o kluczu liczy się tylko przy błędach zapytania/autoryzacji – 429 czy 503 z taką
  // wzmianką to nadal limit lub przeciążenie (i mają być ponawiane).
  const keyMsg = [400, 401, 403].includes(status) && /api key|key not valid/i.test(msg);
  if (reasons.includes("API_KEY_INVALID") || keyMsg) {
    e = new AiError("auth", "Klucz API Gemini jest nieprawidłowy. Sprawdź go w zakładce Zasady.");
  } else if (status === 401 || status === 403) {
    if (/unregistered callers/i.test(msg) || /established identity/i.test(msg)) {
      e = new AiError("auth", "Brak autoryzacji lub klucz API Gemini jest nieprawidłowy. Sprawdź klucz w Google AI Studio.");
    } else {
      e = new AiError("forbidden", "Ten klucz nie ma dostępu do Gemini API. Sprawdź uprawnienia w Google AI Studio.");
    }
  } else if (status === 404) {
    e = new AiError("model", "Wybrany model Gemini nie jest dostępny. Zmień model w zakładce Zasady.");
  } else if (status === 429) {
    e = new AiError("rate_limited", "Wyczerpany limit zapytań Gemini. Darmowy pakiet ma limit dzienny – spróbuj później albo włącz płatności w Google AI Studio.");
  } else if (status === 503 || (status >= 500 && /high demand/i.test(msg))) {
    e = new AiError("overloaded", "Model Gemini jest chwilowo przeciążony (503 high demand). Spróbuj za chwilę lub wybierz Gemini 3.5 Flash w zakładce Zasady.");
  } else if (status >= 500) {
    e = new AiError("overloaded", "Serwery Google są przeciążone. Spróbuj za chwilę.");
  } else {
    e = new AiError("bad_request", "Gemini odrzuciło zapytanie" + (msg ? `: ${msg}` : "."));
  }
  e.retryAfter = geminiRetryDelay(err);
  return e;
}

/* ---------- wspólne ---------- */

/** Wyciąga jedną wartość JSON z odpowiedzi (cała, blok ```json``` albo od pierwszego { do ostatniego }). */
export function parseJsonLoose(text) {
  const tryParse = s => { try { return JSON.parse(s); } catch (e) { return undefined; } };
  let v = tryParse(text);
  if (v !== undefined) return v;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { v = tryParse(fence[1]); if (v !== undefined) return v; }
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) { v = tryParse(text.slice(a, b + 1)); if (v !== undefined) return v; }
  throw new AiError("invalid_json", "AI zwróciło odpowiedź w złym formacie. Spróbuj jeszcze raz.");
}

export async function askJson(opts) {
  const { text, truncated } = await callAi(opts);
  if (truncated) throw new AiError("truncated", "Odpowiedź AI została ucięta. Skróć dane i spróbuj ponownie.");
  return parseJsonLoose(text);
}

/** Zmniejsza zrzut ekranu (dłuższy bok ≤ 1568 px) i zwraca { mediaType, data } (JPEG w base64). */
export async function imageFileToData(file, maxSide = 1568) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new AiError("image", "Nie udało się odczytać obrazu. Użyj pliku JPG lub PNG."));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    return { mediaType: "image/jpeg", data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1] };
  } finally {
    URL.revokeObjectURL(url);
  }
}
