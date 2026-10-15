// Interfejs aplikacji: renderowanie zakładek i obsługa zdarzeń.
// Logika zasad jest w rules.js, treść zapytań w prompt.js, połączenie z API w ai.js.

import { POS, POS_PL, POS_ONE, CLUBS, SHORT, CHIPS, DEFAULT_RULES, ROUNDS, FIXTURES, EXAMPLE, STYLES, MODELS, PROVIDERS } from "./constants.js";
import {
  r1, fmt, norm, canonClub, normPos, lastName, validateSquad, lineupProblems, autoLineup, benchOrder,
  pickCaptain, cleanRec, evalRec, applyEvaluated, roundInfo, countN, timeLeft, planText, mergeGameData,
} from "./rules.js";
import { buildAnalysisPrompt, SQUAD_IMPORT_PROMPT } from "./prompt.js";
import { askJson, imageFileToData, checkAi, keyProblem } from "./ai.js";
import {
  freshState, normalizeState, loadState, saveState, loadSettings, saveSettings, stateKey, hasData, loadMode, saveMode,
} from "./storage.js";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { createCloud } from "./cloud.js";
import { renderAuth } from "./account.js";
import { renderAdmin, resetAdmin } from "./admin.js";
import { $, esc } from "./dom.js";
import { SHARED_GEMINI_MODELS } from "../supabase/functions/ai-proxy/policy.js";

/* ---------- helpers ---------- */
const clone = o => JSON.parse(JSON.stringify(o));
const newId = () => "p" + Math.random().toString(36).slice(2, 9);
const short = c => SHORT[c] || String(c || "?").slice(0, 3).toUpperCase();
const fmtDate = d => new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
const MAX_IMAGES = 5;

/* ---------- state ---------- */
let state = freshState();
let settings = loadSettings();
// Konto: "local" = bez konta (dane tylko w przeglądarce), "cloud" = zalogowany (Supabase).
const cloud = createCloud({ url: SUPABASE_URL, key: SUPABASE_KEY });
const acct = { mode: "local", profile: null, aiCfg: null, offerMigrate: false, msg: "" };
let stateKeyNow = stateKey(null);
// Terminarz: wbudowany + to, co ustawił admin (game_data).
let game = mergeGameData(ROUNDS, FIXTURES, null);
const curRounds = () => game.rounds;
const curFixtures = () => game.fixtures;
const isAdmin = () => acct.mode === "cloud" && acct.profile && acct.profile.role === "admin";
const ui = {
  tab: "squad", editing: false, draft: null, setOrig: false, selected: null, swapFrom: null, squadMsg: "",
  aiBusy: false, ctl: null, timer: null, started: 0, retry: 0, fallback: null, aiMsg: "", roundImages: [], importBusy: false, importMsg: "",
  resetArm: false, importArm: false, notice: "", keyMsg: "", histDel: null,
};

async function copyText(txt) {
  try { await navigator.clipboard.writeText(txt); return true; } catch (e) { return false; }
}
// Gdy schowek jest niedostępny: zaznacza tekst elementu, żeby skopiować go ręcznie.
function selectText(el) {
  const range = document.createRange(); range.selectNodeContents(el);
  const s = getSelection(); s.removeAllRanges(); s.addRange(range);
}
const retryNote = () => (ui.fallback ? ` · przeciążony, próbuję ${modelLabel(ui.fallback)}` : "") + (ui.retry ? ` · serwery zajęte, próba ${ui.retry + 1}` : "");

function setSync(s, text) {
  const el = $("#sync");
  el.dataset.s = s; el.textContent = text;
}
function save() {
  const ok = saveState(state, stateKeyNow);
  if (acct.mode === "cloud") { scheduleCloudSave(); return; }
  setSync(ok ? "saved" : "error", ok ? "Zapisano w przeglądarce" : "Nie można zapisać");
}
// Zapis w chmurze z opóźnieniem – kilka szybkich zmian to jeden zapis. Kopia w przeglądarce jest zawsze.
let cloudTimer = null;
function scheduleCloudSave() {
  setSync("saving", "Zapisywanie…");
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(async () => {
    try { await cloud.saveState(state); setSync("saved", "Zapisano w chmurze"); }
    catch (e) { setSync("error", e && e.code === "session" ? "Zaloguj się ponownie" : "Nie zapisano w chmurze – ponowię przy kolejnej zmianie"); }
  }, 1200);
}
let draftTimer = null;
function draftSave() { clearTimeout(draftTimer); draftTimer = setTimeout(save, 500); }

// Dostawca AI wynika z wybranego modelu; każdy ma własny klucz w ustawieniach.
const curModel = () => MODELS.find(m => m.id === settings.model) || MODELS[0];
const curProvider = () => PROVIDERS[curModel().provider];
const curKey = () => settings[curProvider().keyField] || "";
// Wspólny klucz ligi (ustawia admin, trzyma serwer) – chyba że gracz wybrał własny klucz.
const sharedAi = () => acct.mode === "cloud" && !!(acct.aiCfg && acct.aiCfg.key_set) && !settings.ownKey;
// Przy wspólnym kluczu Gemini gracz wybiera model z SHARED_GEMINI_MODELS (domyślnie ten od admina).
const sharedModel = () => {
  const c = acct.aiCfg || {};
  return c.provider === "gemini" && SHARED_GEMINI_MODELS.includes(settings.sharedModel) ? settings.sharedModel : c.model;
};
// Kolejność zapasowych modeli Gemini przy przeciążeniu (503) wybranego.
const GEMINI_FALLBACK = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3.8-flash", "gemini-3.5-flash-lite"];
const fallbacks = (provider, model) => provider === "gemini" ? GEMINI_FALLBACK.filter(m => m !== model) : [];
const modelLabel = id => (MODELS.find(m => m.id === id) || {}).label || id;
const aiOpts = () => {
  const o = sharedAi()
    ? { provider: acct.aiCfg.provider, model: sharedModel(), apiKey: "", proxy: cloud.proxy() }
    : { provider: curModel().provider, apiKey: curKey(), model: curModel().id };
  const fallbackModels = fallbacks(o.provider, o.model);
  // Gdy jest model zapasowy, nie czekamy minuty na przeciążony – dwie próby i zmiana modelu.
  return { ...o, fallbackModels, ...(fallbackModels.length ? { retryDelays: [3000, 8000] } : {}) };
};
const aiReady = () => sharedAi() || !!curKey();
// Po analizie przez wspólny klucz odśwież licznik „dziś wykorzystano”.
const refreshAiCfg = () => { if (sharedAi()) cloud.aiConfig().then(c => { acct.aiCfg = c; }).catch(() => {}); };
const freeNow = () => {
  const d = state.draftRound;
  return (d.free !== undefined && d.free !== "") ? Number(d.free) : state.rules.freeTransfers;
};
const evalCtx = () => ({ current: state.current, rules: state.rules, chips: state.chips, free: freeNow() });
function currentDone() {
  const d = Number(state.draftRound.done);
  return d >= 1 && d <= 8 ? d : roundInfo(curRounds()).done;
}
function fixturesFor(next) {
  const d = state.draftRound;
  if (d.fixturesFor !== next) { d.fixturesFor = next; d.fixtures = curFixtures()[next] || ""; }
  return d.fixtures;
}

/* ---------- AI actions ---------- */
async function runAnalysis(fix) {
  if (!aiReady() || ui.aiBusy) return;
  if (!state.current) { ui.aiMsg = "Najpierw zapisz swój skład w zakładce Skład."; renderRound(); return; }
  maybeRevertFreeHit(true);
  const done = currentDone(), next = done + 1;
  const prompt = buildAnalysisPrompt(state, { done, next, free: freeNow(), fixtures: fixturesFor(next), hasImages: ui.roundImages.length > 0, fix });
  ui.aiBusy = true; ui.aiMsg = ""; ui.retry = 0; ui.fallback = null; ui.ctl = new AbortController(); ui.started = Date.now();
  // Analiza może trwać kilka minut; wygaszony ekran na telefonie zrywa połączenie.
  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch (e) { /* brak wsparcia albo niebezpieczny adres */ }
  renderRound();
  const tick = () => { const el = $("#aiTimer"); if (el) el.textContent = Math.round((Date.now() - ui.started) / 1000) + " s" + retryNote(); };
  ui.timer = setInterval(tick, 1000);
  try {
    const images = await Promise.all(ui.roundImages.map(f => imageFileToData(f)));
    const res = await askJson({
      ...aiOpts(), prompt, images, signal: ui.ctl.signal, maxTokens: 6000,
      onRetry: n => { ui.retry = n; tick(); },
      onFallback: m => { ui.fallback = m; ui.retry = 0; tick(); },
    });
    if (!res || typeof res !== "object" || Array.isArray(res)) throw { message: "AI zwróciło odpowiedź w złym formacie. Spróbuj jeszcze raz." };
    state.pendingRec = Object.assign(cleanRec(res, state.current), { forRound: next, afterRound: done, createdAt: Date.now(), model: ui.fallback || aiOpts().model });
    save();
    refreshAiCfg();
  } catch (e) {
    ui.aiMsg = (e && e.message) || "Analiza się nie udała. Spróbuj ponownie.";
  } finally {
    clearInterval(ui.timer); ui.aiBusy = false; ui.ctl = null;
    if (wakeLock) wakeLock.release().catch(() => {});
    renderRound();
    const box = $("#recBox");
    if (box && state.pendingRec && !ui.aiMsg) box.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }
}

