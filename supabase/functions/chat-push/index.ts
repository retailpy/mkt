// Retail MKT Hub · notificaciones push del Chat Retail MKT y de trabajos.
//   GET  → devuelve la clave pública VAPID (la crea la primera vez; la privada nunca sale del servidor).
//   POST → la llama la base de datos (trigger chat_push) cuando llega un mensaje nuevo, un aviso de trabajo
//          (trabajo nuevo, publicación para hacer, corrección, listo para revisar, aprobado, comentario, sugerencia o
//          falla de Drive: s:NOTIFS), un aviso del equipo (s:AVISOS) o un Pedido Comercial (s:PEDIDOS_COM); requiere x-push-secret.
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
// v228: también “approved” (Admin total aprobó tu trabajo), “nota” (comentario en un trabajo, a la persona o a Admin total),
// “sug” (sugerencia nueva: solo a quien las ve en la app) y “drive” (falló una subida a Google Drive: a Admin total).
const JOB_T: Record<string, string> = { nuevo: "Nuevo trabajo para vos", pub: "Nueva publicación para vos", listo: "Diseño aprobado: listo para publicar", fix: "Te pidieron una corrección", review: "Boceto listo para revisar",
  approved: "Admin total aprobó tu trabajo", nota: "Comentario en un trabajo", sug: "Llegó una sugerencia nueva", drive: "Google Drive: no se pudo subir un archivo" };
const TO_ADMIN = ["review", "nota", "sug", "drive"], TO_PERSON = ["nuevo", "pub", "listo", "fix", "approved", "nota"];
const SUG_READER = "fede"; // en la app, las sugerencias las ve solo esta persona (Admin total)
// El copy se guarda como la hoja del pedido (HTML): en el aviso va solo el texto.
const plain = (h: string) => h.replace(/<!--[\s\S]*?-->/g, "").replace(/<br\s*\/?>|<\/?(p|div|li|h\d)\b[^>]*>/gi, " ").replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
async function jobPush(cfg: any, items: any[]) {
  const list = (Array.isArray(items) ? items : []).filter((n) => n && JOB_T[n.type] && n.to && !n.read && (n.to === "admin" ? TO_ADMIN : TO_PERSON).includes(n.type)).slice(0, 20);
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
    if (n.to === "admin") {
      if (!admins) { const { data } = await db.from("members").select("person_id").eq("active", true).eq("role", "Admin total"); admins = (data || []).map((x) => x.person_id); }
      const who = people.find((x) => x.name === n.who)?.id;
      to = admins.filter((id) => id !== who && (n.type !== "sug" || id === SUG_READER));
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
      head = n.type === "review" ? (n.fix ? "Copy corregido para aprobar" : "Copy listo para aprobar") : n.type === "fix" ? "Te pidieron corregir el copy" : n.conf ? "Copy confirmado por Admin total" : "Copy aprobado: listo para publicar";
      body = n.type === "review" ? [`${w?.nick || String(n.who || "").split(" ")[0]} escribió el copy`, x.brand, "publicar el " + when, x.copy ? `“${short(plain(String(x.copy)), 100)}”` : ""].filter(Boolean).join(" · ")
        : n.type === "fix" ? (n.text ? `“${short(String(n.text), 140)}”` : x.brand || "") : [x.brand, "publicalo el " + when, n.conf ? "no lo tenés que escribir" : ""].filter(Boolean).join(" · ");
    } else if ((n.type === "pub" || n.type === "listo") && n.post) {
      const x = (n.canal ? canal : posts).find((y) => y.id === n.post);
      if (x) { title = x.title || title; body = `${x.brand || ""} · ${x.channel ? "Canal de WhatsApp" : `${x.net || ""} ${x.format || ""}`} · publicar el ${dm(x.date)}${x.time ? " a las " + x.time : ""}${n.type === "listo" ? " · ya tenés la ruta de la compartida" : ""}${x.copyConf && x.copySt === "ok" ? " · con el copy confirmado" : ""}`; go = `pub:${n.canal ? "canal" : "post"}:${x.id}`; }
    } else if (n.type === "pub") { // asignada desde el pedido de Diseño, todavía sin fecha en el calendario
      body = [brands, j?.piece, j?.pubDate ? "publicar el " + dm(j.pubDate) : "fecha de publicación sin definir"].filter(Boolean).join(" · "); go = "calcm";
    } else if (n.type === "review") {
      const w = people.find((x) => x.name === n.who), wn = w?.nick || String(n.who || "").split(" ")[0];
      body = [`${wn} ${n.fix ? "terminó las correcciones" : j?.area === "CM" ? "terminó su trabajo" : "terminó el boceto"}`, brands, j?.piece].filter(Boolean).join(" · ");
    } else if (n.type === "fix") body = n.text ? `“${short(String(n.text), 140)}”` : brands;
    else if (n.type === "nota") {
      if (!j) continue;
      const w = people.find((x) => x.name === n.who), wn = w?.nick || String(n.who || "").split(" ")[0];
      head = n.to === "admin" ? `${wn || "Alguien"} comentó en un trabajo` : "Admin total comentó en tu trabajo";
      body = n.text ? `“${short(String(n.text), 140)}”` : brands;
    } else if (n.type === "sug") {
      const x = ((await state("s:SUGGESTIONS")) || []).find((y: any) => y.id === n.sug);
      title = x?.topic || ""; body = x ? (x.anon ? "Anónima" : "De " + (people.find((p) => p.id === x.author)?.name || "alguien del equipo")) : ""; go = "sugerencias";
    } else if (n.type === "drive") {
      const w = people.find((x) => x.name === n.who), wn = w?.nick || String(n.who || "").split(" ")[0];
      title = ""; body = [wn, n.text ? `“${short(String(n.text), 140)}”` : ""].filter(Boolean).join(" · "); go = "cfg:integ";
    }
    else if (j) body = [brands, j.piece, j.due ? "fecha límite " + dm(j.due) : ""].filter(Boolean).join(" · ");
    if (!title && !body) continue;
    if (!head) head = n.type === "review" ? (n.fix ? "Correcciones listas para revisar" : j?.area === "CM" ? "Trabajo listo para revisar" : JOB_T.review) : JOB_T[n.type];
    const payload = JSON.stringify({ title: head, body: short([title, body].filter(Boolean).join("\n"), 220), tag: "rmh-job-" + n.id, open: "", go });
    sent += await send(cfg, to, () => payload);
  }
  return json({ ok: true, sent });
}

