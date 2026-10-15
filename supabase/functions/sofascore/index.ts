// Pobiera terminarz fazy ligowej LM 2026/27 z SofaScore i zapisuje go w game_data (tylko admin).
// Uwaga: SofaScore nie ma publicznego API – to ich wewnętrzne API, które może się zmienić
// albo blokować zapytania z serwerów. Wtedy funkcja zwraca błąd, a admin wkleja terminarz ręcznie.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildGameData, pickSeason } from "./format.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const API = "https://api.sofascore.com/api/v1";
const UCL = 7; // unique-tournament Ligi Mistrzów w SofaScore
const SEASON = "26/27";
const LEAGUE_ROUNDS = 8;

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "content-type": "application/json" } });

async function sofa(path: string) {
  const res = await fetch(API + path, {
    headers: {
      "accept": "application/json",
      "user-agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
      "referer": "https://www.sofascore.com/",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`SofaScore odpowiedział ${res.status} na ${path}`);
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(jwt);
  if (!auth?.user) return json(401, { message: "Sesja wygasła. Zaloguj się ponownie." });
  const { data: profile } = await admin.from("profiles").select("role, blocked").eq("id", auth.user.id).single();
  if (!profile || profile.blocked || profile.role !== "admin") return json(403, { message: "Tylko admin może pobierać terminarz." });

  try {
    const seasons = await sofa(`/unique-tournament/${UCL}/seasons`);
    const season = pickSeason(seasons?.seasons, SEASON);
    if (!season) return json(404, { message: `SofaScore nie ma jeszcze sezonu ${SEASON} Ligi Mistrzów.` });
    const roundsEvents: Record<number, unknown[]> = {};
    for (let n = 1; n <= LEAGUE_ROUNDS; n++) {
      const data = await sofa(`/unique-tournament/${UCL}/season/${season.id}/events/round/${n}`);
      roundsEvents[n] = data?.events || [];
    }
    const { fixtures, rounds } = buildGameData(roundsEvents);
    if (!rounds.length) return json(404, { message: "SofaScore nie zwrócił meczów fazy ligowej." });
    const { error } = await admin.from("game_data").update({
      fixtures, rounds, source: "sofascore", updated_at: new Date().toISOString(), updated_by: auth.user.id,
    }).eq("id", 1);
    if (error) throw new Error(error.message);
    const games = Object.values(roundsEvents).reduce((s, e) => s + e.length, 0);
    return json(200, { message: `Pobrano ${rounds.length} kolejek i ${games} meczów z SofaScore.`, rounds });
  } catch (e) {
    return json(502, { message: `Nie udało się pobrać danych z SofaScore: ${(e as Error).message}. Wklej terminarz ręcznie w zakładce Kolejka.` });
  }
});