async function importScreenshot(file) {
  if (!aiReady() || ui.importBusy || !file) return;
  ui.importBusy = true; ui.importMsg = "Odczytuję zrzut ekranu…"; renderSquad();
  try {
    const image = await imageFileToData(file);
    const res = await askJson({
      ...aiOpts(), prompt: SQUAD_IMPORT_PROMPT, images: [image], maxTokens: 2048,
      onRetry: n => { ui.importMsg = `Serwery AI są zajęte. Ponawiam (próba ${n + 1})…`; renderSquad(); },
    });
    const list = Array.isArray(res && res.players) ? res.players : [];
    if (!list.length) throw { message: "Nie znalazłem zawodników na tym zrzucie. Spróbuj zrzutu widoku boiska." };
    const draft = emptyDraft();
    let placed = 0, extra = 0;
    list.forEach(p => {
      const pos = normPos(p.pos);
      const slot = pos && draft.players.find(x => x.pos === pos && !x.name);
      if (!slot) { extra++; return; }
      slot.name = String(p.name || "").trim(); slot.club = canonClub(p.club); slot.price = isFinite(parseFloat(p.price)) ? r1(p.price) : "";
      placed++;
    });
    draft.bank = isFinite(parseFloat(res.bank)) ? r1(res.bank) : null;
    ui.draft = draft; ui.editing = true;
    ui.importMsg = `Odczytano ${placed} zawodników${extra ? `, ${extra} pominięto (brak miejsca lub pozycji)` : ""}. Sprawdź kluby i ceny, potem zapisz.`;
  } catch (e) {
    ui.importMsg = (e && e.message) || "Nie udało się odczytać zrzutu.";
  } finally { ui.importBusy = false; renderSquad(); }
}

/* ---------- squad ops ---------- */
function emptyDraft() {
  const players = [];
  POS.forEach(pos => { for (let i = 0; i < state.rules.squad[pos]; i++) players.push({ id: newId(), name: "", club: "", pos, price: "" }); });
  return { players, bank: null };
}
function exampleDraft() {
  const d = emptyDraft();
  EXAMPLE.forEach(([name, club, pos, price]) => { const slot = d.players.find(x => x.pos === pos && !x.name); if (slot) Object.assign(slot, { name, club, price }); });
  d.example = true;
  return d;
}
function draftFromCurrent() {
  const cur = state.current, d = emptyDraft();
  POS.forEach(pos => {
    const have = cur.players.filter(p => p.pos === pos);
    d.players.filter(p => p.pos === pos).forEach((s, i) => { if (have[i]) Object.assign(s, clone(have[i])); });
  });
  d.bank = cur.bank;
  return d;
}
const draftValue = d => r1(d.players.reduce((s, p) => s + (parseFloat(p.price) || 0), 0));
const draftBank = d => (d.bank !== null && d.bank !== "" && isFinite(parseFloat(d.bank))) ? r1(d.bank) : r1(state.rules.budget - draftValue(d));

function saveDraft() {
  const d = ui.draft;
  const players = d.players.map(p => ({ id: p.id, name: String(p.name).trim(), club: canonClub(p.club), pos: p.pos, price: parseFloat(p.price) }));
  const bank = draftBank(d);
  if (validateSquad(players, bank, state.rules).errors.length) return;
  players.forEach(p => { p.price = r1(p.price); });
  const prev = state.current;
  let xi, bench, captain = null, vice = null;
  if (prev) {
    const ids = new Set(players.map(p => p.id));
    xi = prev.xi.filter(id => ids.has(id));
    if (xi.length !== 11 || lineupProblems(players, xi, state.rules).length) ({ xi, bench } = autoLineup(players));
    else bench = benchOrder(players, xi, prev.bench);
    captain = xi.includes(prev.captain) ? prev.captain : null;
    vice = xi.includes(prev.vice) ? prev.vice : null;
  } else ({ xi, bench } = autoLineup(players));
  if (!captain) captain = pickCaptain(players, xi) || xi[0];
  if (!vice || vice === captain) vice = pickCaptain(players, xi, captain);
  state.current = { players, bank, xi, bench, captain, vice };
  if (!state.original || ui.setOrig) state.original = { players: clone(players), bank, savedAt: Date.now() };
  // Po ręcznej edycji cofnięcie planu skasowałoby te poprawki – zostaje tylko tekst planu.
  if (state.lastPlan) state.lastPlan.undo = null;
  ui.editing = false; ui.draft = null; ui.setOrig = false; ui.importMsg = ""; ui.squadMsg = "Skład zapisany.";
  save(); renderAll();
}

function maybeRevertFreeHit(fromForm) {
  const fh = state.freeHit;
  if (!fh) return;
  const done = fromForm ? currentDone() : roundInfo(curRounds()).done;
  if (done >= fh.round) {
    state.current = fh.squadBefore; state.freeHit = null;
    ui.notice = `Free Hit z kolejki ${fh.round} się skończył. Przywrócono skład sprzed tej kolejki.`;
    save();
  }
}

function applyRec() {
  const rec = state.pendingRec;
  if (!rec || !state.current) return;
  const ev = evalRec(rec, evalCtx());
  if (ev.errors.length) return;
  const undo = clone({ current: state.current, chips: state.chips, freeHit: state.freeHit, rounds: state.rounds, draftRound: state.draftRound, pendingRec: rec });
  const before = clone(state.current);
  if (ev.chip) {
    state.chips[ev.chip] = false;
    if (ev.chip === "freehit") state.freeHit = { round: rec.forRound, squadBefore: before };
  }
  state.current = applyEvaluated(state.current, ev, state.rules, newId);
  logRound({ transfers: ev.list.map(t => ({ out: t.out.name, in: t.inn.name, price: t.inn.price })), chip: ev.chip, hits: ev.hits, summary: rec.summary }, before.players);
  state.lastPlan = { forRound: rec.forRound, text: planText({ forRound: rec.forRound, ev, after: state.current, hitCost: state.rules.hitCost }), appliedAt: Date.now(), undo };
  state.pendingRec = null;
  ui.selected = null; ui.swapFrom = null;
  ui.squadMsg = ev.list.length ? `Zastosowano ${countN(ev.list.length, "transfer", "transfery", "transferów")}. Wprowadź zmiany także w Sofascore.` : "Ustawienie zapisane. Wprowadź je też w Sofascore.";
  save(); switchTab("squad");
}

// Przywraca skład, chipy, historię i plan sprzed „Zastosuj zmiany”.
function undoPlan() {
  const lp = state.lastPlan;
  if (!lp || !lp.undo) return;
  Object.assign(state, clone(lp.undo));
  state.lastPlan = null;
  ui.selected = null; ui.swapFrom = null; ui.notice = "";
  ui.squadMsg = `Cofnięto plan na kolejkę ${lp.forRound}. Możesz go poprawić i zastosować ponownie w zakładce Kolejka.`;
  save(); renderAll();
}

function logRound(extra, roster) {
  const d = state.draftRound;
  roster = roster || state.current.players;
  const n = currentDone();
  const playerPts = Object.entries(d.playerPts || {}).filter(([, v]) => v !== "" && v != null)
    .map(([id, v]) => { const p = roster.find(x => x.id === id); return { name: p ? p.name : "?", pts: Number(v) }; }).slice(0, 15);
  const entry = Object.assign({ n, points: d.total !== undefined ? d.total : "", playerPts, transfers: [], chip: null, hits: 0, summary: "", savedAt: Date.now() }, extra || {});
  const i = state.rounds.findIndex(r => r.n === n);
  if (i >= 0) {
    const old = state.rounds[i];
    entry.transfers = (old.transfers || []).concat(entry.transfers || []);
    entry.chip = entry.chip || old.chip;
    entry.hits = (old.hits || 0) + (entry.hits || 0);
    entry.summary = entry.summary || old.summary;
    state.rounds[i] = entry;
  } else state.rounds.push(entry);
  state.rounds.sort((a, b) => a.n - b.n);
  state.draftRound = {};
}

/* ---------- header ---------- */
function renderHeader() {
  const ri = roundInfo(curRounds());
  const el = $("#nextInfo");
  if (!ri.next) { el.textContent = "Faza ligowa zakończona"; el.dataset.urgent = ""; return ri.done; }
  const left = timeLeft(ri.deadline);
  el.textContent = `Kolejka ${ri.next.n} · termin ${fmtDate(ri.deadline)}${ri.next.sure ? "" : " (szac.)"}${left ? ` · za ${left}` : ""}`;
  // Ostatnia doba przed terminem – wyróżnione, żeby nie przegapić zmian w Sofascore.
  el.dataset.urgent = ri.deadline.getTime() - Date.now() < 24 * 3600e3 ? "1" : "";
  return ri.done;
}