// Avisos del equipo (s:AVISOS, v228): cuando Admin total publica uno que ya está vigente, les llega a las personas de ese
// grupo (todo el equipo, Diseño, CM o Admins) o a las personas elegidas ("p:<persona>", botón Aviso), menos a quien lo publicó. Con “No molestar”, sin aviso.
const NO_TEAM = ["Revisor", "Comercial"]; // no son del equipo: sin avisos del equipo, sin chat de grupos y sin resumen del día
const AV_ICO: Record<string, string> = { Informativo: "📢", Importante: "⚠️", Urgente: "🚨" };
async function avisoPush(cfg: any, items: any[]) {
  const list = (Array.isArray(items) ? items : []).filter((a) => a && a.title && Array.isArray(a.to)).slice(0, 10);
  if (!list.length) return json({ ok: true, skipped: "sin avisos" });
  const presence: Record<string, any> = (await state("s:PRESENCE")) || {};
  const { data: members } = await db.from("members").select("person_id, role").eq("active", true);
  const now = Date.now();
  let sent = 0;
  for (const a of list) {
    const to = (members || []).filter((m) => !NO_TEAM.includes(m.role)).filter((m) => a.to.includes("todos") || a.to.includes(m.role) || a.to.includes("p:" + m.person_id) || (a.to.includes("admins") && ["Admin total", "Admin"].includes(m.role)))
      .map((m) => m.person_id).filter((id) => id !== a.by && !isDnd(presence[id], now));
    if (!to.length) continue;
    const range = a.from === a.until ? `el ${dm(a.from)}` : `del ${dm(a.from)} al ${dm(a.until)}`;
    // Botón Aviso (flash): el mensaje de Admin total tal cual, con vibración y sin que se cierre solo.
    const payload = a.flash ? JSON.stringify({ title: `🚨 ${short(String(a.title), 60)}`, body: short(String(a.text || ""), 220), tag: "rmh-av-" + a.id, open: "", go: "inicio", vibrate: [500, 200, 500, 200, 500] }) : JSON.stringify({ title: `${AV_ICO[a.level] || "📢"} Aviso ${String(a.level || "informativo").toLowerCase()}: ${short(String(a.title), 60)}`,
      body: short(`${a.text || ""}\n${range}`, 220), tag: "rmh-av-" + a.id, open: "", go: "inicio" });
    sent += await send(cfg, [...new Set(to)], () => payload);
  }
  return json({ ok: true, sent });
}

