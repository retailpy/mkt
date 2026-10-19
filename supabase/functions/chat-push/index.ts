// Retail MKT Hub · notificaciones push del Chat Retail MKT y de trabajos.
//   GET  → devuelve la clave pública VAPID (la crea la primera vez; la privada nunca sale del servidor).
//   POST → la llama la base de datos (trigger chat_push) cuando llega un mensaje nuevo o un aviso de trabajo
//          (trabajo nuevo, publicación para hacer, corrección o listo para revisar: s:NOTIFS); requiere x-push-secret.
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
const dm = (d: string) => (/^\d{4}-\d{2}-\d{2}/.test(d || "") ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "");
const isDnd = (pr: any, now: number) => pr?.st === "dnd" && pr?.until && new Date(pr.until).getTime() > now;

async function send(cfg: any, to: string[], payloadFor: (id: string) => string) {
  if (!to.length) return 0;
  const { data: subs } = await db.from("push_subs").select("endpoint, sub, person_id").in("person_id", to);
  webpush.setVapidDetails("https://idcdfmeeggmtkudkkzmu.supabase.co", cfg.vapid_public, cfg.vapid_private);
  let sent = 0;
  await Promise.all((subs || []).map(async (s) => {
    try { await webpush.sendNotification(s.sub, payloadFor(s.person_id), { TTL: 3600 }); sent++; }
    catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) await db.from("push_subs").delete().eq("endpoint", s.endpoint); }
  }));
  return sent;
}

