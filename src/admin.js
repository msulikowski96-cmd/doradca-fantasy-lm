// Panel admina: ranking ligi z podglądem składów, konta, wspólny klucz AI i terminarz.
// Uprawnienia sprawdza baza (RLS) i funkcje brzegowe – ten moduł tylko rysuje i wysyła zmiany.
import { $, esc, fmtDateTime } from "./dom.js";
import { leagueTable, lastName, fmt } from "./rules.js";
import { POS, POS_PL } from "./constants.js";

const adm = { loaded: false, loading: false, err: "", profiles: [], states: [], usage: [], cfg: null, gd: null,
  sel: null, pwFor: null, delArm: null, msg: "", keyMsg: "", gdMsg: "", round: null, busy: "" };

/** Wymusza ponowne wczytanie przy następnym wejściu (np. po wylogowaniu). */
export function resetAdmin() { Object.assign(adm, { loaded: false, sel: null, pwFor: null, delArm: null, msg: "", keyMsg: "", gdMsg: "" }); }

async function load(ctx) {
  adm.loading = true; adm.err = "";
  try {
    const [profiles, states, usage, cfg, gd] = await Promise.all([
      ctx.cloud.listProfiles(), ctx.cloud.listStates(), ctx.cloud.usageToday(), ctx.cloud.aiConfig(), ctx.cloud.gameData(),
    ]);
    Object.assign(adm, { profiles: profiles || [], states: states || [], usage: usage || [], cfg, gd, loaded: true });
  } catch (e) {
    adm.err = (e && e.message) || "Nie udało się wczytać danych ligi.";
  }
  adm.loading = false;
}

const nameOf = p => p.display_name || (p.email || "").split("@")[0] || "?";
const stateOf = id => (adm.states.find(s => s.user_id === id) || {}).state || {};
const usedToday = id => (adm.usage.find(u => u.user_id === id) || {}).count || 0;

function squadHTML(st) {
  const cur = st.current;
  if (!cur || !Array.isArray(cur.players)) return `<p class="muted small">Brak zapisanego składu.</p>`;
  return `<div class="xi-list">${POS.map(pos => `<div><b>${pos}</b>${cur.players.filter(p => p.pos === pos).map(p =>
    `${esc(lastName(p.name))}${p.id === cur.captain ? " (C)" : p.id === cur.vice ? " (V)" : ""}${cur.xi && !cur.xi.includes(p.id) ? " · ławka" : ""} <span class="muted">${esc(p.club || "")} ${fmt(p.price)}</span>`).join(", ")}</div>`).join("")}
    <div><b>Bank</b>${fmt(cur.bank)} M€</div></div>`;
}

function detailHTML(id) {
  const p = adm.profiles.find(x => x.id === id);
  if (!p) return "";
  const st = stateOf(id);
  const rounds = Array.isArray(st.rounds) ? st.rounds.slice().reverse() : [];
  return `<div class="card" id="admDetail">
    <div class="rec-head"><h2>${esc(nameOf(p))}</h2><button class="btn ghost small" id="admDetailClose" type="button">Zamknij</button></div>
    <h3>Skład</h3>${squadHTML(st)}
    ${st.lastPlan && st.lastPlan.text ? `<h3>Ostatni plan</h3><pre class="plan-text">${esc(st.lastPlan.text)}</pre>` : ""}
    <h3>Kolejki</h3>
    ${rounds.length ? `<ul class="plain">${rounds.map(r => `<li><b>K${esc(r.n)}</b> · ${r.points !== "" && r.points != null ? esc(r.points) + " pkt" : "pkt –"}${(r.transfers || []).length ? " · " + r.transfers.map(t => `${esc(t.out)} → ${esc(t.in)}`).join(", ") : ""}${r.chip ? " · chip " + esc(r.chip) : ""}</li>`).join("")}</ul>` : `<p class="muted small">Jeszcze bez wpisów.</p>`}
  </div>`;
}

function rankingHTML() {
  const rows = leagueTable(adm.profiles.filter(p => !p.blocked).map(p => ({ id: p.id, name: nameOf(p), state: stateOf(p.id) })));
  return `<div class="card"><h2>Ranking ligi</h2>
    ${rows.length ? `<table class="tbl" id="admRanking"><thead><tr><th>#</th><th>Gracz</th><th class="num">Pkt</th><th class="num">Ostatnia</th></tr></thead><tbody>
      ${rows.map(r => `<tr data-uid="${esc(r.id)}" class="${adm.sel === r.id ? "sel" : ""}" tabindex="0"><td>${r.rank}</td><td>${esc(r.name)}</td><td class="num">${r.total}</td><td class="num">${r.lastRound ? `K${r.lastRound}: ${r.lastPoints}` : "–"}</td></tr>`).join("")}
    </tbody></table><p class="small muted">Stuknij gracza, żeby zobaczyć jego skład i plany.</p>` : `<p class="muted">Nikt jeszcze nie ma konta.</p>`}
  </div>`;
}