/* ---------- squad tab ---------- */
function chipHTML(p, cur) {
  const isC = p.id === cur.captain, isV = p.id === cur.vice;
  const pts = (state.draftRound.playerPts || {})[p.id];
  return `<button class="pl${ui.selected === p.id ? " sel" : ""}${ui.swapFrom === p.id ? " swapsrc" : ""}" data-pid="${esc(p.id)}" data-pos="${p.pos}" aria-label="${esc(p.name)}, ${esc(p.club)}, ${fmt(p.price)} mln${isC ? ", kapitan" : isV ? ", wicekapitan" : ""}">
    <span class="shirt">${short(p.club)}</span>
    ${isC ? '<span class="badge">C</span>' : isV ? '<span class="badge v">V</span>' : ""}
    <span class="pl-name">${esc(lastName(p.name))}</span>
    <span class="pl-meta">${fmt(p.price)}${pts !== undefined && pts !== "" ? ` <span class="pl-pts">${esc(pts)}</span>` : ""}</span>
  </button>`;
}

function renderSquad() {
  const el = $("#tab-squad");
  if (acct.offerMigrate) {
    el.innerHTML = `<div class="card"><h2>Skład z tej przeglądarki</h2>
      <p class="muted">Na tym urządzeniu jest skład zapisany bez konta. Przenieść go na Twoje konto? Jeśli to nie Twój skład (np. wspólny telefon), zacznij od nowa.</p>
      <div class="actions"><button class="btn primary" id="migYes">Przenieś na moje konto</button><button class="btn" id="migNo">Zacznij od nowa</button></div></div>`;
    $("#migYes").addEventListener("click", () => { state = loadState(stateKey(null)); acct.offerMigrate = false; ui.squadMsg = "Skład przeniesiony na Twoje konto."; save(); renderAll(); });
    $("#migNo").addEventListener("click", () => { acct.offerMigrate = false; renderAll(); });
    return;
  }
  const cur = state.current;
  if (!cur || ui.editing) { el.innerHTML = editorHTML(); bindEditor(); return; }
  const value = r1(cur.players.reduce((s, p) => s + p.price, 0));
  const still = state.original ? cur.players.filter(p => state.original.players.some(o => norm(o.name) === norm(p.name))).length : 15;
  const byPos = pos => cur.xi.map(id => cur.players.find(p => p.id === id)).filter(p => p && p.pos === pos);
  const benchP = cur.bench.map(id => cur.players.find(p => p.id === id)).filter(Boolean);
  const sel = cur.players.find(p => p.id === ui.selected);
  const lp = lineupProblems(cur.players, cur.xi, state.rules);
  el.innerHTML = `
    ${ui.notice ? `<div class="notice">${esc(ui.notice)}</div>` : ""}
    ${ui.squadMsg ? `<div class="notice info">${esc(ui.squadMsg)}</div>` : ""}
    ${state.lastPlan && !state.lastPlan.hidden ? `<div class="card">
      <h3>Do wprowadzenia w Sofascore</h3>
      <pre class="plan-text" id="planText">${esc(state.lastPlan.text)}</pre>
      <div class="actions">
        <button class="btn" id="planCopy">Skopiuj plan</button>
        ${state.lastPlan.undo ? `<button class="btn" id="planUndo">Cofnij plan</button>` : ""}
        <button class="btn ghost" id="planHide">Ukryj</button>
        <span class="small muted" id="planMsg"></span>
      </div>
    </div>` : ""}
    <div class="stats">
      <div class="stat"><span>Wartość</span><b class="num">${fmt(value)}</b></div>
      <div class="stat"><span>Bank</span><b class="num">${fmt(cur.bank)}</b></div>
      <div class="stat"><span>Z pierwotnego</span><b class="num">${still}/15</b></div>
    </div>
    <div class="pitch" id="pitch"><div class="halfway"></div>
      ${POS.map(pos => `<div class="prow">${byPos(pos).map(p => chipHTML(p, cur)).join("")}</div>`).join("")}
    </div>
    <div class="bench" id="bench"><span class="bench-label">Ławka</span>${benchP.map(p => chipHTML(p, cur)).join("")}</div>
    ${lp.length ? `<div class="notice">${esc(lp.join(" "))}</div>` : ""}
    <div class="card">
      ${ui.swapFrom ? `<p><b>Zamiana:</b> stuknij zawodnika, z którym ${esc(lastName((cur.players.find(p => p.id === ui.swapFrom) || {}).name))} ma się zamienić.</p>
        <div class="actions"><button class="btn" id="swapCancel">Anuluj zamianę</button></div>`
      : sel ? `<div><b>${esc(sel.name)}</b><div class="small muted">${esc(sel.club || "klub ?")} · ${POS_ONE[sel.pos]} · ${fmt(sel.price)} M€</div></div>
        <div class="actions">
          <button class="btn" id="actCap" ${!cur.xi.includes(sel.id) || cur.captain === sel.id ? "disabled" : ""}>Kapitan</button>
          <button class="btn" id="actVice" ${!cur.xi.includes(sel.id) || cur.vice === sel.id || cur.captain === sel.id ? "disabled" : ""}>Wicekapitan</button>
          <button class="btn" id="actSwap">${cur.xi.includes(sel.id) ? "Zamień z ławką" : "Wstaw do składu"}</button>
          <button class="btn ghost" id="actClose">Zamknij</button>
        </div>`
      : `<p class="muted small">Stuknij zawodnika, żeby ustawić kapitana lub zamienić go z rezerwowym. Ustawienie zmieni się też tutaj po zastosowaniu planu z AI.</p>`}
    </div>
    <div class="actions">
      <button class="btn" id="editSquad">Edytuj skład i ceny</button>
      <button class="btn primary" id="goRound">Analiza po kolejce</button>
    </div>`;
  el.querySelectorAll(".pl").forEach(b => b.addEventListener("click", () => onPlayerTap(b.dataset.pid)));
  const on = (id, fn) => { const b = el.querySelector("#" + id); if (b) b.addEventListener("click", fn); };
  on("actCap", () => { cur.captain = sel.id; if (cur.vice === sel.id) cur.vice = null; save(); renderSquad(); });
  on("actVice", () => { cur.vice = sel.id; save(); renderSquad(); });
  on("actSwap", () => { ui.swapFrom = sel.id; ui.selected = null; renderSquad(); });
  on("actClose", () => { ui.selected = null; renderSquad(); });
  on("swapCancel", () => { ui.swapFrom = null; renderSquad(); });
  on("editSquad", () => { ui.editing = true; ui.draft = draftFromCurrent(); ui.squadMsg = ""; renderSquad(); });
  on("goRound", () => switchTab("round"));
  on("planCopy", async () => {
    const ok = await copyText(state.lastPlan.text);
    if (!ok) selectText($("#planText"));
    $("#planMsg").textContent = ok ? "Skopiowano." : "Zaznaczono plan – skopiuj go ręcznie.";
  });
  on("planUndo", undoPlan);
  on("planHide", () => { state.lastPlan.hidden = true; save(); renderSquad(); });
}

function onPlayerTap(pid) {
  const cur = state.current;
  ui.squadMsg = ""; ui.notice = "";
  if (ui.swapFrom) {
    const a = ui.swapFrom, b = pid;
    ui.swapFrom = null;
    if (a === b) { renderSquad(); return; }
    const xi = cur.xi.slice(), bench = cur.bench.slice();
    const where = id => xi.includes(id) ? ["xi", xi.indexOf(id)] : ["bench", bench.indexOf(id)];
    const [la, ia] = where(a), [lb, ib] = where(b);
    const L = { xi, bench };
    L[la][ia] = b; L[lb][ib] = a;
    const probs = lineupProblems(cur.players, xi, state.rules);
    if (probs.length) { ui.squadMsg = "Tej zamiany nie da się zrobić. " + probs.join(" "); renderSquad(); return; }
    cur.xi = xi; cur.bench = benchOrder(cur.players, xi, bench);
    if (!xi.includes(cur.captain)) cur.captain = cur.vice && xi.includes(cur.vice) ? cur.vice : pickCaptain(cur.players, xi);
    if (!xi.includes(cur.vice) || cur.vice === cur.captain) cur.vice = null;
    save(); renderSquad();
    return;
  }
  ui.selected = ui.selected === pid ? null : pid;
  renderSquad();
}

