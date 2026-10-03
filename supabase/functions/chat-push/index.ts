// Retail MKT Hub · notificaciones push del Chat Retail MKT.
//   GET  → devuelve la clave pública VAPID (la crea la primera vez; la privada nunca sale del servidor).
//   POST → la llama la base de datos (trigger chat_push) cuando llega un mensaje nuevo; requiere x-push-secret.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function config() {
  const { data } = await db.from("push_config").select("*").eq("id", 1).single();
  if (data && !data.vapid_public) {
    const k = webpush.generateVAPIDKeys();
    await db.from("push_config").update({ vapid_public: k.publicKey, vapid_private: k.privateKey }).eq("id", 1).is("vapid_public", null);
    const again = await db.from("push_config").select("*").eq("id", 1).single();
    return again.data;
  }
  return data;
}
const state = async (key: string) => (await db.from("app_state").select("data").eq("key", key).maybeSingle()).data?.data;
const short = (t: string, n = 120) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const cfg = await config();
  if (!cfg) return json({ error: "Sin configuración" }, 500);
  if (req.method === "GET") return json({ key: cfg.vapid_public });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  if (req.headers.get("x-push-secret") !== cfg.secret) return json({ error: "No autorizado" }, 401);

  let body: { key?: string; from?: number };
  try { body = await req.json(); } catch { return json({ error: "Pedido inválido" }, 400); }
  const key = String(body.key || "");
  if (!/^(thread|chat):/.test(key)) return json({ ok: true, skipped: "clave" });
  const row = await state(key);
  const msgs: any[] = Array.isArray(row?.msgs) ? row.msgs : [];
  const fresh = msgs.slice(Math.max(0, Number(body.from) || 0));
  const m = fresh[fresh.length - 1];
  if (!m || !m.from) return json({ ok: true, skipped: "sin mensaje" });

  const people: any[] = (await state("s:PEOPLE")) || [];
  const presence: Record<string, any> = (await state("s:PRESENCE")) || {};
  const mutes: Record<string, string[]> = (await state("s:CHAT_MUTES")) || {};
  const { data: members } = await db.from("members").select("person_id, role").eq("active", true);
  const nameOf = (id: string) => { const p = people.find((x) => x.id === id); return p ? (p.nick || String(p.name || id).split(" ")[0]) : id; };

  let to: string[] = [], title = "", open = "";
  if (key.startsWith("thread:")) {
    to = [row.a, row.b].filter(Boolean);
    title = nameOf(m.from);
    open = "p:" + m.from;
  } else {
    const gid = key.slice(5);
    const g = ((await state("s:CHAT_GROUPS")) || []).find((x: any) => x.id === gid);
    if (!g || g.archived) return json({ ok: true, skipped: "grupo" });
    to = (members || []).filter((x) => g.all || (g.members || []).includes(x.person_id) || (g.roles || []).includes(x.role)).map((x) => x.person_id);
    title = g.name;
    open = "g:" + gid;
  }
  const now = Date.now();
  to = [...new Set(to)].filter((id) => id !== m.from)
    .filter((id) => !(presence[id]?.st === "dnd" && presence[id]?.until && new Date(presence[id].until).getTime() > now)) // No molestar: sin avisos
    .filter((id) => !(mutes[id] || []).includes(open)); // conversación silenciada: sin avisos (el contador de la app sigue)
  if (!to.length) return json({ ok: true, sent: 0 });

  const { data: subs } = await db.from("push_subs").select("endpoint, sub, person_id").in("person_id", to);
  webpush.setVapidDetails("https://idcdfmeeggmtkudkkzmu.supabase.co", cfg.vapid_public, cfg.vapid_private);
  const text = m.text ? String(m.text) : m.gif ? "GIF" : m.stk ? "Sticker" : "";
  const payload = JSON.stringify({
    title: fresh.length > 1 ? `${title} · ${fresh.length} mensajes nuevos` : title,
    body: short(key.startsWith("chat:") ? `${nameOf(m.from)}: ${text}` : text),
    tag: key, open,
  });
  let sent = 0;
  await Promise.all((subs || []).map(async (s) => {
    try { await webpush.sendNotification(s.sub, payload, { TTL: 3600 }); sent++; }
    catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) await db.from("push_subs").delete().eq("endpoint", s.endpoint); }
  }));
  return json({ ok: true, sent });
});