// Pedidos Comercial (v242): pedido nuevo de un comprador → a Admin total; pedido publicado → al comprador que lo cargó.
// Con “No molestar”, sin aviso.
async function pedidoPush(cfg: any, items: any[]) {
  const list = (Array.isArray(items) ? items : []).filter((p) => p && p.id && p.title).slice(0, 10);
  if (!list.length) return json({ ok: true, skipped: "sin pedidos" });
  const presence: Record<string, any> = (await state("s:PRESENCE")) || {};
  const { data: admins } = await db.from("members").select("person_id").eq("active", true).eq("role", "Admin total");
  const now = Date.now(), brands = (p: any) => (Array.isArray(p.brands) ? p.brands : []).join(" + ");
  let sent = 0;
  for (const p of list) {
    if (p.ev === "msg") { // v244: mensaje en un pedido. Del comprador → a Admin total; de Marketing → al comprador.
      const m = p.m || {}, fromBuyer = String(m.by || "") === String(p.by || "");
      const to = (fromBuyer ? (admins || []).map((x) => x.person_id) : [String(p.by || "")]).filter((id) => id && id !== m.by && !isDnd(presence[id], now));
      if (!to.length || !m.text) continue;
      const payload = JSON.stringify({ title: `💬 ${String(m.name || "Mensaje").split(" ")[0]} · ${short(String(p.title), 60)}`, body: short(String(m.text), 220), tag: "rmh-pcm-" + p.id, open: "", go: "com:" + p.id });
      sent += await send(cfg, [...new Set(to)], () => payload);
      continue;
    }
    const pub = p.ev === "pub";
    const to = (pub ? [String(p.by || "")] : (admins || []).map((m) => m.person_id)).filter((id) => id && id !== (pub ? "" : p.by) && !isDnd(presence[id], now));
    if (!to.length) continue;
    const payload = JSON.stringify(pub
      ? { title: "✅ ¡Tu pedido se publicó!", body: short(`${p.title}${brands(p) ? " · " + brands(p) : ""}`, 220), tag: "rmh-pc-" + p.id, open: "", go: "com:" + p.id }
      : { title: "🛍️ Nuevo pedido de Comercial", body: short([p.title, String(p.byName || ""), brands(p), p.date ? "publicar el " + dm(p.date) : ""].filter(Boolean).join(" · "), 220), tag: "rmh-pc-" + p.id, open: "", go: "com:" + p.id });
    sent += await send(cfg, [...new Set(to)], () => payload);
  }
  return json({ ok: true, sent });
}