function editorHTML() {
  if (!ui.draft) ui.draft = state.current ? draftFromCurrent() : exampleDraft();
  const d = ui.draft;
  const first = !state.current;
  return `
    <div class="card">
      <div><h2>${first ? "Twój skład startowy" : "Edytuj skład"}</h2>
      <p class="muted small" style="margin-top:4px">${first
        ? "Wpisz 15 zawodników z aplikacji Sofascore. Ten skład zostanie zapamiętany jako pierwotny i AI będzie się go trzymać przy kolejnych zmianach."
        : "Popraw zawodników albo ceny (np. po zmianach cen w aplikacji). Transfery z planu AI wprowadzają się same."}</p></div>
      ${d.example ? `<div class="notice">To przykład: skład zaproponowany wcześniej w czacie. Zamień go na zawodników, których naprawdę masz w Sofascore.</div>` : ""}
      ${aiReady() ? `<div class="row">
        <label class="btn" for="shotFile" style="flex:none">${ui.importBusy ? "Odczytuję…" : "Wczytaj ze zrzutu ekranu"}</label>
        <input type="file" id="shotFile" accept="image/png,image/jpeg,image/webp" hidden ${ui.importBusy ? "disabled" : ""}>
        <span class="small muted" style="flex:1 1 200px">Zrób zrzut boiska w Sofascore Fantasy, a AI wypełni listę.</span></div>`
      : `<p class="small muted">Dodaj klucz API w zakładce Zasady, żeby wczytywać skład ze zrzutu ekranu.</p>`}
      ${ui.importMsg ? `<div class="notice info">${esc(ui.importMsg)}</div>` : ""}
      <datalist id="clubList">${CLUBS.map(c => `<option value="${esc(c)}">`).join("")}</datalist>
      ${POS.map(pos => `<div class="ed-group"><h3>${POS_PL[pos]}</h3>
        <div class="ed-head"><span>Zawodnik</span><span>Klub</span><span>Cena</span></div>
        ${d.players.filter(p => p.pos === pos).map(p => `<div class="ed-row" data-pid="${p.id}">
          <input type="text" id="ed-${p.id}-name" aria-label="${POS_ONE[pos]} – nazwisko" placeholder="Imię i nazwisko" value="${esc(p.name)}" data-f="name" autocomplete="off">
          <input type="text" id="ed-${p.id}-club" aria-label="${POS_ONE[pos]} – klub" placeholder="Klub" list="clubList" value="${esc(p.club)}" data-f="club" autocomplete="off">
          <input type="number" id="ed-${p.id}-price" aria-label="${POS_ONE[pos]} – cena" placeholder="M€" step="0.1" min="3" max="20" inputmode="decimal" value="${esc(p.price)}" data-f="price">
        </div>`).join("")}</div>`).join("")}
      <div class="row">
        <label class="f" for="edBank">Bank (M€) <span class="hint">puste = budżet minus wartość składu</span>
          <input type="number" id="edBank" step="0.1" inputmode="decimal" value="${d.bank === null || d.bank === undefined ? "" : esc(d.bank)}" placeholder="${fmt(state.rules.budget - draftValue(d))}"></label>
        <div class="stat" style="flex:1 1 140px"><span>Wartość składu</span><b class="num" id="edValue">${fmt(draftValue(d))}</b></div>
      </div>
      ${state.original && !first ? `<label class="check" style="align-self:flex-start"><input type="checkbox" id="edSetOrig" ${ui.setOrig ? "checked" : ""}> Ustaw też jako pierwotny skład</label>` : ""}
      <div id="edIssues"></div>
      <div class="actions">
        <button class="btn primary" id="edSave">Zapisz skład</button>
        ${!first ? `<button class="btn" id="edCancel">Anuluj</button>` : ""}
        ${d.example ? `<button class="btn ghost" id="edClear">Wyczyść listę</button>` : ""}
      </div>
    </div>`;
}

function bindEditor() {
  const el = $("#tab-squad"), d = ui.draft;
  const rowPlayer = inp => d.players.find(x => x.id === inp.closest(".ed-row").dataset.pid);
  el.querySelectorAll(".ed-row input").forEach(inp => inp.addEventListener("input", () => {
    rowPlayer(inp)[inp.dataset.f] = inp.value;
    updateEditorIssues();
  }));
  el.querySelectorAll('.ed-row input[data-f="club"]').forEach(inp => inp.addEventListener("change", () => {
    const c = canonClub(inp.value);
    if (c && c !== inp.value) { inp.value = c; rowPlayer(inp).club = c; updateEditorIssues(); }
  }));
  const bankEl = $("#edBank");
  bankEl.addEventListener("input", () => { d.bank = bankEl.value === "" ? null : bankEl.value; updateEditorIssues(); });
  const so = $("#edSetOrig"); if (so) so.addEventListener("change", () => { ui.setOrig = so.checked; });
  $("#edSave").addEventListener("click", saveDraft);
  const c = $("#edCancel"); if (c) c.addEventListener("click", () => { ui.editing = false; ui.draft = null; ui.importMsg = ""; renderSquad(); });
  const cl = $("#edClear"); if (cl) cl.addEventListener("click", () => { ui.draft = emptyDraft(); renderSquad(); });
  const f = $("#shotFile"); if (f) f.addEventListener("change", () => { const file = f.files && f.files[0]; f.value = ""; importScreenshot(file); });
  updateEditorIssues();
}

function updateEditorIssues() {
  const d = ui.draft;
  if (!d) return;
  const players = d.players.map(p => ({ name: p.name, club: canonClub(p.club), pos: p.pos, price: p.price }));
  const bank = draftBank(d);
  const v = validateSquad(players, bank, state.rules);
  const ve = $("#edValue"); if (ve) ve.textContent = fmt(draftValue(d));
  const be = $("#edBank"); if (be) be.placeholder = fmt(state.rules.budget - draftValue(d));
  $("#edIssues").innerHTML = `<ul class="issues">${v.errors.map(e => `<li class="e">${esc(e)}</li>`).join("")}${v.warns.map(w => `<li class="w">${esc(w)}</li>`).join("")}${!v.errors.length ? `<li class="o">Skład zgodny z zasadami. Bank po zapisie: ${fmt(bank)} M€.</li>` : ""}</ul>`;
  $("#edSave").disabled = v.errors.length > 0;
}

/* ---------- round tab ---------- */
function renderRound() {
  const el = $("#tab-round");
  const cur = state.current;
  if (!cur) {
    el.innerHTML = `<div class="card"><h2>Najpierw skład</h2><p class="muted">Zapisz swoich 15 zawodników w zakładce Skład. Potem po każdej kolejce wrócisz tutaj po plan zmian.</p><div class="actions"><button class="btn primary" id="toSquad">Przejdź do składu</button></div></div>`;
    $("#toSquad").addEventListener("click", () => switchTab("squad"));
    return;
  }
  const d = state.draftRound;
  const done = currentDone(), next = done + 1;
  const fixtures = fixturesFor(next);
  const pts = d.playerPts || {};
  el.innerHTML = `
    ${ui.notice ? `<div class="notice">${esc(ui.notice)}</div>` : ""}
    ${!state.pendingRec && !state.rounds.length ? `<div class="card"><h2>Jak to działa</h2>
      <ol class="steps"><li>Po kolejce wpisz punkty i wiadomości (kontuzje, zawieszenia, zmiany cen) albo dodaj zrzuty z Sofascore.</li>
      <li>AI ocenia skład i proponuje transfery, kapitana i jedenastkę na następną kolejkę.</li>
      <li>Aplikacja sprawdza budżet, limit na klub i pozycje. Zgodny plan zastosujesz jednym przyciskiem, a potem wprowadzisz go w Sofascore.</li></ol></div>` : ""}
    <div class="card">
      <div class="row" style="align-items:center;justify-content:space-between">
        <h2>Po kolejce ${done}</h2>
        <span class="pill ${next > 8 ? "warn" : "ok"}">${next > 8 ? "Koniec fazy ligowej" : "Plan na kolejkę " + next}</span>
      </div>
      <div class="row">
        <label class="f" for="rDone">Zakończona kolejka<input type="number" id="rDone" min="1" max="8" value="${done}"></label>
        <label class="f" for="rTotal">Twoje punkty<input type="number" id="rTotal" inputmode="numeric" value="${esc(d.total ?? "")}" placeholder="np. 74"></label>
        <label class="f" for="rFree">Darmowe transfery<input type="number" id="rFree" min="0" max="15" value="${esc(freeNow())}"></label>
      </div>
      <details ${Object.keys(pts).length ? "open" : ""}><summary>Punkty zawodników (opcjonalnie)</summary>
        <div class="pts-grid">${cur.players.map(p => `<label class="pts-item" for="pts-${p.id}"><span>${esc(lastName(p.name))} <span class="muted small">${short(p.club)}</span></span><input type="number" id="pts-${p.id}" data-ppid="${p.id}" inputmode="numeric" value="${esc(pts[p.id] ?? "")}" placeholder="pkt"></label>`).join("")}</div>
      </details>
      <label class="f" for="rNews">Wiadomości<span class="hint">Kontuzje, zawieszenia, kto nie zagrał, zmiany cen. Wklej z Sofascore albo opisz własnymi słowami.</span>
        <textarea id="rNews" placeholder="np. Guirassy zszedł z urazem w 30. min, Yamal podrożał do 12,3">${esc(d.news || "")}</textarea></label>
      <label class="f" for="rFixtures">Mecze kolejki ${next}<span class="hint">${curFixtures()[next] ? "Uzupełnione z terminarza – popraw, jeśli coś się zmieniło." : "Wklej terminarz z Sofascore."}</span>
        <textarea id="rFixtures">${esc(fixtures)}</textarea></label>
      <label class="f" for="rMarket">Kandydaci z rynku<span class="hint">Opcjonalnie: zawodnicy, których rozważasz, z cenami z aplikacji. AI użyje tych cen zamiast szacunków.</span>
        <textarea id="rMarket" placeholder="np. Kane FWD Bayern 11,0; Raya GK Arsenal 6,0">${esc(d.market || "")}</textarea></label>
      <div class="f" style="font-size:.85rem;font-weight:600;color:var(--muted)">Zrzuty ekranu z Sofascore
        <div class="row" style="margin-top:4px"><label class="btn" for="rShots" style="flex:none">Dodaj zrzuty</label><input type="file" id="rShots" accept="image/png,image/jpeg,image/webp" multiple hidden>
        <span class="small muted" style="font-weight:400">${ui.roundImages.length ? `${ui.roundImages.length} dodane · <button class="btn ghost small" id="rShotsClear" style="padding:2px 4px">usuń</button>` : `Do ${MAX_IMAGES} zrzutów, np. punkty kolejki, ceny, statusy zawodników.`}</span></div></div>
      <div class="f" style="font-size:.85rem;font-weight:600;color:var(--muted)">Dostępne chipy
        <div class="checks" style="margin-top:4px">${CHIPS.map(c => `<label class="check" for="chip-${c.key}"><input type="checkbox" id="chip-${c.key}" data-chip="${c.key}" ${state.chips[c.key] ? "checked" : ""}> ${c.label}</label>`).join("")}</div></div>
      <div class="f" style="font-size:.85rem;font-weight:600;color:var(--muted)">Styl zmian
        <div class="seg" role="radiogroup" style="margin-top:4px">${STYLES.map(s => `<label for="st-${s.key}"><input type="radio" name="style" id="st-${s.key}" value="${s.key}" ${state.style === s.key ? "checked" : ""}>${s.label}</label>`).join("")}</div>
        <span class="small muted" style="font-weight:400;margin-top:4px">${esc((STYLES.find(s => s.key === state.style) || STYLES[1]).desc)}</span></div>
      ${!aiReady() ? `<div class="notice">Dodaj klucz API (Claude albo Gemini) w zakładce Zasady, żeby włączyć analizę AI. Punkty możesz zapisywać bez niego.</div>` : ""}
      <div class="actions">
        <button class="btn primary" id="analyze" ${!aiReady() || ui.aiBusy || next > 8 ? "disabled" : ""}>${ui.aiBusy ? "Analizuję…" : state.pendingRec ? "Analizuj ponownie" : "Analizuj z AI"}</button>
        ${ui.aiBusy ? `<button class="btn" id="stopAi">Zatrzymaj</button><span class="timer muted" id="aiTimer">${Math.round((Date.now() - ui.started) / 1000)} s${retryNote()}</span>` : ""}
        <button class="btn ghost" id="logOnly" ${ui.aiBusy ? "disabled" : ""}>Zapisz punkty bez zmian</button>
      </div>
      ${ui.aiBusy ? `<p class="small muted">AI przegląda skład, zasady i terminarz. Zwykle trwa to od 20 s do 2 minut, a przy dużym ruchu na serwerach nawet do 5 minut. Nie przełączaj aplikacji – telefon może wtedy zerwać połączenie.</p>` : ""}
      ${ui.aiMsg ? `<div class="notice">${esc(ui.aiMsg)}</div>` : ""}
    </div>
    <div id="recBox"></div>`;
  bindRound();
  renderRec();
}