function accountsHTML(me) {
  return `<div class="card"><h2>Konta</h2>
    ${adm.msg ? `<div class="notice info" id="admMsg">${esc(adm.msg)}</div>` : ""}
    <ul class="accounts">${adm.profiles.map(p => {
      const self = p.id === me.id;
      return `<li class="acc" data-uid="${esc(p.id)}">
        <div class="acc-top"><b>${esc(nameOf(p))}</b>
          ${p.role === "admin" ? `<span class="pill ok">admin</span>` : ""}${p.blocked ? `<span class="pill bad">zablokowane</span>` : ""}</div>
        <div class="small muted">${esc(p.email)} · od ${esc(fmtDateTime(p.created_at))} · AI dziś: ${usedToday(p.id)}</div>
        ${self ? `<div class="small muted">To Ty.</div>` : `<div class="actions">
          <button class="btn small" type="button" data-act="block" id="acc-block-${esc(p.id)}">${p.blocked ? "Odblokuj" : "Zablokuj"}</button>
          <button class="btn small" type="button" data-act="role" id="acc-role-${esc(p.id)}">${p.role === "admin" ? "Odbierz admina" : "Nadaj admina"}</button>
          <button class="btn small" type="button" data-act="pw" id="acc-pw-${esc(p.id)}">Nowe hasło</button>
          <button class="btn small danger" type="button" data-act="del" id="acc-del-${esc(p.id)}">${adm.delArm === p.id ? "Kliknij ponownie, żeby usunąć" : "Usuń konto"}</button>
        </div>
        ${adm.pwFor === p.id ? `<div class="row"><label class="f" for="acc-newpw-${esc(p.id)}">Nowe hasło (min. 8 znaków)<input type="text" id="acc-newpw-${esc(p.id)}" autocomplete="off"></label>
          <button class="btn primary" type="button" data-act="pwsave" id="acc-pwsave-${esc(p.id)}" style="flex:none">Ustaw</button></div>` : ""}`}
      </li>`;
    }).join("")}</ul>
  </div>`;
}

function aiHTML(ctx) {
  const c = adm.cfg || {};
  return `<div class="card"><h2>Wspólny klucz AI</h2>
    <p class="small muted">Z tego klucza korzystają wszyscy zalogowani – nikt poza serwerem go nie widzi. Limit dzienny chroni przed wyczerpaniem darmowego pakietu (admin nie ma limitu).</p>
    <p class="small">${c.key_set ? `Ustawiony klucz: <span class="num">${esc(c.key_hint || "…")}</span> · ${esc(c.provider)} · ${esc(c.model)}` : "Klucz nie jest ustawiony – każdy używa własnego."}</p>
    <div class="row">
      <label class="f" for="admModel">Model<select id="admModel">${Object.entries(ctx.PROVIDERS).map(([pk, p]) =>
        `<optgroup label="${esc(p.label)}">${ctx.MODELS.filter(m => m.provider === pk).map(m => `<option value="${m.id}" ${c.model === m.id ? "selected" : ""}>${esc(m.label)}</option>`).join("")}</optgroup>`).join("")}</select></label>
      <label class="f" for="admLimit">Analiz dziennie na osobę<input type="number" id="admLimit" min="0" max="100" value="${esc(c.daily_limit ?? 5)}"></label>
    </div>
    <div class="row"><label class="f" for="admKey">${c.key_set ? "Nowy klucz (puste = bez zmiany)" : "Klucz API"}<input type="password" id="admKey" autocomplete="off" placeholder="AIza… / AQ… / sk-ant-…"></label></div>
    <div class="actions">
      <button class="btn primary" type="button" id="admAiSave">Zapisz</button>
      ${c.key_set ? `<button class="btn danger" type="button" id="admAiClear">Usuń klucz</button>` : ""}
    </div>
    ${adm.keyMsg ? `<p class="small" id="admKeyMsg">${esc(adm.keyMsg)}</p>` : ""}
  </div>`;
}