// Resumen del día (v228): todas las mañanas (pg_cron, 7:45 de Paraguay) a cada persona le llega un solo aviso con lo de
// hoy, si hay algo: sus trabajos que vencen hoy o están atrasados, sus publicaciones para hoy, los Avisos del equipo que
// empiezan hoy y (a Admin total y CM) los cumpleaños de influencers. Es lo mismo que la app muestra en Alertas.
const JOB_DONE = ["Programado", "Publicado", "Pautado", "Entregado", "Cancelado"], POST_DONE = ["Programado", "Publicado", "Pautado"];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
async function dailyPush(cfg: any, dry = false) { // dry: devuelve lo que mandaría, sin mandar (para revisar)
  const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // Paraguay: UTC−3 todo el año
  const [people, presence, jobs, posts, canal, avisos, infl] = await Promise.all(["s:PEOPLE", "s:PRESENCE", "s:jobs", "s:posts", "s:CHANNEL_POSTS", "s:AVISOS", "s:INFLUENCERS"].map(state));
  const { data: members } = await db.from("members").select("person_id, role").eq("active", true);
  const now = Date.now(), P: any[] = people || [], pres: Record<string, any> = presence || {};
  const bdays = (infl || []).filter((x: any) => x && x.bday === hoy.slice(5));
  let sent = 0; const would: any[] = [];
  for (const m of members || []) {
    if (NO_TEAM.includes(m.role)) continue;
    const pp = P.find((x) => x.id === m.person_id);
    if (!pp || pp.active === false || isDnd(pres[m.person_id], now) || pres[m.person_id]?.st === "vac") continue;
    const mine = (jobs || []).filter((j: any) => j && j.owner === pp.name && !JOB_DONE.includes(j.status) && !(j.status === "Aprobado" && j.area !== "CM") && j.due);
    const today = mine.filter((j: any) => j.due === hoy).length, late = mine.filter((j: any) => j.due < hoy).length;
    const pubs = [...(posts || []), ...(canal || [])].filter((p: any) => p && p.cm === pp.name && p.date === hoy && !POST_DONE.includes(p.status)).length;
    const avs = (avisos || []).filter((a: any) => a && a.from === hoy && a.date !== hoy && a.until >= hoy && a.by !== pp.id && Array.isArray(a.to)
      && (a.to.includes("todos") || a.to.includes(m.role) || (a.to.includes("admins") && ["Admin total", "Admin"].includes(m.role))));
    const cumple = ["Admin total", "CM"].includes(m.role) ? bdays : [];
    const lines = [today ? plural(today, "trabajo vence hoy", "trabajos vencen hoy") : "", late ? plural(late, "trabajo atrasado", "trabajos atrasados") : "",
      pubs ? plural(pubs, "publicación para hoy", "publicaciones para hoy") : "",
      ...avs.map((a: any) => `${AV_ICO[a.level] || "📢"} Aviso: ${short(String(a.title), 60)}`),
      ...cumple.map((x: any) => `🎂 Hoy cumple años ${x.name} (Influencer de ${x.brand})`)].filter(Boolean);
    if (!lines.length) continue;
    if (dry) { would.push({ person: m.person_id, lines: lines.length }); continue; }
    const payload = JSON.stringify({ title: "☀️ Lo de hoy en Retail MKT Hub", body: short(lines.join("\n"), 220), tag: "rmh-dia-" + hoy, open: "", go: "inicio" });
    sent += await send(cfg, [m.person_id], () => payload);
  }
  return json(dry ? { ok: true, dry: true, hoy, would } : { ok: true, sent });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const cfg = await config();
  if (!cfg) return json({ error: "Sin configuración" }, 500);
  if (req.method === "GET") return json({ key: cfg.vapid_public });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  if (req.headers.get("x-push-secret") !== cfg.secret) return json({ error: "No autorizado" }, 401);

  let body: { key?: string; from?: number; items?: any[]; dry?: boolean };
  try { body = await req.json(); } catch { return json({ error: "Pedido inválido" }, 400); }
  const key = String(body.key || "");
  if (key === "s:NOTIFS") return jobPush(cfg, body.items || []);
  if (key === "s:AVISOS") return avisoPush(cfg, body.items || []);
  if (key === "s:PEDIDOS_COM") return pedidoPush(cfg, body.items || []);
  if (key === "daily") return dailyPush(cfg, body.dry === true);
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
    to = (members || []).filter((x) => !NO_TEAM.includes(x.role) && (g.all || (g.members || []).includes(x.person_id) || (g.roles || []).includes(x.role))).map((x) => x.person_id);
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
