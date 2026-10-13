// Połączenie z Claude przez Anthropic Messages API, prosto z przeglądarki,
// na kluczu API użytkownika (przechowywanym tylko w localStorage tej przeglądarki).

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export class AiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Przy przeciążeniu i limicie zapytań ponawiamy sami, zanim pokażemy błąd.
const RETRY_CODES = new Set(["overloaded", "rate_limited"]);
const RETRY_DELAYS = [3000, 8000];

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(new AiError("cancelled", "Zatrzymano analizę.")); return; }
    const t = setTimeout(() => { if (signal) signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new AiError("cancelled", "Zatrzymano analizę.")); };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Wysyła zapytanie i zwraca tekst odpowiedzi. Przy przeciążeniu serwerów
 * lub limicie zapytań ponawia (opóźnienia z `retryDelays` albo nagłówka retry-after).
 * images: tablica bloków {type:"image", source:{...}} z imageFileToBlock().
 * onRetry(n): wywoływane przed n-tą ponowną próbą.
 */
export async function callClaude(opts) {
  const delays = opts.retryDelays || RETRY_DELAYS;
  for (let attempt = 0; ; attempt++) {
    try { return await callOnce(opts); }
    catch (e) {
      if (!RETRY_CODES.has(e && e.code) || attempt >= delays.length) throw e;
      if (opts.onRetry) opts.onRetry(attempt + 1);
      const fromHeader = e.retryAfter > 0 && e.retryAfter <= 30 ? e.retryAfter * 1000 : 0;
      await wait(Math.max(delays[attempt], fromHeader), opts.signal);
    }
  }
}

async function callOnce({ apiKey, model, prompt, images = [], signal, maxTokens = 4096 }) {
  if (!apiKey) throw new AiError("no_key", "Dodaj klucz API Anthropic w zakładce Zasady.");
  const content = [...images, { type: "text", text: prompt }];
  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
        // Wymagane przez API przy wywołaniu bezpośrednio z przeglądarki (CORS).
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content }] }),
    });
  } catch (e) {
    if (e && e.name === "AbortError") throw new AiError("cancelled", "Zatrzymano analizę.");
    throw new AiError("network", "Brak połączenia z API Anthropic. Sprawdź internet i spróbuj ponownie.");
  }
  let body = null;
  try { body = await res.json(); } catch (e) { /* pusta odpowiedź */ }
  if (!res.ok) {
    const err = apiError(res.status, body);
    err.retryAfter = Number(res.headers && res.headers.get && res.headers.get("retry-after")) || 0;
    throw err;
  }
  const text = (body && Array.isArray(body.content) ? body.content : [])
    .filter(b => b.type === "text").map(b => b.text).join("\n").trim();
  if (!text) throw new AiError("empty", "AI nie zwróciło odpowiedzi. Spróbuj ponownie.");
  return { text, truncated: body.stop_reason === "max_tokens" };
}

function apiError(status, body) {
  const msg = (body && body.error && body.error.message) || "";
  if (status === 401) return new AiError("auth", "Klucz API jest nieprawidłowy. Sprawdź go w zakładce Zasady.");
  if (status === 403) return new AiError("forbidden", "Ten klucz API nie ma dostępu do wybranego modelu.");
  if (status === 404) return new AiError("model", "Wybrany model nie jest dostępny. Zmień model w zakładce Zasady.");
  if (status === 429) return new AiError("rate_limited", "Za dużo zapytań. Spróbuj za minutę.");
  if (status === 529 || status >= 500) return new AiError("overloaded", "Serwery Anthropic są przeciążone. Spróbuj za chwilę.");
  if (/credit balance/i.test(msg)) return new AiError("credits", "Brak środków na koncie API. Doładuj je na console.anthropic.com.");
  return new AiError("bad_request", "API odrzuciło zapytanie" + (msg ? `: ${msg}` : "."));
}

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
  const { text, truncated } = await callClaude(opts);
  if (truncated) throw new AiError("truncated", "Odpowiedź AI została ucięta. Skróć dane i spróbuj ponownie.");
  return parseJsonLoose(text);
}

/** Zmniejsza zrzut ekranu (dłuższy bok ≤ 1568 px) i zamienia na blok obrazu dla API. */
export async function imageFileToBlock(file, maxSide = 1568) {
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
    const data = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
    return { type: "image", source: { type: "base64", media_type: "image/jpeg", data } };
  } finally {
    URL.revokeObjectURL(url);
  }
}
