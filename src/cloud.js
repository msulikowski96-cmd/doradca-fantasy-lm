// Konta i dane w chmurze (Supabase) przez zwykły fetch – bez zależności npm.
// Auth: GoTrue (/auth/v1), dane: PostgREST (/rest/v1, reguły RLS w bazie), funkcje: /functions/v1.
// createCloud() przyjmuje fetch i storage, żeby dało się go testować w Node (tests/cloud.test.js).

export class CloudError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const SESSION_KEY = "doradca-fantasy-lm-session";
// Odśwież token, gdy do wygaśnięcia zostało mniej niż tyle sekund.
const REFRESH_MARGIN_S = 60;

// Komunikaty GoTrue -> po polsku, z tym, co zrobić.
export function authMessage(status, body) {
  const raw = String((body && (body.msg || body.error_description || body.message || body.error)) || "");
  const code = String((body && (body.error_code || body.code)) || "");
  if (/invalid login credentials|invalid_credentials/i.test(raw + code)) return "Zły e-mail lub hasło.";
  if (/already registered|user_already_exists|email_exists/i.test(raw + code)) return "Konto z tym e-mailem już istnieje. Zaloguj się.";
  if (/email not confirmed|email_not_confirmed/i.test(raw + code)) return "Konto czeka na potwierdzenie e-maila. Poproś admina o aktywację.";
  if (/password.*(at least|short|weak)|weak_password/i.test(raw + code)) return "Hasło jest za słabe. Użyj co najmniej 8 znaków.";
  if (/invalid.*email|email_address_invalid|validate email/i.test(raw + code)) return "Nieprawidłowy adres e-mail.";
  if (/signups? not allowed|signup_disabled/i.test(raw + code)) return "Rejestracja jest wyłączona. Poproś admina o konto.";
  if (status === 429 || /rate limit/i.test(raw)) return "Za dużo prób. Odczekaj chwilę i spróbuj ponownie.";
  return raw ? `Logowanie się nie udało: ${raw}` : "Logowanie się nie udało. Spróbuj ponownie.";
}