function fixturesHTML(ctx) {
  const gd = adm.gd || {};
  const n = adm.round || ctx.nextRound();
  const r = ctx.rounds().find(x => x.n === n);
  const local = r ? toLocalInput(r.ko) : "";
  return `<div class="card"><h2>Terminarz</h2>
    <p class="small muted">${gd.source ? `Źródło: ${esc(gd.source)} · zmienione ${esc(fmtDateTime(gd.updated_at))}.` : "Wbudowany terminarz aplikacji."} Zmiany widzą wszyscy gracze.</p>
    <div class="actions"><button class="btn" type="button" id="admSofa" ${adm.busy === "sofa" ? "disabled" : ""}>${adm.busy === "sofa" ? "Pobieram…" : "Pobierz z SofaScore"}</button></div>
    <p class="small muted">SofaScore nie ma publicznego API i często blokuje zapytania z serwerów – wtedy wpisz kolejkę ręcznie poniżej.</p>
    <div class="row">
      <label class="f" for="admRound">Kolejka<select id="admRound">${[1, 2, 3, 4, 5, 6, 7, 8].map(k => `<option value="${k}" ${k === n ? "selected" : ""}>${k}</option>`).join("")}</select></label>
      <label class="f" for="admKo">Pierwszy mecz<input type="datetime-local" id="admKo" value="${esc(local)}"></label>
    </div>
    <label class="f" for="admFix">Mecze kolejki<textarea id="admFix" placeholder="Wt 04.11 (18:45): Inter – Arsenal, …">${esc(ctx.fixtures()[n] || "")}</textarea></label>
    <div class="actions"><button class="btn primary" type="button" id="admFixSave">Zapisz kolejkę ${n}</button></div>
    ${adm.gdMsg ? `<p class="small" id="admGdMsg">${esc(adm.gdMsg)}</p>` : ""}
  </div>`;
}

