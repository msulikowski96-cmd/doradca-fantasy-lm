import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTarget, providerHeaders, withinLimit, GEMINI_BASE } from "../supabase/functions/ai-proxy/policy.js";

const gem = { provider: "gemini", model: "gemini-3.8-flash", api_key: "AIzaSECRET" };
const ant = { provider: "anthropic", model: "claude-sonnet-5-5", api_key: "sk-ant-SECRET" };

test("proxy Gemini: przepuszcza tylko skonfigurowany model; generowanie liczy się do limitu", () => {
  assert.deepEqual(checkTarget(gem, { url: GEMINI_BASE + "gemini-3.8-flash:generateContent", method: "POST", body: { generationConfig: { maxOutputTokens: 22384 } } }), { ok: true, generate: true });
  assert.deepEqual(checkTarget(gem, { url: GEMINI_BASE + "gemini-3.8-flash", method: "GET" }), { ok: true, generate: false });
  assert.equal(checkTarget(gem, { url: GEMINI_BASE + "models%2Fgemini-3.8-flash:generateContent", method: "POST", body: {} }).ok, true);
  assert.equal(checkTarget(gem, { url: GEMINI_BASE + "gemini-3.1-pro-preview:generateContent", method: "POST", body: {} }).ok, false);
  assert.equal(checkTarget(gem, { url: GEMINI_BASE + "gemini-3.8-flash:streamGenerateContent", method: "POST", body: {} }).ok, false);
  assert.equal(checkTarget(gem, { url: GEMINI_BASE + "gemini-3.8-flash:generateContent?key=x", method: "POST", body: {} }).ok, false);
  assert.equal(checkTarget(gem, { url: "https://evil.example/" + GEMINI_BASE, method: "POST", body: {} }).ok, false);
  assert.equal(checkTarget(gem, { url: GEMINI_BASE + "gemini-3.8-flash:generateContent", method: "POST", body: { generationConfig: { maxOutputTokens: 900000 } } }).ok, false);
});

test("proxy Anthropic: model z body musi zgadzać się z ustawieniem admina", () => {
  assert.deepEqual(checkTarget(ant, { url: "https://api.anthropic.com/v1/messages", method: "POST", body: { model: "claude-sonnet-5-5", max_tokens: 6000 } }), { ok: true, generate: true });
  assert.equal(checkTarget(ant, { url: "https://api.anthropic.com/v1/messages", method: "POST", body: { model: "claude-opus-5-5", max_tokens: 6000 } }).ok, false);
  assert.equal(checkTarget(ant, { url: "https://api.anthropic.com/v1/messages", method: "POST", body: { model: "claude-sonnet-5-5", max_tokens: 64000 } }).ok, false);
  assert.deepEqual(checkTarget(ant, { url: "https://api.anthropic.com/v1/models/claude-sonnet-5-5", method: "GET" }), { ok: true, generate: false });
  assert.equal(checkTarget(ant, { url: "https://api.anthropic.com/v1/files", method: "GET" }).ok, false);
  assert.equal(checkTarget(ant, { url: GEMINI_BASE + "claude-sonnet-5-5:generateContent", method: "POST", body: {} }).ok, false);
});

test("proxy: nagłówki z kluczem ustala serwer, limit nie dotyczy admina", () => {
  assert.equal(providerHeaders(gem)["x-goog-api-key"], "AIzaSECRET");
  assert.equal(providerHeaders(ant)["x-api-key"], "sk-ant-SECRET");
  assert.equal(withinLimit({ isAdmin: false, usedToday: 4, dailyLimit: 5 }), true);
  assert.equal(withinLimit({ isAdmin: false, usedToday: 5, dailyLimit: 5 }), false);
  assert.equal(withinLimit({ isAdmin: false, usedToday: 0, dailyLimit: 0 }), false);
  assert.equal(withinLimit({ isAdmin: true, usedToday: 99, dailyLimit: 5 }), true);
});