export function createCloud({ url, key, fetch: fetchFn = globalThis.fetch, storage = globalThis.localStorage, now = () => Date.now() } = {}) {
  const enabled = !!(url && key);
  let session = null;
  try { session = JSON.parse(storage.getItem(SESSION_KEY) || "null"); } catch (e) { session = null; }
  let refreshing = null;

  const keep = s => {
    session = s;
    try { s ? storage.setItem(SESSION_KEY, JSON.stringify(s)) : storage.removeItem(SESSION_KEY); } catch (e) { /* tryb prywatny */ }
    return s;
  };
  const fromToken = t => ({
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: t.expires_at || Math.floor(now() / 1000) + Number(t.expires_in || 3600),
    user: t.user ? { id: t.user.id, email: t.user.email } : (session && session.user) || null,
  });

  async function raw(path, { method = "GET", body, headers = {}, token } = {}) {
    let res;
    try {
      res = await fetchFn(url + path, {
        method,
        headers: { apikey: key, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new CloudError("network", "Brak połączenia z serwerem kont. Sprawdź internet i spróbuj ponownie.");
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    return { res, data };
  }

  async function auth(path, body) {
    const { res, data } = await raw("/auth/v1" + path, { method: "POST", body });
    if (!res.ok) throw new CloudError("auth", authMessage(res.status, data));
    return data;
  }

  async function refresh() {
    if (!session || !session.refresh_token) throw new CloudError("session", "Zaloguj się ponownie.");
    if (!refreshing) {
      refreshing = (async () => {
        const { res, data } = await raw("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: session.refresh_token } });
        if (!res.ok) { keep(null); throw new CloudError("session", "Sesja wygasła. Zaloguj się ponownie."); }
        return keep(fromToken(data));
      })().finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function token() {
    if (!session) throw new CloudError("session", "Zaloguj się, żeby zapisywać dane w chmurze.");
    if (session.expires_at - REFRESH_MARGIN_S <= now() / 1000) await refresh();
    return session.access_token;
  }

  /** Zapytanie z tokenem użytkownika; przy 401 jedno odświeżenie sesji i ponowienie. */
  async function api(path, opts = {}) {
    let r = await raw(path, { ...opts, token: await token() });
    if (r.res.status === 401) { await refresh(); r = await raw(path, { ...opts, token: session.access_token }); }
    if (!r.res.ok) {
      const msg = (r.data && (r.data.message || r.data.msg || r.data.error)) || `Błąd serwera (${r.res.status}).`;
      throw new CloudError(r.res.status === 401 ? "session" : "api", msg);
    }
    return r.data;
  }

  const uid = () => session && session.user && session.user.id;
  const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(new Date(now()));

  return {
    enabled,
    session: () => session,
    user: () => (session && session.user) || null,

    async signUp({ email, password, name }) {
      const data = await auth("/signup", { email, password, data: { display_name: name } });
      if (data && data.access_token) return { session: keep(fromToken(data)), needsConfirm: false };
      return { session: null, needsConfirm: true };
    },
    async signIn({ email, password }) {
      return keep(fromToken(await auth("/token?grant_type=password", { email, password })));
    },
    async signOut() {
      const t = session && session.access_token;
      keep(null);
      if (t) { try { await raw("/auth/v1/logout", { method: "POST", token: t }); } catch (e) { /* i tak wylogowany lokalnie */ } }
    },
    async changePassword(password) {
      return api("/auth/v1/user", { method: "PUT", body: { password } });
    },
    /** Link z maila (potwierdzenie konta): #access_token=…&refresh_token=… */
    fromUrlHash(hash) {
      const p = new URLSearchParams(String(hash || "").replace(/^#/, ""));
      if (!p.get("access_token") || !p.get("refresh_token")) return false;
      keep(fromToken({ access_token: p.get("access_token"), refresh_token: p.get("refresh_token"), expires_in: p.get("expires_in"), expires_at: Number(p.get("expires_at")) || undefined }));
      return true;
    },
    async loadUser() {
      const u = await api("/auth/v1/user");
      session.user = { id: u.id, email: u.email };
      keep(session);
      return session.user;
    },

    async profile() {
      const rows = await api(`/rest/v1/profiles?id=eq.${uid()}&select=*`);
      return rows && rows[0] || null;
    },
    async updateMyName(name) {
      return api(`/rest/v1/profiles?id=eq.${uid()}`, { method: "PATCH", body: { display_name: name }, headers: { prefer: "return=minimal" } });
    },
    async loadState() {
      const rows = await api(`/rest/v1/user_states?user_id=eq.${uid()}&select=state,updated_at`);
      return rows && rows[0] || null;
    },
    async saveState(state) {
      return api("/rest/v1/user_states", {
        method: "POST",
        body: { user_id: uid(), state, updated_at: new Date(now()).toISOString() },
        headers: { prefer: "resolution=merge-duplicates,return=minimal" },
      });
    },
    async gameData() {
      const rows = await api("/rest/v1/game_data?id=eq.1&select=*");
      return rows && rows[0] || null;
    },
    async saveGameData(patch) {
      return api("/rest/v1/game_data?id=eq.1", {
        method: "PATCH", body: { ...patch, updated_at: new Date(now()).toISOString(), updated_by: uid() }, headers: { prefer: "return=minimal" },
      });
    },
    async aiConfig() { return api("/rest/v1/rpc/get_ai_config", { method: "POST", body: {} }); },
    async setAiConfig({ provider, model, apiKey, dailyLimit }) {
      return api("/rest/v1/rpc/set_ai_config", { method: "POST", body: { p_provider: provider, p_model: model, p_api_key: apiKey || "", p_daily_limit: dailyLimit } });
    },
    async clearAiKey() { return api("/rest/v1/rpc/clear_ai_key", { method: "POST", body: {} }); },

    // --- admin (RLS w bazie i tak to sprawdza) ---
    async listProfiles() { return api("/rest/v1/profiles?select=*&order=created_at.asc"); },
    async listStates() { return api("/rest/v1/user_states?select=user_id,state,updated_at"); },
    async usageToday() { return api(`/rest/v1/ai_usage?day=eq.${today()}&select=user_id,count`); },
    async updateProfile(id, patch) {
      return api(`/rest/v1/profiles?id=eq.${id}`, { method: "PATCH", body: patch, headers: { prefer: "return=minimal" } });
    },
    async fn(name, body) { return api(`/functions/v1/${name}`, { method: "POST", body: body || {} }); },

    /** Dane dla trybu proxy w ai.js: adres funkcji i świeże nagłówki z tokenem. */
    proxy() {
      return { url: `${url}/functions/v1/ai-proxy`, headers: async () => ({ apikey: key, authorization: `Bearer ${await token()}`, "content-type": "application/json" }) };
    },
  };
}
