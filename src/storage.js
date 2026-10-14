// Stan aplikacji w localStorage. Klucze API (Anthropic, Gemini) trzymamy osobno, żeby nie trafiły do eksportu.

import { DEFAULT_RULES, MODELS } from "./constants.js";

const STATE_KEY = "doradca-fantasy-lm-v1";
const SETTINGS_KEY = "doradca-fantasy-lm-settings";

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

export function loadState() {
  try { const raw = localStorage.getItem(STATE_KEY); return raw ? normalizeState(JSON.parse(raw)) : freshState(); }
  catch (e) { return freshState(); }
}

export function saveState(state) {
  state.updatedAt = Date.now();
  try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); return true; }
  catch (e) { return false; }
}

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
