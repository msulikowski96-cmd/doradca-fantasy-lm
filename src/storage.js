// Stan aplikacji w localStorage. Klucze API (Anthropic, Gemini) trzymamy osobno, żeby nie trafiły do eksportu.

import { DEFAULT_RULES, MODELS } from "./constants.js";

const STATE_KEY = "doradca-fantasy-lm-v1";
const SETTINGS_KEY = "doradca-fantasy-lm-settings";
const MODE_KEY = "doradca-fantasy-lm-mode";

/** Klucz kopii stanu w przeglądarce: osobny dla każdego konta, wspólny dla trybu bez konta. */
export const stateKey = uid => (uid ? `${STATE_KEY}:${uid}` : STATE_KEY);

const clone = o => JSON.parse(JSON.stringify(o));

export function freshState() {
  return {
    v: 1, updatedAt: 0, rules: clone(DEFAULT_RULES), style: "balanced",
    chips: { wildcard: true, freehit: true, triplecaptain: true },
    original: null, current: null, rounds: [], draftRound: {}, pendingRec: null, freeHit: null,
    // Ostatnio zastosowany plan: tekst do skopiowania i stan sprzed zmian (do cofnięcia).
    lastPlan: null,
  };
}

/** Uzupełnia brakujące pola (np. po imporcie starszej kopii). */
export function normalizeState(s) {
  const f = freshState();
  s = clone(s || {});
  const out = Object.assign(f, s);
  out.rules = Object.assign(clone(DEFAULT_RULES), s.rules || {});
  out.rules.squad = Object.assign(clone(DEFAULT_RULES.squad), (s.rules || {}).squad || {});
  out.rules.formation = Object.assign(clone(DEFAULT_RULES.formation), (s.rules || {}).formation || {});
  out.chips = Object.assign({ wildcard: true, freehit: true, triplecaptain: true }, s.chips || {});
  out.rounds = Array.isArray(s.rounds) ? s.rounds : [];
  out.draftRound = s.draftRound && typeof s.draftRound === "object" ? s.draftRound : {};
  return out;
}

export function loadState(key = STATE_KEY) {
  try { const raw = localStorage.getItem(key); return raw ? normalizeState(JSON.parse(raw)) : freshState(); }
  catch (e) { return freshState(); }
}

export function saveState(state, key = STATE_KEY) {
  state.updatedAt = Date.now();
  try { localStorage.setItem(key, JSON.stringify(state)); return true; }
  catch (e) { return false; }
}

/** Czy stan ma cokolwiek wartego zachowania (skład albo historię). */
export const hasData = s => !!(s && (s.current || (Array.isArray(s.rounds) && s.rounds.length)));

// Tryb pracy: "local" = użytkownik wybrał pracę bez konta (nie pokazujemy ekranu logowania).
export function loadMode() { try { return localStorage.getItem(MODE_KEY) || ""; } catch (e) { return ""; } }
export function saveMode(mode) { try { mode ? localStorage.setItem(MODE_KEY, mode) : localStorage.removeItem(MODE_KEY); } catch (e) { /* tryb prywatny */ } }

export function loadSettings() {
  const def = { apiKey: "", geminiKey: "", model: MODELS[0].id };
  let s;
  try { s = Object.assign(def, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")); }
  catch (e) { s = def; }
  if (!MODELS.some(m => m.id === s.model)) s.model = MODELS[0].id;
  return s;
}

export function saveSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* tryb prywatny */ }
}