function bindRound() {
  const d = state.draftRound;
  const bindVal = (id, key) => { const i = $("#" + id); if (i) i.addEventListener("input", () => { d[key] = i.value; draftSave(); }); };
  bindVal("rTotal", "total"); bindVal("rNews", "news"); bindVal("rMarket", "market"); bindVal("rFree", "free"); bindVal("rFixtures", "fixtures");
  // Liczba darmowych transferów zmienia minusowe punkty w planie – przelicz go od razu.
  $("#rFree").addEventListener("input", () => { if (state.pendingRec) renderRec(); });
  const rd = $("#rDone");
  rd.addEventListener("change", () => { d.done = Math.max(1, Math.min(8, parseInt(rd.value, 10) || 1)); save(); renderRound(); });
  document.querySelectorAll("#tab-round [data-ppid]").forEach(i => i.addEventListener("input", () => {
    d.playerPts = d.playerPts || {}; d.playerPts[i.dataset.ppid] = i.value; draftSave();
  }));
  document.querySelectorAll("#tab-round [data-chip]").forEach(c => c.addEventListener("change", () => { state.chips[c.dataset.chip] = c.checked; save(); if (state.pendingRec) renderRec(); }));
  document.querySelectorAll('#tab-round input[name="style"]').forEach(r => r.addEventListener("change", () => { state.style = r.value; save(); renderRound(); }));
  const sh = $("#rShots");
  if (sh) sh.addEventListener("change", () => { ui.roundImages = ui.roundImages.concat([...sh.files]).slice(0, MAX_IMAGES); sh.value = ""; renderRound(); });
  const sc = $("#rShotsClear"); if (sc) sc.addEventListener("click", () => { ui.roundImages = []; renderRound(); });
  $("#analyze").addEventListener("click", () => runAnalysis(null));
  const st = $("#stopAi"); if (st) st.addEventListener("click", () => ui.ctl && ui.ctl.abort());
  $("#logOnly").addEventListener("click", () => { logRound(); ui.notice = ""; if (state.lastPlan) state.lastPlan.undo = null; ui.aiMsg = "Kolejka zapisana w historii."; save(); renderAll(); });
}

function renderRec() {
  const box = $("#recBox");
  if (!box) return;
  const rec = state.pendingRec;
  if (!rec || !state.current) { box.innerHTML = ""; return; }
  const ev = evalRec(rec, evalCtx());
  const cur = state.current;
  const nameOf = id => { const p = ev.players.find(x => x.id === id); return p ? p.name : "?"; };
  const xiByPos = ev.lineupOk ? POS.map(pos => [pos, ev.xi.map(id => ev.players.find(p => p.id === id)).filter(p => p.pos === pos)]) : null;
  const status = ev.errors.length
    ? `<span class="pill bad">${countN(ev.errors.length, "problem", "problemy", "problemów")}</span>`
    : ev.warns.length ? `<span class="pill warn">Zgodne, sprawdź uwagi</span>` : `<span class="pill ok">Zgodne z zasadami</span>`;
  box.innerHTML = `<div class="card">
    <div class="rec-head"><h2>Plan na kolejkę ${esc(rec.forRound)}</h2>${status}</div>
    ${rec.summary ? `<p class="summary">${esc(rec.summary)}</p>` : ""}
    ${rec.model ? `<p class="small muted" id="recModel">Plan przygotował: ${esc(modelLabel(rec.model))}</p>` : ""}
    <h3>Transfery · ${rec.transfers.length} ${ev.chip === "wildcard" || ev.chip === "freehit" ? "(bez limitu)" : `z ${ev.free} darmowych`}</h3>
    ${rec.transfers.length ? rec.transfers.map((t, i) => {
      const out = cur.players.find(p => p.id === t.outId);
      return `<div class="tr">
        <div class="tr-line"><span class="tag out">OUT</span><span><b>${esc(out ? out.name : t.outName || "?")}</b> <span class="muted small">${esc(out ? out.club : "")}</span></span><span class="num">${out ? fmt(out.price) : "–"}</span></div>
        <div class="tr-line"><span class="tag in">IN</span>
          <div class="tr-in-fields">
            <input type="text" id="ti-${i}-name" data-i="${i}" data-f="name" value="${esc(t.in.name)}" aria-label="Kupowany zawodnik">
            <input type="text" id="ti-${i}-club" data-i="${i}" data-f="club" value="${esc(t.in.club)}" list="clubList2" aria-label="Klub">
            <input type="number" id="ti-${i}-price" data-i="${i}" data-f="price" step="0.1" value="${esc(t.in.price)}" aria-label="Cena w M€">
          </div><span></span></div>
        <div class="tr-reason"><span>${esc(t.reason)}</span><button class="btn ghost small" data-drop="${i}" style="padding:2px 6px;flex:none">Pomiń</button></div>
      </div>`;
    }).join("") : `<p class="muted">Bez transferów – obecny skład jest w porządku na tę kolejkę.</p>`}
    <datalist id="clubList2">${CLUBS.map(c => `<option value="${esc(c)}">`).join("")}</datalist>
    <dl class="kv">
      <dt>Bank po zmianach</dt><dd class="num">${fmt(ev.bank)} M€</dd>
      <dt>Kapitan</dt><dd>${esc(ev.captain ? nameOf(ev.captain) : rec.captain || "bez zmian")}</dd>
      <dt>Wicekapitan</dt><dd>${esc(ev.vice ? nameOf(ev.vice) : rec.vice || "bez zmian")}</dd>
      <dt>Chip</dt><dd>${ev.chip ? esc(CHIPS.find(c => c.key === ev.chip).label) : "nie teraz"}${rec.chipReason ? `<div class="small muted" style="font-weight:400">${esc(rec.chipReason)}</div>` : ""}</dd>
      <dt>Minusowe punkty</dt><dd class="num">${ev.hits ? "−" + ev.hits * state.rules.hitCost : "0"}</dd>
    </dl>
    ${xiByPos ? `<div><h3 style="margin-bottom:6px">Jedenastka</h3><div class="xi-list">${xiByPos.map(([pos, ps]) => `<div><b>${pos}</b>${ps.map(p => esc(lastName(p.name)) + (p.id === ev.captain ? " (C)" : p.id === ev.vice ? " (V)" : "")).join(", ")}</div>`).join("")}<div><b>Ławka</b>${ev.bench.map(id => esc(lastName(nameOf(id)))).join(", ")}</div></div></div>` : ""}
    ${rec.watchlist && rec.watchlist.length ? `<div><h3 style="margin-bottom:6px">Na radarze</h3><ul class="plain">${rec.watchlist.map(w => `<li><b>${esc(w.name)}</b> <span class="muted small">${esc(w.club)}</span> – ${esc(w.note)}</li>`).join("")}</ul></div>` : ""}
    ${rec.risks && rec.risks.length ? `<div><h3 style="margin-bottom:6px">Sprawdź przed terminem</h3><ul class="plain">${rec.risks.map(r => `<li>${esc(r)}</li>`).join("")}</ul></div>` : ""}
    <ul class="issues">${ev.errors.map(e => `<li class="e">${esc(e)}</li>`).join("")}${ev.warns.map(w => `<li class="w">${esc(w)}</li>`).join("")}${!ev.errors.length ? `<li class="o">Budżet, pozycje i limit na klub się zgadzają.</li>` : ""}</ul>
    <div class="actions">
      <button class="btn primary" id="applyRec" ${ev.errors.length ? "disabled" : ""}>Zastosuj zmiany</button>
      ${ev.errors.length && aiReady() ? `<button class="btn" id="fixRec" ${ui.aiBusy ? "disabled" : ""}>Poproś AI o poprawkę</button>` : ""}
      ${!ev.errors.length ? `<button class="btn" id="copyRec">Skopiuj plan</button>` : ""}
      <button class="btn ghost" id="dropRec">Odrzuć plan</button>
      <span class="small muted" id="recMsg"></span>
    </div>
  </div>`;
  const cp = $("#copyRec");
  if (cp) cp.addEventListener("click", async () => {
    let n = 0;
    const after = applyEvaluated(cur, ev, state.rules, () => "tmp" + n++);
    const ok = await copyText(planText({ forRound: rec.forRound, ev, after, hitCost: state.rules.hitCost }));
    $("#recMsg").textContent = ok ? "Skopiowano." : "Nie udało się skopiować. Zastosuj plan – pełny tekst pojawi się w zakładce Skład.";
  });
  box.querySelectorAll(".tr-in-fields input").forEach(inp => inp.addEventListener("change", () => {
    const t = rec.transfers[+inp.dataset.i], f = inp.dataset.f;
    if (f === "price") { t.in.price = inp.value === "" ? "" : r1(inp.value); t.in.priceConfirmed = true; }
    else if (f === "club") t.in.club = canonClub(inp.value);
    else t.in.name = inp.value.trim();
    save(); renderRec();
  }));
  box.querySelectorAll("[data-drop]").forEach(b => b.addEventListener("click", () => { rec.transfers.splice(+b.dataset.drop, 1); save(); renderRec(); }));
  $("#applyRec").addEventListener("click", applyRec);
  const fx = $("#fixRec");
  if (fx) fx.addEventListener("click", () => runAnalysis({ rec: { transfers: rec.transfers, chip: rec.chip, captain: rec.captain, startingXI: rec.startingXI }, errors: ev.errors }));
  $("#dropRec").addEventListener("click", () => { state.pendingRec = null; save(); renderRound(); });
}

