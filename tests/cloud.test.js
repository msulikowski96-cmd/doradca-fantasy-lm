import { test } from "node:test";
import assert from "node:assert/strict";
import { createCloud, authMessage } from "../src/cloud.js";

const URL_ = "https://x.supabase.co";
function memStorage() { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k), m }; }
const res = (status, data) => ({ ok: status < 400, status, text: async () => (data === undefined ? "" : JSON.stringify(data)) });
const tokenBody = (t, exp) => ({ access_token: t, refresh_token: "r-" + t, expires_at: exp, user: { id: "u1", email: "a@b.pl" } });

function setup(reply, start = 1_000_000_000_000) {
  const calls = []; let clock = start;
  const storage = memStorage();
  const fetch = async (u, init) => { const c = { url: u, ...init, body: init.body && JSON.parse(init.body) }; calls.push(c); return reply(c, calls.length); };
  const cloud = createCloud({ url: URL_, key: "pk", fetch, storage, now: () => clock });
  return { cloud, calls, storage, tick: s => { clock += s * 1000; } };
}

test("cloud: logowanie zapisuje sesję, zapytania mają apikey i token", async () => {
  const { cloud, calls, storage } = setup((c, n) => n === 1 ? res(200, tokenBody("t1", 1_000_003_600)) : res(200, [{ id: "u1", role: "user" }]));
  await cloud.signIn({ email: "a@b.pl", password: "haslo1234" });
  assert.equal(calls[0].url, URL_ + "/auth/v1/token?grant_type=password");
  assert.equal(calls[0].headers.apikey, "pk");
  assert.ok(JSON.parse(storage.getItem("doradca-fantasy-lm-session")).access_token === "t1");
  const p = await cloud.profile();
  assert.equal(p.role, "user");
  assert.equal(calls[1].url, URL_ + "/rest/v1/profiles?id=eq.u1&select=*");
  assert.equal(calls[1].headers.authorization, "Bearer t1");
});

test("cloud: wygasający token jest odświeżany przed zapytaniem, 401 daje jedno ponowienie", async () => {
  const { cloud, calls, tick } = setup((c, n) => {
    if (c.url.includes("grant_type=password")) return res(200, tokenBody("t1", 1_000_003_600));
    if (c.url.includes("grant_type=refresh_token")) return res(200, tokenBody(n < 4 ? "t2" : "t3", 1_000_010_000));
    if (c.headers.authorization === "Bearer t2" && c.url.includes("game_data")) return res(401, { message: "JWT expired" });
    return res(200, [{ id: 1, fixtures: {} }]);
  });
  await cloud.signIn({ email: "a@b.pl", password: "x" });
  tick(3590); // zostało 10 s ważności -> odświeżenie przed zapytaniem
  await cloud.loadState();
  assert.ok(calls.some(c => c.url.includes("grant_type=refresh_token") && c.body.refresh_token === "r-t1"));
  const gd = await cloud.gameData(); // t2 dostaje 401 -> odświeżenie -> t3
  assert.equal(gd.id, 1);
  assert.equal(calls.at(-1).headers.authorization, "Bearer t3");
});

test("cloud: nieudane odświeżenie kończy sesję z jasnym komunikatem", async () => {
  const { cloud, tick } = setup(c => c.url.includes("grant_type=password") ? res(200, tokenBody("t1", 1_000_003_600)) : res(400, { error: "invalid_grant" }));
  await cloud.signIn({ email: "a@b.pl", password: "x" });
  tick(4000);
  await assert.rejects(cloud.loadState(), e => e.code === "session" && /Zaloguj się/.test(e.message));
  assert.equal(cloud.session(), null);
});

test("cloud: rejestracja bez sesji = czeka na potwierdzenie; błędy GoTrue po polsku", async () => {
  const { cloud, calls } = setup(() => res(200, { id: "u9", email: "n@b.pl", confirmation_sent_at: "x" }));
  const r = await cloud.signUp({ email: "n@b.pl", password: "haslo1234", name: "Nowy" });
  assert.deepEqual(r, { session: null, needsConfirm: true });
  assert.deepEqual(calls[0].body.data, { display_name: "Nowy" });
  assert.equal(authMessage(400, { error_code: "invalid_credentials", msg: "Invalid login credentials" }), "Zły e-mail lub hasło.");
  assert.equal(authMessage(422, { error_code: "user_already_exists" }), "Konto z tym e-mailem już istnieje. Zaloguj się.");
  assert.equal(authMessage(422, { error_code: "weak_password", msg: "Password should be at least 6 characters" }), "Hasło jest za słabe. Użyj co najmniej 8 znaków.");
  assert.equal(authMessage(429, { msg: "Too many" }), "Za dużo prób. Odczekaj chwilę i spróbuj ponownie.");
});

test("cloud: zapis stanu to upsert własnego wiersza; proxy daje świeży token", async () => {
  const { cloud, calls } = setup((c, n) => n === 1 ? res(200, tokenBody("t1", 1_000_003_600)) : res(201));
  await cloud.signIn({ email: "a@b.pl", password: "x" });
  await cloud.saveState({ rounds: [] });
  const c = calls[1];
  assert.equal(c.url, URL_ + "/rest/v1/user_states");
  assert.equal(c.method, "POST");
  assert.match(c.headers.prefer, /resolution=merge-duplicates/);
  assert.equal(c.body.user_id, "u1");
  const p = cloud.proxy();
  assert.equal(p.url, URL_ + "/functions/v1/ai-proxy");
  assert.equal((await p.headers()).authorization, "Bearer t1");
});

test("cloud: link z maila (#access_token) loguje", () => {
  const { cloud } = setup(() => res(200));
  assert.equal(cloud.fromUrlHash("#access_token=A&refresh_token=R&expires_in=3600&type=signup"), true);
  assert.equal(cloud.session().access_token, "A");
  assert.equal(cloud.fromUrlHash("#foo=1"), false);
});
