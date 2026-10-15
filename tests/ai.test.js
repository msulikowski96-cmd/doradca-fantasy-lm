import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonLoose, callAi, askJson, checkAi, keyProblem } from "../src/ai.js";
import { MODELS, PROVIDERS } from "../src/constants.js";

// Podmienia globalny fetch na czas testu; `reply(call)` zwraca odpowiedź dla kolejnych wywołań.
async function withFetch(reply, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { const c = { url, init, body: init.body ? JSON.parse(init.body) : null }; calls.push(c); return reply(c, calls.length); };
  try { await fn(calls); } finally { globalThis.fetch = real; }
}
const res = (status, body) => ({ ok: status < 400, status, headers: new Headers(), json: async () => body });

const anthropicOk = res(200, { content: [{ type: "text", text: "{}" }], stop_reason: "end_turn" });
const geminiOk = text => res(200, { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] });
const gem = { provider: "gemini", apiKey: "AIzaTest", model: "gemini-3.8-flash", prompt: "p" };

test("parseJsonLoose czyta JSON z blokiem kodu i z tekstem dookoła", () => {
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Oto plan:\n```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(parseJsonLoose('Plan: {"a":3} – powodzenia'), { a: 3 });
  assert.throws(() => parseJsonLoose("brak json"));
});

test("każdy model ma znanego dostawcę", () => {
  MODELS.forEach(m => assert.ok(PROVIDERS[m.provider], m.id));
  assert.ok(MODELS.some(m => m.id === "gemini-3.8-flash" && m.provider === "gemini"));
});

test("Anthropic: ponawia przy przeciążeniu, a błąd klucza zwraca od razu", async () => {
  const opts = { apiKey: "k", model: "m", prompt: "p" };
  const retries = [];
  await withFetch((c, n) => n < 3 ? res(529, { error: { message: "x" } }) : anthropicOk, async calls => {
    const out = await callAi({ ...opts, retryDelays: [1, 1], onRetry: n => retries.push(n) });
    assert.equal(out.text, "{}");
    assert.equal(calls.length, 3);
    assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  });
  assert.deepEqual(retries, [1, 2]);
  await withFetch(() => res(529, {}), async calls => {
    await assert.rejects(callAi({ ...opts, retryDelays: [1] }), e => e.code === "overloaded");
    assert.equal(calls.length, 2);
  });
  await withFetch(() => res(401, {}), async calls => {
    await assert.rejects(callAi({ ...opts, retryDelays: [1, 1] }), e => e.code === "auth");
    assert.equal(calls.length, 1);
  });
});

test("Gemini: zapytanie idzie do generateContent z obrazem i trybem JSON", async () => {
  await withFetch(() => geminiOk('{"ok":true}'), async calls => {
    const out = await askJson({ ...gem, images: [{ mediaType: "image/jpeg", data: "QUJD" }], maxTokens: 2048 });
    assert.deepEqual(out, { ok: true });
    const c = calls[0];
    assert.equal(c.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    assert.equal(c.init.headers["x-goog-api-key"], "AIzaTest");
    assert.deepEqual(c.body.contents[0].parts[0], { inlineData: { mimeType: "image/jpeg", data: "QUJD" } });
    assert.equal(c.body.contents[0].parts[1].text, "p");
    assert.equal(c.body.generationConfig.responseMimeType, "application/json");
    // Zapas na tokeny myślenia ponad limit samej odpowiedzi.
    assert.ok(c.body.generationConfig.maxOutputTokens > 2048);
  });
});

test("Gemini: pomija części z myśleniem i wykrywa uciętą odpowiedź", async () => {
  const body = { candidates: [{ content: { parts: [{ text: "rozważam…", thought: true }, { text: '{"a":1}' }] }, finishReason: "STOP" }] };
  await withFetch(() => res(200, body), async () => {
    assert.deepEqual(await askJson(gem), { a: 1 });
  });
  const cut = { candidates: [{ content: { parts: [{ text: '{"a":' }] }, finishReason: "MAX_TOKENS" }] };
  await withFetch(() => res(200, cut), async () => {
    await assert.rejects(askJson(gem), e => e.code === "truncated");
  });
  await withFetch(() => res(200, { promptFeedback: { blockReason: "SAFETY" } }), async () => {
    await assert.rejects(callAi(gem), e => e.code === "blocked" && e.message.includes("SAFETY"));
  });
});

test("Gemini: zły klucz bez ponawiania, dzienny limit bez czekania, przeciążenie z ponowieniem", async () => {
  const badKey = { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT",
    details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID" }] } };
  await withFetch(() => res(400, badKey), async calls => {
    await assert.rejects(callAi({ ...gem, retryDelays: [1, 1] }), e => e.code === "auth");
    assert.equal(calls.length, 1);
  });
  const quota = { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded",
    details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "3600s" }] } };
  await withFetch(() => res(429, quota), async calls => {
    await assert.rejects(callAi({ ...gem, retryDelays: [1, 1] }), e => e.code === "rate_limited");
    assert.equal(calls.length, 1);
  });
  await withFetch((c, n) => n < 2 ? res(503, { error: { code: 503, status: "UNAVAILABLE" } }) : geminiOk("{}"), async calls => {
    const out = await callAi({ ...gem, retryDelays: [1, 1] });
    assert.equal(out.text, "{}");
    assert.equal(calls.length, 2);
  });
});

test("klucz z niedozwolonym znakiem daje jasny błąd, zanim zapytanie wyjdzie", async () => {
  assert.equal(keyProblem("AIzaSy_ok-123"), "");
  ["AIza…123", "AIza 123", "AIza\n123", "AIzaŁ123"].forEach(k => assert.ok(keyProblem(k), JSON.stringify(k)));
  await withFetch(() => geminiOk("{}"), async calls => {
    await assert.rejects(callAi({ ...gem, apiKey: "AIza…123" }), e => e.code === "auth" && e.message.includes("niedozwolony znak"));
    assert.equal(calls.length, 0);
  });
});

test("błąd sieci podaje szczegóły z przeglądarki", async () => {
  await withFetch(() => { throw new TypeError("Failed to fetch"); }, async () => {
    await assert.rejects(callAi(gem), e => e.code === "network" && e.message.includes("Failed to fetch") && e.message.includes("Sprawdź połączenie"));
  });
});

test("checkAi pyta o model bez generowania odpowiedzi", async () => {
  await withFetch(() => res(200, { name: "models/gemini-3.8-flash", displayName: "Gemini 3.8 Flash" }), async calls => {
    assert.equal(await checkAi(gem), "Gemini 3.8 Flash");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash");
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.headers["x-goog-api-key"], "AIzaTest");
  });
  await withFetch(() => res(404, { error: { code: 404, status: "NOT_FOUND", message: "not found" } }), async () => {
    await assert.rejects(checkAi(gem), e => e.code === "model");
  });
});

test("Gemini: klucz tylko w nagłówku, prefiks models/ usuwany z adresu", async () => {
  await withFetch(() => geminiOk("{}"), async calls => {
    await callAi({ ...gem, model: "models/gemini-3.8-flash" });
    await checkAi({ ...gem, model: " models/gemini-3.8-flash " });
    for (const c of calls) {
      assert.ok(!c.url.includes("AIzaTest") && !c.url.includes("key="), c.url);
      assert.ok(c.url.includes("/models/gemini-3.8-flash") && !c.url.includes("models%2F"), c.url);
      assert.equal(c.init.headers["x-goog-api-key"], "AIzaTest");
    }
  });
});

test("Gemini: wzmianka o kluczu przy 429/503 nie zmienia błędu w „zły klucz”", async () => {
  const quota = { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for this API key." } };
  await withFetch((c, n) => n < 2 ? res(429, quota) : geminiOk("{}"), async calls => {
    const out = await callAi({ ...gem, retryDelays: [1, 1] });
    assert.equal(out.text, "{}");
    assert.equal(calls.length, 2);
  });
  const unregistered = { error: { code: 403, status: "PERMISSION_DENIED", message: "Method doesn't allow unregistered callers (callers without established identity). Please use API Key or other form of API consumer identity to call this API." } };
  await withFetch(() => res(403, unregistered), async calls => {
    await assert.rejects(callAi({ ...gem, retryDelays: [1] }), e => e.code === "auth");
    assert.equal(calls.length, 1);
  });
});

test("proxy: zapytanie idzie do funkcji z tokenem, bez klucza; błędy proxy nie są ponawiane", async () => {
  const proxy = { url: "https://x.supabase.co/functions/v1/ai-proxy", headers: async () => ({ authorization: "Bearer T", apikey: "pk", "content-type": "application/json" }) };
  const noKey = { provider: "gemini", apiKey: "", model: "gemini-3.8-flash", prompt: "p", proxy };
  await withFetch(() => geminiOk('{"ok":1}'), async calls => {
    assert.deepEqual(await askJson(noKey), { ok: 1 });
    const c = calls[0];
    assert.equal(c.url, proxy.url);
    assert.equal(c.init.headers.authorization, "Bearer T");
    assert.equal(c.body.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    assert.equal(c.body.method, "POST");
    assert.equal(c.body.body.generationConfig.responseMimeType, "application/json");
    assert.ok(!JSON.stringify(c.body).includes("x-goog-api-key"));
  });
  await withFetch(() => res(429, { source: "proxy", code: "daily_limit", message: "Wykorzystano dzienny limit analiz (5)." }), async calls => {
    await assert.rejects(callAi({ ...noKey, retryDelays: [1, 1] }), e => e.code === "daily_limit" && /dzienny limit/.test(e.message));
    assert.equal(calls.length, 1);
  });
  await withFetch(() => res(546, null), async calls => {
    await assert.rejects(callAi({ ...noKey, retryDelays: [1, 1] }), e => e.code === "timeout");
    assert.equal(calls.length, 1);
  });
  // 503 od dostawcy przechodzi przez proxy bez zmian i jest ponawiane jak zwykle.
  await withFetch((c, n) => n < 2 ? res(503, { error: { code: 503, status: "UNAVAILABLE", message: "high demand" } }) : geminiOk("{}"), async calls => {
    assert.equal((await callAi({ ...noKey, retryDelays: [1, 1] })).text, "{}");
    assert.equal(calls.length, 2);
  });
  await withFetch(() => res(200, { displayName: "Gemini 3.8 Flash" }), async calls => {
    assert.equal(await checkAi(noKey), "Gemini 3.8 Flash");
    assert.equal(calls[0].body.method, "GET");
  });
});