// Avisos de trabajo: a quien le llegó (n.to es su nombre completo, como en la app). Con “No molestar”, sin aviso.
// “review” (to: "admin"): el boceto o las correcciones quedaron listos → a Admin total, para aprobar o pedir cambios.
const JOB_T: Record<string, string> = { nuevo: "Nuevo trabajo para vos", pub: "Nueva publicación para vos", listo: "Diseño aprobado: listo para publicar", fix: "Te pidieron una corrección", review: "Boceto listo para revisar" };
async function jobPush(cfg: any, items: any[]) {
  const list = (Array.isArray(items) ? items : []).filter((n) => n && JOB_T[n.type] && n.to && !n.read && (n.type === "review" ? n.to === "admin" : n.to !== "admin")).slice(0, 20);
  if (!list.length) return json({ ok: true, skipped: "sin avisos" });
  const people: any[] = (await state("s:PEOPLE")) || [];
  const presence: Record<string, any> = (await state("s:PRESENCE")) || {};
  const jobs: any[] = (await state("s:jobs")) || [];
  const needPosts = list.some((n) => n.type === "pub" || n.type === "listo" || n.copy);
  const posts: any[] = needPosts ? (await state("s:posts")) || [] : [];
  const canal: any[] = needPosts ? (await state("s:CHANNEL_POSTS")) || [] : [];
  const now = Date.now();
  let sent = 0, admins: string[] | null = null;
  for (const n of list) {
    let to: string[] = [];
    if (n.type === "review") {
      if (!admins) { const { data } = await db.from("members").select("person_id").eq("active", true).eq("role", "Admin total"); admins = (data || []).map((x) => x.person_id); }
      const who = people.find((x) => x.name === n.who)?.id;
      to = admins.filter((id) => id !== who);
    } else {
      const p = people.find((x) => x.name === n.to && x.active !== false);
      if (p) to = [p.id];
    }
    to = to.filter((id) => !isDnd(presence[id], now));
    if (!to.length) continue;
    const j = jobs.find((x) => x.id === n.job);
    const brands = j ? (Array.isArray(j.brands) && j.brands.length ? j.brands : [j.brand]).filter(Boolean).join(" + ") : "";
    let title = j?.title || "", body = "", go = j ? "job:" + j.id : "";
    let head = "";
    if (n.copy && n.post) { // v214: copy de la publicación (la CM lo manda → Admin total; Admin total aprueba o pide corrección → la CM)
      const x = (n.canal ? canal : posts).find((y) => y.id === n.post);
      if (!x) continue;
      const when = `${dm(x.date)}${x.time ? " a las " + x.time : ""}`, w = people.find((y) => y.name === n.who);
      title = x.title || ""; go = `pub:${n.canal ? "canal" : "post"}:${x.id}`;
      head = n.type === "review" ? (n.fix ? "Copy corregido para aprobar" : "Copy listo para aprobar") : n.type === "fix" ? "Te pidieron corregir el copy" : "Copy aprobado: listo para publicar";
      body = n.type === "review" ? [`${w?.nick || String(n.who || "").split(" ")[0]} escribió el copy`, x.brand, "publicar el " + when, x.copy ? `“${short(String(x.copy), 100)}”` : ""].filter(Boolean).join(" · ")
        : n.type === "fix" ? (n.text ? `“${short(String(n.text), 140)}”` : x.brand || "") : [x.brand, "publicalo el " + when].filter(Boolean).join(" · ");
    } else if ((n.type === "pub" || n.type === "listo") && n.post) {
      const x = (n.canal ? canal : posts).find((y) => y.id === n.post);
      if (x) { title = x.title || title; body = `${x.brand || ""} · ${x.channel ? "Canal de WhatsApp" : `${x.net || ""} ${x.format || ""}`} · publicar el ${dm(x.date)}${x.time ? " a las " + x.time : ""}${n.type === "listo" ? " · ya tenés la ruta de la compartida" : ""}`; go = `pub:${n.canal ? "canal" : "post"}:${x.id}`; }
    } else if (n.type === "pub") { // asignada desde el pedido de Diseño, todavía sin fecha en el calendario
      body = [brands, j?.piece, j?.pubDate ? "publicar el " + dm(j.pubDate) : "fecha de publicación sin definir"].filter(Boolean).join(" · "); go = "calcm";
    } else if (n.type === "review") {
      const w = people.find((x) => x.name === n.who), wn = w?.nick || String(n.who || "").split(" ")[0];
      body = [`${wn} ${n.fix ? "terminó las correcciones" : j?.area === "CM" ? "terminó su trabajo" : "terminó el boceto"}`, brands, j?.piece].filter(Boolean).join(" · ");
    } else if (n.type === "fix") body = n.text ? `“${short(String(n.text), 140)}”` : brands;
    else if (j) body = [brands, j.piece, j.due ? "fecha límite " + dm(j.due) : ""].filter(Boolean).join(" · ");
    if (!title && !body) continue;
    if (!head) head = n.type === "review" ? (n.fix ? "Correcciones listas para revisar" : j?.area === "CM" ? "Trabajo listo para revisar" : JOB_T.review) : JOB_T[n.type];
    const payload = JSON.stringify({ title: head, body: short([title, body].filter(Boolean).join("\n"), 220), tag: "rmh-job-" + n.id, open: "", go });
    sent += await send(cfg, to, () => payload);
  }
  return json({ ok: true, sent });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const cfg = await config();
  if (!cfg) return json({ error: "Sin configuración" }, 500);
  if (req.method === "GET") return json({ key: cfg.vapid_public });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  if (req.headers.get("x-push-secret") !== cfg.secret) return json({ error: "No autorizado" }, 401);

  let body: { key?: string; from?: number; items?: any[] };
  try { body = await req.json(); } catch { return json({ error: "Pedido inválido" }, 400); }
  const key = String(body.key || "");
  if (key === "s:NOTIFS") return jobPush(cfg, body.items || []);
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
    to = (members || []).filter((x) => x.role !== "Revisor" && (g.all || (g.members || []).includes(x.person_id) || (g.roles || []).includes(x.role))).map((x) => x.person_id);
    title = g.name;
    open = "g:" + gid;
  }
  const now = Date.now();
  to = [...new Set(to)].filter((id) => id !== m.from)
    .filter((id) => !(presence[id]?.st === "dnd" && presence[id]?.until && new Date(presence[id].until).getTime() > now)) // No molestar: sin avisos
    .filter((id) => !(mutes[id] || []).includes(open)) // conversación silenciada: sin avisos (el contador de la app sigue)
    .filter((id) => !people.find((p) => p.id === id)?.noChat); // sin Chat Retail MKT (Usuarios y permisos): sin avisos
  if (!to.length) return json({ ok: true, sent: 0 });

  const { data: subs } = await db.from("push_subs").select("endpoint, sub, person_id").in("person_id", to);
  webpush.setVapidDetails("https://idcdfmeeggmtkudkkzmu.supabase.co", cfg.vapid_public, cfg.vapid_private);
  const text = m.text ? String(m.text) : m.img ? "📷 Foto" : m.doc ? "📎 " + String(m.doc.n || "Documento").slice(0, 80) : m.gif ? "GIF" : m.stk ? "Sticker" : "";
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