// ISO -> wartość pola datetime-local w strefie urządzenia.
function toLocalInput(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const p = x => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * ctx = { cloud, me, MODELS, PROVIDERS, rounds(), fixtures(), nextRound(), onGameData(gd), onAiConfig(cfg) }
 */
export async function renderAdmin(el, ctx) {
  if (!adm.loaded && !adm.loading) {
    el.innerHTML = `<div class="card"><p class="muted">Wczytuję dane ligi…</p></div>`;
    await load(ctx);
  }
  if (adm.err && !adm.loaded) {
    el.innerHTML = `<div class="card"><div class="notice">${esc(adm.err)}</div><div class="actions"><button class="btn" id="admRetry" type="button">Spróbuj ponownie</button></div></div>`;
    $("#admRetry").addEventListener("click", () => { adm.err = ""; renderAdmin(el, ctx); });
    return;
  }
  el.innerHTML = `
    <div class="actions" style="justify-content:space-between"><h2>Panel admina</h2><button class="btn ghost small" id="admReload" type="button">Odśwież</button></div>
    ${rankingHTML()}
    ${adm.sel ? detailHTML(adm.sel) : ""}
    ${accountsHTML(ctx.me)}
    ${aiHTML(ctx)}
    ${fixturesHTML(ctx)}`;
  const rerender = () => renderAdmin(el, ctx);

  $("#admReload").addEventListener("click", async () => { adm.loaded = false; await renderAdmin(el, ctx); });
  el.querySelectorAll("#admRanking tr[data-uid]").forEach(tr => {
    const open = () => { adm.sel = adm.sel === tr.dataset.uid ? null : tr.dataset.uid; rerender(); };
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  });
  const dc = $("#admDetailClose"); if (dc) dc.addEventListener("click", () => { adm.sel = null; rerender(); });

  // --- konta ---
  el.querySelectorAll(".acc [data-act]").forEach(b => b.addEventListener("click", async () => {
    const id = b.closest(".acc").dataset.uid, p = adm.profiles.find(x => x.id === id), act = b.dataset.act;
    if (!p) return;
    adm.msg = "";
    try {
      if (act === "block") { await ctx.cloud.updateProfile(id, { blocked: !p.blocked }); p.blocked = !p.blocked; adm.msg = `${nameOf(p)}: konto ${p.blocked ? "zablokowane" : "odblokowane"}.`; }
      if (act === "role") { const role = p.role === "admin" ? "user" : "admin"; await ctx.cloud.updateProfile(id, { role }); p.role = role; adm.msg = `${nameOf(p)}: ${role === "admin" ? "ma teraz rolę admina" : "nie jest już adminem"}.`; }
      if (act === "pw") { adm.pwFor = adm.pwFor === id ? null : id; }
      if (act === "pwsave") {
        const pw = ($(`#acc-newpw-${id}`) || {}).value || "";
        if (pw.length < 8) { adm.msg = "Hasło musi mieć co najmniej 8 znaków."; rerender(); return; }
        const r = await ctx.cloud.fn("admin-users", { action: "set_password", userId: id, password: pw });
        adm.pwFor = null; adm.msg = `${nameOf(p)}: ${(r && r.message) || "hasło zmienione."}`;
      }
      if (act === "del") {
        if (adm.delArm !== id) { adm.delArm = id; rerender(); return; }
        adm.delArm = null;
        await ctx.cloud.fn("admin-users", { action: "delete", userId: id });
        adm.profiles = adm.profiles.filter(x => x.id !== id); adm.states = adm.states.filter(s => s.user_id !== id);
        if (adm.sel === id) adm.sel = null;
        adm.msg = `Konto ${nameOf(p)} usunięte.`;
      }
    } catch (e) { adm.msg = (e && e.message) || "Nie udało się zapisać zmiany."; }
    rerender();
  }));

  // --- wspólny klucz AI ---
  $("#admAiSave").addEventListener("click", async () => {
    const model = $("#admModel").value, m = ctx.MODELS.find(x => x.id === model);
    const apiKey = $("#admKey").value.replace(/\s+/g, ""), dailyLimit = Math.max(0, Math.min(100, parseInt($("#admLimit").value, 10) || 0));
    if (apiKey && /[^\x21-\x7E]/.test(apiKey)) { adm.keyMsg = "Klucz zawiera niedozwolony znak – skopiuj go ponownie."; rerender(); return; }
    if (apiKey && m.provider === "anthropic" && !apiKey.startsWith("sk-ant-")) { adm.keyMsg = "Dla modeli Claude wklej klucz Anthropic (sk-ant-…)."; rerender(); return; }
    if (apiKey && m.provider === "gemini" && apiKey.startsWith("sk-")) { adm.keyMsg = "Dla modeli Gemini wklej klucz z Google AI Studio."; rerender(); return; }
    if (!apiKey && adm.cfg && adm.cfg.key_set && adm.cfg.provider !== m.provider) { adm.keyMsg = "Zmieniasz dostawcę – wklej też nowy klucz."; rerender(); return; }
    try {
      await ctx.cloud.setAiConfig({ provider: m.provider, model, apiKey, dailyLimit });
      adm.cfg = await ctx.cloud.aiConfig(); ctx.onAiConfig(adm.cfg);
      adm.keyMsg = "Zapisano. Wszyscy gracze używają teraz tego modelu.";
    } catch (e) { adm.keyMsg = (e && e.message) || "Nie udało się zapisać."; }
    rerender();
  });
  const clr = $("#admAiClear");
  if (clr) clr.addEventListener("click", async () => {
    try { await ctx.cloud.clearAiKey(); adm.cfg = await ctx.cloud.aiConfig(); ctx.onAiConfig(adm.cfg); adm.keyMsg = "Klucz usunięty – gracze muszą użyć własnych kluczy."; }
    catch (e) { adm.keyMsg = (e && e.message) || "Nie udało się usunąć klucza."; }
    rerender();
  });

  // --- terminarz ---
  $("#admRound").addEventListener("change", e => { adm.round = Number(e.target.value); adm.gdMsg = ""; rerender(); });
  $("#admSofa").addEventListener("click", async () => {
    adm.busy = "sofa"; adm.gdMsg = ""; rerender();
    try {
      const r = await ctx.cloud.fn("sofascore", {});
      adm.gd = await ctx.cloud.gameData(); ctx.onGameData(adm.gd);
      adm.gdMsg = (r && r.message) || "Pobrano terminarz.";
    } catch (e) { adm.gdMsg = (e && e.message) || "Nie udało się pobrać terminarza."; }
    adm.busy = ""; rerender();
  });
  $("#admFixSave").addEventListener("click", async () => {
    const n = Number($("#admRound").value), koVal = $("#admKo").value, txt = $("#admFix").value.trim();
    const ko = koVal ? new Date(koVal) : null;
    if (koVal && isNaN(ko)) { adm.gdMsg = "Nieprawidłowa data pierwszego meczu."; rerender(); return; }
    const gd = adm.gd || {};
    const rounds = (Array.isArray(gd.rounds) ? gd.rounds : []).filter(r => r.n !== n);
    if (ko) rounds.push({ n, ko: ko.toISOString(), sure: true });
    rounds.sort((a, b) => a.n - b.n);
    const fixtures = { ...(gd.fixtures || {}) };
    if (txt) fixtures[n] = txt; else delete fixtures[n];
    try {
      await ctx.cloud.saveGameData({ rounds, fixtures, source: "admin" });
      adm.gd = await ctx.cloud.gameData(); ctx.onGameData(adm.gd);
      adm.round = n; adm.gdMsg = `Zapisano kolejkę ${n}. Gracze zobaczą ją po odświeżeniu.`;
    } catch (e) { adm.gdMsg = (e && e.message) || "Nie udało się zapisać terminarza."; }
    rerender();
  });
}
