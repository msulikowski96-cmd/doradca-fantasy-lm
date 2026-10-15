// Operacje admina na kontach, które wymagają uprawnień serwisowych:
// ustawienie nowego hasła (zamiast maila z resetem – darmowy SMTP Supabase nie wysyła do znajomych)
// i usunięcie konta. Role i blokady admin zmienia zwykłym zapisem w tabeli profiles (RLS + trigger).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(jwt);
  if (!auth?.user) return json(401, { message: "Sesja wygasła. Zaloguj się ponownie." });
  const { data: me } = await admin.from("profiles").select("role, blocked").eq("id", auth.user.id).single();
  if (!me || me.blocked || me.role !== "admin") return json(403, { message: "Tylko admin może zarządzać kontami." });

  let body: { action?: string; userId?: string; password?: string };
  try { body = await req.json(); } catch { return json(400, { message: "Nieprawidłowe zapytanie." }); }
  const { action, userId } = body;
  if (!userId || typeof userId !== "string") return json(400, { message: "Brak konta." });
  if (userId === auth.user.id && action === "delete") return json(400, { message: "Nie możesz usunąć własnego konta admina." });

  if (action === "set_password") {
    const password = String(body.password || "");
    if (password.length < 8) return json(400, { message: "Hasło musi mieć co najmniej 8 znaków." });
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return json(400, { message: `Nie udało się zmienić hasła: ${error.message}` });
    return json(200, { message: "Hasło zmienione. Przekaż je tej osobie." });
  }
  if (action === "delete") {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return json(400, { message: `Nie udało się usunąć konta: ${error.message}` });
    return json(200, { message: "Konto usunięte razem z jego danymi." });
  }
  return json(400, { message: "Nieznana operacja." });
});