/* ---------- history tab ---------- */
function renderHistory() {
  const el = $("#tab-history");
  const rounds = state.rounds;
  const withPts = rounds.filter(r => r.points !== "" && r.points != null && isFinite(Number(r.points)));
  const total = withPts.reduce((s, r) => s + Number(r.points), 0);
  let spark = "";
  if (withPts.length >= 2) {
    const W = 320, H = 110, pl = 30, pr = 12, pt = 14, pb = 24;
    const vals = withPts.map(r => Number(r.points));
    const mn = Math.min(0, ...vals);
    const top = Math.ceil(Math.max(...vals) / 20) * 20 || 20;
    const x = i => pl + (W - pl - pr) * (i / (withPts.length - 1));
    const y = v => pt + (H - pt - pb) * (1 - (v - mn) / (top - mn));
    const pts = withPts.map((r, i) => `${x(i)},${y(Number(r.points))}`).join(" ");
    const area = `${x(0)},${y(mn)} ${pts} ${x(withPts.length - 1)},${y(mn)}`;
    spark = `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Punkty w kolejnych kolejkach">
      ${[mn, top / 2, top].map(v => `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${Math.round(v)}</text>`).join("")}
      <polygon points="${area}" fill="var(--pitch)" opacity=".16"/>
      <polyline points="${pts}" fill="none" stroke="var(--pitch)" stroke-width="2.2" stroke-linejoin="round"/>
      ${withPts.map((r, i) => `<circle cx="${x(i)}" cy="${y(Number(r.points))}" r="${i === withPts.length - 1 ? 4.5 : 3}" fill="${i === withPts.length - 1 ? "var(--armband)" : "var(--pitch)"}" stroke="var(--surface)" stroke-width="1.5"/><text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)" font-family="IBM Plex Mono, monospace">K${r.n}</text>`).join("")}
    </svg>`;
  }
  const cur = state.current;
  el.innerHTML = `
    <div class="stats">
      <div class="stat"><span>Punkty łącznie</span><b class="num">${withPts.length ? total : "–"}</b></div>
      <div class="stat"><span>Kolejek</span><b class="num">${rounds.length}</b></div>
      <div class="stat"><span>Transfery</span><b class="num">${rounds.reduce((s, r) => s + (r.transfers || []).length, 0)}</b></div>
    </div>
    ${spark ? `<div class="card"><h3>Punkty po kolejkach</h3>${spark}</div>` : ""}
    <div class="card"><h2>Kolejki</h2>
      ${rounds.length ? rounds.slice().reverse().map(r => `<div class="hist-item">
        <div class="hist-top"><strong>Kolejka ${r.n}</strong><span class="num">${r.points !== "" && r.points != null ? esc(r.points) + " pkt" : "pkt –"}</span></div>
        ${(r.transfers || []).length ? `<div class="small">${r.transfers.map(t => `${esc(t.out)} → <b>${esc(t.in)}</b>`).join(" · ")}</div>` : `<div class="small muted">Bez transferów</div>`}
        ${r.chip || r.hits ? `<div class="small muted">${r.chip ? "Chip: " + esc((CHIPS.find(c => c.key === r.chip) || {}).label || r.chip) : ""}${r.chip && r.hits ? " · " : ""}${r.hits ? "−" + r.hits * state.rules.hitCost + " pkt za transfery" : ""}</div>` : ""}
        ${(r.playerPts || []).length ? `<div class="small muted">${r.playerPts.slice().sort((a, b) => b.pts - a.pts).slice(0, 3).map(p => esc(lastName(p.name)) + " " + p.pts).join(", ")}</div>` : ""}
        <div class="actions"><button class="btn ghost small${ui.histDel === r.n ? " danger" : ""}" data-del="${r.n}" style="padding:2px 6px">${ui.histDel === r.n ? "Kliknij ponownie, żeby usunąć" : "Usuń wpis"}</button></div>
      </div>`).join("") : `<p class="muted">Tu pojawi się każda kolejka: punkty, transfery i użyte chipy. Zapisuje się po zastosowaniu planu albo przycisku „Zapisz punkty bez zmian”.</p>`}
    </div>
    <div class="card"><h2>Pierwotny skład</h2>
      ${state.original ? `<p class="small muted">Zapisany ${new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long" }).format(new Date(state.original.savedAt || Date.now()))}. Przekreśleni zostali już sprzedani.</p>
      <div class="orig-list">${state.original.players.map(p => { const kept = cur && cur.players.some(c => norm(c.name) === norm(p.name)); return `<span class="${kept ? "" : "gone"}">${p.pos} · ${esc(p.name)}</span>`; }).join("")}</div>` : `<p class="muted">Jeszcze nie zapisano składu.</p>`}
    </div>`;
  // Usuwa tylko wpis w historii; skład i chipy zostają bez zmian.
  el.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
    const n = Number(b.dataset.del);
    if (ui.histDel !== n) { ui.histDel = n; renderHistory(); return; }
    ui.histDel = null;
    state.rounds = state.rounds.filter(r => r.n !== n);
    save(); renderHistory();
  }));
}

/* ---------- account ---------- */
function accountCardHTML() {
  if (!cloud.enabled) return "";
  if (acct.mode !== "cloud") {
    return `<div class="card"><h2>Konto</h2>
      <p class="small muted">Korzystasz bez konta – dane są tylko w tej przeglądarce. Z kontem zobaczysz skład na każdym telefonie i zagrasz w lidze znajomych.</p>
      <div class="actions"><button class="btn primary" id="accLogin">Zaloguj się lub załóż konto</button></div></div>`;
  }
  const p = acct.profile || {}, u = cloud.user() || {};
  return `<div class="card"><h2>Konto</h2>
    <p><b>${esc(p.display_name || "")}</b> <span class="muted small">${esc(u.email || p.email || "")}</span> ${isAdmin() ? `<span class="pill ok">admin</span>` : ""}</p>
    <div class="row"><label class="f" for="accName">Nazwa w lidze<input type="text" id="accName" maxlength="40" value="${esc(p.display_name || "")}"></label>
      <button class="btn" id="accNameSave" style="flex:none">Zapisz nazwę</button></div>
    <div class="row"><label class="f" for="accPw">Nowe hasło<input type="password" id="accPw" autocomplete="new-password" minlength="8"></label>
      <button class="btn" id="accPwSave" style="flex:none">Zmień hasło</button></div>
    <div class="actions"><button class="btn danger" id="accLogout">Wyloguj</button></div>
    ${acct.msg ? `<p class="small" id="accMsg">${esc(acct.msg)}</p>` : ""}
  </div>`;
}

function bindAccountCard() {
  const li = $("#accLogin");
  if (li) li.addEventListener("click", () => { saveMode(""); showAuth(); });
  const ns = $("#accNameSave");
  if (ns) ns.addEventListener("click", async () => {
    const name = $("#accName").value.trim();
    if (!name) { acct.msg = "Wpisz nazwę."; renderRules(); return; }
    try { await cloud.updateMyName(name); acct.profile.display_name = name; acct.msg = "Nazwa zapisana."; }
    catch (e) { acct.msg = (e && e.message) || "Nie udało się zapisać nazwy."; }
    renderRules();
  });
  const ps = $("#accPwSave");
  if (ps) ps.addEventListener("click", async () => {
    const pw = $("#accPw").value;
    if (pw.length < 8) { acct.msg = "Hasło musi mieć co najmniej 8 znaków."; renderRules(); return; }
    try { await cloud.changePassword(pw); acct.msg = "Hasło zmienione."; }
    catch (e) { acct.msg = (e && e.message) || "Nie udało się zmienić hasła."; }
    renderRules();
  });
  const lo = $("#accLogout");
  if (lo) lo.addEventListener("click", logout);
}

/* ---------- rules tab ---------- */
function renderRules() {
  const el = $("#tab-rules"), r = state.rules;
  const prov = curProvider(), key = curKey();
  const masked = key ? key.slice(0, 8) + "…" + key.slice(-4) : "";
  const sharedAvail = acct.mode === "cloud" && !!(acct.aiCfg && acct.aiCfg.key_set);
  const cfg = acct.aiCfg || {};
  const sharedLabel = (MODELS.find(m => m.id === cfg.model) || {}).label || cfg.model;
  el.innerHTML = `
    ${accountCardHTML()}
    ${sharedAi() ? `<div class="card"><h2>Model AI</h2>
      <p>Analizy idą przez wspólny klucz ligi.</p>
      ${cfg.provider === "gemini" ? `<div class="row"><label class="f" for="sharedModel">Model<select id="sharedModel">${SHARED_GEMINI_MODELS.map(id =>
        `<option value="${id}" ${sharedModel() === id ? "selected" : ""}>${esc(modelLabel(id))}${id === cfg.model ? " – domyślny ligi" : ""}</option>`).join("")}</select></label></div>
      <p class="small muted">Gdy wybrany model jest przeciążony, aplikacja sama spróbuje kolejnego.</p>` : `<p>Model: <b>${esc(sharedLabel)}</b>.</p>`}
      <p class="small muted">Dziś wykorzystano ${esc(cfg.used_today ?? 0)} z ${esc(cfg.daily_limit)} analiz${isAdmin() ? " (jako admin nie masz limitu)" : ""}. Klucz zna tylko serwer – nikt go nie zobaczy.</p>
      <div class="actions">
        <button class="btn" id="keyCheck">Sprawdź połączenie</button>
        <button class="btn ghost" id="ownKeyOn">Używaj własnego klucza</button>
      </div>
      ${ui.keyMsg ? `<p class="small" id="keyMsg">${esc(ui.keyMsg)}</p>` : ""}
    </div>` : `
    <div class="card"><h2>Model AI i klucz API</h2>
      <div class="row"><label class="f" for="apiModel">Model<select id="apiModel">${Object.entries(PROVIDERS).map(([pk, p]) =>
        `<optgroup label="${esc(p.label)}">${MODELS.filter(m => m.provider === pk).map(m => `<option value="${m.id}" ${settings.model === m.id ? "selected" : ""}>${esc(m.label)}</option>`).join("")}</optgroup>`).join("")}</select></label></div>
      <p class="small muted">${esc(prov.label)}: klucz z <a href="${prov.keyUrl}" target="_blank" rel="noopener">${prov.keyHost}</a>. ${esc(prov.note)} Klucz zostaje tylko w tej przeglądarce i nie trafia do kopii danych.</p>
      ${key ? `<p class="small">Zapisany klucz: <span class="num">${esc(masked)}</span></p>` : ""}
      <div class="row"><label class="f" for="apiKey">${key ? "Nowy klucz" : "Klucz"} ${esc(prov.label)}<input type="password" id="apiKey" autocomplete="off" placeholder="${esc(prov.placeholder)}"></label></div>
      <div class="actions">
        <button class="btn primary" id="keySave">Zapisz klucz</button>
        ${key ? `<button class="btn" id="keyCheck">Sprawdź połączenie</button>` : ""}
        ${key ? `<button class="btn danger" id="keyDel">Usuń klucz</button>` : ""}
        ${sharedAvail ? `<button class="btn ghost" id="ownKeyOff">Wróć do wspólnego klucza ligi</button>` : ""}
      </div>
      ${ui.keyMsg ? `<p class="small" id="keyMsg">${esc(ui.keyMsg)}</p>` : ""}
    </div>`}
    <div class="card"><h2>Zasady gry</h2>
      <p class="small muted">Według tych zasad aplikacja sprawdza każdy plan AI. Budżet 100 M€ i limit 3 zawodników z klubu pochodzą z Sofascore. Liczbę darmowych transferów i koszt dodatkowego sprawdź w regulaminie w aplikacji i popraw, jeśli się różnią.</p>
      <div class="row">
        <label class="f" for="ruBudget">Budżet (M€)<input type="number" id="ruBudget" step="0.5" value="${r.budget}"></label>
        <label class="f" for="ruClub">Limit z jednego klubu<input type="number" id="ruClub" min="1" max="15" value="${r.maxPerClub}"></label>
      </div>
      <div class="row">
        <label class="f" for="ruFree">Darmowe transfery na kolejkę<input type="number" id="ruFree" min="0" max="15" value="${r.freeTransfers}"></label>
        <label class="f" for="ruHit">Koszt dodatkowego transferu (pkt)<input type="number" id="ruHit" min="0" max="20" value="${r.hitCost}"></label>
      </div>
      <dl class="kv"><dt>Skład</dt><dd>${r.squad.GK} GK · ${r.squad.DEF} DEF · ${r.squad.MID} MID · ${r.squad.FWD} FWD</dd>
        <dt>Jedenastka</dt><dd>1 GK · ${r.formation.DEF.join("–")} DEF · ${r.formation.MID.join("–")} MID · ${r.formation.FWD.join("–")} FWD</dd>
        <dt>Chipy</dt><dd>${CHIPS.map(c => c.label + (state.chips[c.key] ? "" : " (użyty)")).join(" · ")}</dd></dl>
      <div class="actions"><button class="btn" id="ruReset">Przywróć domyślne</button></div>
    </div>
    <div class="card"><h2>Kopia danych</h2>
      <p class="small muted">${acct.mode === "cloud" ? "Dane są zapisane na Twoim koncie (i w kopii w tej przeglądarce)." : "Dane są zapisane w tej przeglądarce."} Kopia pozwala przenieść je na inne urządzenie albo zabezpieczyć przed wyczyszczeniem przeglądarki.</p>
      <div class="actions"><button class="btn" id="exFile">Pobierz plik</button><button class="btn" id="exCopy">Skopiuj jako tekst</button><span class="small muted" id="exMsg"></span></div>
      <label class="f" for="imText">Wczytaj kopię<textarea id="imText" placeholder="Wklej tutaj skopiowaną kopię danych albo wybierz plik"></textarea></label>
      <div class="actions">
        <label class="btn" for="imFile">Wybierz plik</label><input type="file" id="imFile" accept="application/json,.json,.txt" hidden>
        <button class="btn" id="imBtn">${ui.importArm ? "Na pewno zastąpić obecne dane?" : "Wczytaj"}</button><span class="small muted" id="imMsg"></span>
      </div>
    </div>
    <div class="card"><h2>Zacznij od nowa</h2>
      <p class="small muted">Usuwa skład, pierwotny skład, historię i ustawienia gry. Klucze API zostają.</p>
      <div class="actions"><button class="btn danger" id="resetAll">${ui.resetArm ? "Kliknij ponownie, żeby usunąć wszystko" : "Usuń wszystkie dane"}</button></div>
    </div>`;

  bindAccountCard();
  const sm = $("#sharedModel");
  if (sm) sm.addEventListener("change", e => { settings.sharedModel = e.target.value; saveSettings(settings); ui.keyMsg = ""; renderRules(); });
  const own = v => () => { settings.ownKey = v; saveSettings(settings); ui.keyMsg = ""; renderAll(); switchTab("rules"); };
  const on = $("#ownKeyOn"); if (on) on.addEventListener("click", own(true));
  const off = $("#ownKeyOff"); if (off) off.addEventListener("click", own(false));
  const ks = $("#keySave");
  if (ks) ks.addEventListener("click", () => {
    // Klucze nie mają spacji ani złamań linii – usuwamy je, bo często dochodzą przy kopiowaniu na telefonie.
    const k = $("#apiKey").value.replace(/\s+/g, "");
    if (!k) { ui.keyMsg = "Najpierw wklej klucz."; renderRules(); return; }
    if (keyProblem(k)) { ui.keyMsg = keyProblem(k); renderRules(); return; }
    if (prov.keyPrefix && !k.startsWith(prov.keyPrefix)) { ui.keyMsg = `To nie wygląda na klucz ${prov.label} (zaczyna się od ${prov.keyPrefix}).`; renderRules(); return; }
    if (!prov.keyPrefix && k.startsWith("sk-")) { ui.keyMsg = `To wygląda na klucz innego dostawcy. Wklej klucz z ${prov.keyHost}.`; renderRules(); return; }
    settings[prov.keyField] = k;
    saveSettings(settings);
    ui.keyMsg = "Klucz zapisany.";
    renderAll(); switchTab("rules");
  });
  // Zmiana modelu może zmienić dostawcę i klucz, więc odświeżamy wszystkie zakładki.
  const am = $("#apiModel");
  if (am) am.addEventListener("change", e => { settings.model = e.target.value; saveSettings(settings); ui.keyMsg = ""; renderAll(); switchTab("rules"); });
  const kc = $("#keyCheck");
  if (kc) kc.addEventListener("click", async () => {
    kc.disabled = true; kc.textContent = "Sprawdzam…";
    try {
      const name = await checkAi(aiOpts());
      ui.keyMsg = `Połączenie działa: klucz jest poprawny, a model ${name} jest dostępny.`;
    } catch (e) {
      ui.keyMsg = (e && e.message) || "Sprawdzenie się nie udało.";
    }
    renderRules();
  });
  const kd = $("#keyDel");
  if (kd) kd.addEventListener("click", () => { settings[prov.keyField] = ""; saveSettings(settings); ui.keyMsg = "Klucz usunięty."; renderAll(); switchTab("rules"); });

  const num = (id, key) => $("#" + id).addEventListener("change", e => { const v = parseFloat(e.target.value); if (isFinite(v)) { r[key] = v; save(); } });
  num("ruBudget", "budget"); num("ruClub", "maxPerClub"); num("ruFree", "freeTransfers"); num("ruHit", "hitCost");
  $("#ruReset").addEventListener("click", () => { state.rules = clone(DEFAULT_RULES); save(); renderRules(); });

  const fallbackCopy = txt => { const t = $("#imText"); t.value = txt; t.select(); $("#exMsg").textContent = "Zaznaczono kopię w polu poniżej – skopiuj ją ręcznie."; };
  $("#exCopy").addEventListener("click", () => {
    const txt = JSON.stringify(state);
    try { navigator.clipboard.writeText(txt).then(() => { $("#exMsg").textContent = "Skopiowano."; }, () => fallbackCopy(txt)); }
    catch (e) { fallbackCopy(txt); }
  });
  $("#exFile").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `doradca-fantasy-lm-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $("#exMsg").textContent = "Pobrano plik.";
  });
  $("#imFile").addEventListener("change", async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try { $("#imText").value = await file.text(); }
    catch (err) { $("#imMsg").textContent = "Nie udało się odczytać pliku."; return; }
    ui.importArm = false; $("#imBtn").textContent = "Wczytaj";
    $("#imMsg").textContent = "Plik gotowy. Kliknij „Wczytaj”, żeby zastąpić obecne dane.";
  });
  $("#imBtn").addEventListener("click", () => {
    const raw = $("#imText").value.trim();
    if (!raw) { $("#imMsg").textContent = "Najpierw wklej kopię albo wybierz plik."; return; }
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !("rules" in parsed || "current" in parsed)) {
      $("#imMsg").textContent = "To nie wygląda na kopię z tej aplikacji."; return;
    }
    if (!ui.importArm) { ui.importArm = true; renderRules(); $("#imText").value = raw; return; }
    ui.importArm = false; state = normalizeState(parsed); save(); renderAll(); switchTab("rules");
    $("#imMsg").textContent = "Wczytano.";
  });
  $("#resetAll").addEventListener("click", () => {
    if (!ui.resetArm) { ui.resetArm = true; renderRules(); return; }
    ui.resetArm = false; state = freshState(); ui.draft = null; ui.editing = false; ui.roundImages = [];
    save(); renderAll(); switchTab("squad");
  });
}

/* ---------- shell ---------- */
const TABS = ["squad", "round", "history", "rules", "admin"];
function renderAll() {
  maybeRevertFreeHit(false);
  renderHeader();
  renderSquad(); renderRound(); renderHistory(); renderRules();
}
function switchTab(t) {
  if (t === "admin" && !isAdmin()) t = "squad";
  ui.tab = t;
  document.querySelectorAll(".tab-btn").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
  TABS.forEach(k => { $("#tab-" + k).hidden = k !== t; });
  if (t !== "rules") { ui.resetArm = false; ui.importArm = false; ui.keyMsg = ""; acct.msg = ""; }
  ui.histDel = null;
  if (t === "squad") renderSquad();
  if (t === "history") renderHistory();
  if (t === "rules") renderRules();
  if (t === "admin") renderAdminTab();
  window.scrollTo(0, 0);
}
document.querySelectorAll(".tab-btn").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));

function renderAdminTab() {
  renderAdmin($("#tab-admin"), {
    cloud, me: acct.profile, MODELS, PROVIDERS,
    rounds: curRounds, fixtures: curFixtures, nextRound: () => Math.min(8, roundInfo(curRounds()).done + 1),
    // Kolejka nie rysuje się przy zmianie zakładki (żeby nie gubić wpisów), więc odświeżamy ją tu.
    onGameData: gd => { applyGame(gd); renderHeader(); renderRound(); },
    onAiConfig: c => { acct.aiCfg = c; renderRound(); },
  });
}

function applyGame(gd) {
  game = mergeGameData(ROUNDS, FIXTURES, gd);
  lastDone = roundInfo(curRounds()).done;
}

/* ---------- start: konto albo tryb bez konta ---------- */
// Widok: "app" (zakładki), "auth" (logowanie) albo komunikat w miejscu zakładek.
function showView(v) {
  $("#auth").hidden = v === "app";
  $(".tabs").hidden = v !== "app";
  if (v !== "app") TABS.forEach(k => { $("#tab-" + k).hidden = true; });
}
function showMessage(html) {
  showView("auth");
  $("#auth").innerHTML = html;
}
function showApp() {
  showView("app");
  const admin = isAdmin();
  $("#tabAdmin").hidden = !admin;
  $(".tabs-in").classList.toggle("five", admin);
  renderAll(); switchTab(ui.tab);
}
function showAuth() {
  showView("auth");
  setSync("saved", "Bez konta");
  renderAuth($("#auth"), {
    cloud, hasLocalData: hasData(loadState()),
    onSignedIn: startCloud,
    onLocal: () => { saveMode("local"); startLocal(); },
  });
}

function startLocal() {
  Object.assign(acct, { mode: "local", profile: null, aiCfg: null, offerMigrate: false, msg: "" });
  stateKeyNow = stateKey(null);
  state = loadState(stateKeyNow);
  applyGame(null);
  setSync("saved", "Zapisano w przeglądarce");
  showApp();
}

async function startCloud() {
  showMessage(`<div class="card"><p class="muted">Łączę z Twoim kontem…</p></div>`);
  try {
    const user = cloud.user() || await cloud.loadUser();
    const profile = await cloud.profile();
    if (!profile) throw Object.assign(new Error("Nie znaleziono profilu konta. Zaloguj się ponownie."), { code: "session" });
    if (profile.blocked) {
      showMessage(`<div class="card"><h2>Konto zablokowane</h2><p class="muted">Admin ligi zablokował to konto. Skontaktuj się z nim, żeby je odblokować.</p>
        <div class="actions"><button class="btn" id="blockedLogout">Wyloguj</button></div></div>`);
      $("#blockedLogout").addEventListener("click", logout);
      return;
    }
    Object.assign(acct, { mode: "cloud", profile, msg: "" });
    stateKeyNow = stateKey(user.id);
    const [remote, cfg, gd] = await Promise.all([cloud.loadState(), cloud.aiConfig(), cloud.gameData()]);
    acct.aiCfg = cfg;
    applyGame(gd);
    if (remote && hasData(remote.state)) {
      state = normalizeState(remote.state);
      saveState(state, stateKeyNow);
      acct.offerMigrate = false;
    } else {
      const cached = loadState(stateKeyNow);
      state = hasData(cached) ? cached : freshState();
      // Skład z trybu bez konta przenosimy tylko na wyraźną zgodę (telefon może być wspólny).
      acct.offerMigrate = !hasData(state) && hasData(loadState(stateKey(null)));
    }
    saveMode("");
    setSync("saved", "Zapisano w chmurze");
    showApp();
  } catch (e) {
    if (e && e.code === "session") { await cloud.signOut(); showAuth(); return; }
    // Brak sieci: pracujemy na kopii z przeglądarki, zapis w chmurze ponowi się przy zmianie.
    acct.mode = "cloud";
    const u = cloud.user();
    stateKeyNow = stateKey(u && u.id);
    state = loadState(stateKeyNow);
    showApp();
    setSync("error", "Brak połączenia – zapisuję w przeglądarce");
  }
}

async function logout() {
  clearTimeout(cloudTimer);
  await cloud.signOut();
  resetAdmin();
  Object.assign(acct, { mode: "local", profile: null, aiCfg: null, offerMigrate: false, msg: "" });
  state = freshState(); ui.tab = "squad"; ui.draft = null; ui.editing = false;
  showAuth();
}

let lastDone = roundInfo(curRounds()).done;
async function boot() {
  if (cloud.enabled && cloud.fromUrlHash(location.hash)) history.replaceState(null, "", location.pathname + location.search);
  if (cloud.enabled && cloud.session()) return startCloud();
  if (cloud.enabled && loadMode() !== "local") return showAuth();
  startLocal();
}
boot();
// Odliczanie w nagłówku; gdy minie termin kolejki, odświeża całą stronę (np. koniec Free Hita).
setInterval(() => {
  if ($(".tabs").hidden) return;
  const done = renderHeader();
  if (done !== lastDone) { lastDone = done; renderAll(); }
}, 30000);
