// Mensajes de Instagram en vivo. Meta llama a esta dirección cada vez que alguien le escribe a una cuenta de
// Instagram de las marcas (y cuando la marca contesta), y se guarda en s:META_DM (función ingest_dm de Supabase).
// Hace falta porque la lista de conversaciones de Instagram que da Meta corta por tiempo en las cuentas con
// mucho movimiento: así los mensajes llegan igual, apenas se mandan.
//
//   GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…   → verificación de Meta al configurar el webhook
//   POST (de Meta, firmado con la clave secreta de la app)          → guarda cada mensaje
//   GET  ?setup=1   (cron o Admin total/Admin/CM desde la app)       → suscribe las páginas de las marcas a la app
//   GET  ?status=1  (idem)                                          → qué está configurado y qué falta
//
// Variables en Vercel: META_APP_SECRET (Configuración básica de la app en Meta for Developers) para comprobar la firma.
// Si el webhook se configuró en Instagram → "Configuración de la API con inicio de sesión de Instagram", Meta firma con la
// clave secreta de la app de Instagram: va en META_IG_APP_SECRET (se acepta cualquiera de las dos).
// Cada aviso queda anotado (sin el texto de los mensajes) en s:META_DM_LOG con log_dm, para ver dónde se corta.
// Token de verificación: META_VERIFY_TOKEN, o si no está, "retail-mkt-hub" (no es secreto: lo que protege es la firma).
const crypto = require("crypto");
const { ORDEN, cronOrUser, brandPages, graph } = require("./_lib/meta");

const GRAPH = "https://graph.facebook.com/v21.0";
const VERIFY = () => process.env.META_VERIFY_TOKEN || "retail-mkt-hub";
const short = (s, n = 400) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g; // mitades de emoji sueltas

// Páginas, Instagram de cada marca y token de cada página (se recuerdan 10 minutos por instancia).
let pagesCache = null;
async function pages(){
  if (pagesCache && Date.now() - pagesCache.at < 10 * 60e3) return pagesCache;
  const [{ byBrand }, acc] = await Promise.all([brandPages(), graph("/me/accounts", { fields: "id,access_token", limit: "100" })]);
  const tokens = {}; (acc.data || []).forEach(p => { tokens[p.id] = p.access_token; });
  const byIg = {}; for (const b of ORDEN) if (byBrand[b]?.igId) byIg[byBrand[b].igId] = b;
  return pagesCache = { at: Date.now(), byBrand, byIg, tokens };
}
// Nombre de quien escribe (usuario de Instagram), con el token de la página. Se recuerda por instancia.
const names = new Map();
async function whoIs(uid, token){
  if (names.has(uid)) return names.get(uid);
  let who = null;
  try {
    const r = await fetch(`${GRAPH}/${encodeURIComponent(uid)}?fields=name,username&access_token=${encodeURIComponent(token)}`);
    const j = await r.json(); if (!j.error) who = j.username ? "@" + j.username : j.name || null;
  } catch {}
  if (who) names.set(uid, who);
  return who;
}
async function rpc(fn, args){
  const url = process.env.SUPABASE_URL, apikey = process.env.SUPABASE_KEY;
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { apikey, Authorization: `Bearer ${apikey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_secret: process.env.INGEST_KEY, ...args }, (k, v) => typeof v === "string" ? v.replace(LONE, "") : v),
  });
  if (!r.ok) throw new Error(`Supabase: ${(await r.text()).slice(0, 200)}`);
}
const ingest = (brand, conv, info, msg) => rpc("ingest_dm", { p_brand: brand, p_conv: conv, p_info: info, p_msg: msg });
// Anota qué pasó con cada aviso (nunca el texto de los mensajes). Si falla, no corta nada.
async function log(ev){ try { await rpc("log_dm", { p_ev: ev }); } catch (e){ console.error(`ERROR webhook-meta (registro): ${e.message}`); } }
// El cuerpo tal cual llegó (la firma se calcula sobre esos bytes).
function rawBody(req){
  if (Buffer.isBuffer(req.rawBody)) return Promise.resolve(req.rawBody);
  return new Promise((ok) => {
    const ch = []; let done = false; const end = () => { if (!done){ done = true; ok(Buffer.concat(ch)); } };
    req.on("data", c => ch.push(Buffer.isBuffer(c) ? c : Buffer.from(c))); req.on("end", end); req.on("error", end);
    setTimeout(end, 5000);
  });
}
const SECRETS = () => [process.env.META_APP_SECRET, process.env.META_IG_APP_SECRET].filter(Boolean);
function signed(raw, header){
  if (!header) return false;
  const a = Buffer.from(String(header));
  return SECRETS().some(secret => { const b = Buffer.from("sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex")); return a.length === b.length && crypto.timingSafeEqual(a, b); });
}
// Los mensajes vienen en entry.messaging[] (lo normal) o en entry.changes[{ field:"messages", value }] (la prueba del panel de Meta).
const eventsOf = e => [...(e.messaging || []), ...(e.changes || []).filter(c => c.field === "messages" && c.value).map(c => c.value)];

module.exports = async (req, res) => {
  const q = req.query || {};
  // 1) Verificación de Meta (al poner la dirección del webhook en la app).
  if (req.method === "GET" && q["hub.mode"] === "subscribe"){
    const ok = q["hub.verify_token"] === VERIFY(); await log({ kind: "verify", ok });
    if (ok) return res.status(200).send(String(q["hub.challenge"] || ""));
    return res.status(403).send("token de verificación incorrecto");
  }
  // 2) Configurar o revisar (desde la app o el cron).
  if (req.method === "GET" && (q.setup || q.status)){
    if (!(await cronOrUser(req))) return res.status(401).json({ ok: false, error: "No autorizado" });
    try {
      // De qué app de Meta es el token (META_TOKEN): el webhook y la clave secreta tienen que ser de esa misma app.
      const [p, app] = await Promise.all([pages(), graph("/app", { fields: "id,name" }).then(a => ({ id: String(a.id), name: a.name || "" }), e => ({ error: e.message }))]), out = {};
      for (const b of ORDEN){
        const x = p.byBrand[b]; if (!x?.igId) continue;
        const tok = p.tokens[x.pageId]; if (!tok){ out[b] = { ok: false, error: "sin token de la página" }; continue; }
        try {
          if (q.setup){
            const r = await fetch(`${GRAPH}/${x.pageId}/subscribed_apps?subscribed_fields=messages&access_token=${encodeURIComponent(tok)}`, { method: "POST" });
            const j = await r.json(); out[b] = j.success ? { ok: true } : { ok: false, error: j.error?.message || "Meta no aceptó la suscripción" };
          } else {
            const r = await fetch(`${GRAPH}/${x.pageId}/subscribed_apps?access_token=${encodeURIComponent(tok)}`);
            const j = await r.json(); out[b] = j.error ? { ok: false, error: j.error.message } : { ok: (j.data || []).some(a => (a.subscribed_fields || []).includes("messages")) };
          }
        } catch (e){ out[b] = { ok: false, error: e.message }; }
      }
      await log({ kind: q.setup ? "setup" : "status", secret: SECRETS().length > 0, app, pages: Object.fromEntries(Object.entries(out).map(([b, x]) => [b, x.ok ? "ok" : String(x.error || "no").slice(0, 120)])) });
      return res.status(200).json({ ok: true, app, secret: SECRETS().length > 0, verify: process.env.META_VERIFY_TOKEN ? "propio" : "retail-mkt-hub", pages: out });
    } catch (e){ return res.status(500).json({ ok: false, error: e.message }); }
  }
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  // 3) Un aviso de Meta: se comprueba la firma y se guarda cada mensaje.
  const raw = await rawBody(req), sigH = req.headers["x-hub-signature-256"];
  let body = null; try { body = JSON.parse(raw.toString("utf8")); } catch {}
  const ev = { kind: "post", object: body?.object || null, bytes: raw.length, ids: (body?.entry || []).map(e => String(e.id)).slice(0, 10) };
  if (!SECRETS().length){ console.error("ERROR webhook-meta: falta la variable META_APP_SECRET en Vercel"); await log({ ...ev, sig: "falta la clave secreta en Vercel" }); return res.status(200).json({ ok: false }); }
  if (!signed(raw, sigH)){ console.error("ERROR webhook-meta: firma inválida"); await log({ ...ev, sig: sigH ? "no coincide" : "sin firma" }); return res.status(401).json({ ok: false }); }
  ev.sig = "ok";
  if (!body){ await log({ ...ev, err: "cuerpo ilegible" }); return res.status(400).json({ ok: false }); }
  if (body.object !== "instagram"){ await log({ ...ev, skip: true }); return res.status(200).json({ ok: true, skip: body.object }); } // Facebook se lee con /api/mensajes
  let n = 0; const brands = new Set(), unknown = new Set(), skipped = [];
  try {
    const p = await pages();
    for (const e of body.entry || []){
      const evs = eventsOf(e);
      // La cuenta de la marca: la del aviso, o la que manda/recibe el mensaje.
      const ids = [String(e.id), ...evs.flatMap(m => [String(m.recipient?.id || ""), String(m.sender?.id || "")])];
      const brandId = ids.find(id => p.byIg[id]), brand = brandId && p.byIg[brandId];
      if (!brand){ unknown.add(String(e.id)); continue; }
      brands.add(brand);
      const tok = p.tokens[p.byBrand[brand].pageId];
      for (const m of evs){
        const msg = m.message; if (!msg || !msg.mid || msg.is_deleted){ skipped.push(msg ? "borrado o sin id" : Object.keys(m).filter(k => !["sender", "recipient", "timestamp"].includes(k)).join(",") || "vacío"); continue; }
        const me = !!msg.is_echo, uid = String((me ? m.recipient?.id : m.sender?.id) || ""); if (!uid || uid === brandId){ skipped.push("sin cliente"); continue; }
        const who = me ? null : await whoIs(uid, tok);
        await ingest(brand, uid, { net: "IG", uid, who }, { mid: msg.mid, t: short(msg.text || ""), me, ts: new Date(+m.timestamp > 1e12 ? +m.timestamp : +m.timestamp * 1000 || Date.now()).toISOString(), att: !msg.text });
        n++;
      }
    }
  } catch (e){ console.error(`ERROR webhook-meta: ${e.message}`); ev.err = e.message.slice(0, 200); }
  await log({ ...ev, brands: [...brands], unknown: [...unknown], known: unknown.size ? Object.keys((pagesCache || {}).byIg || {}) : undefined, n, skipped: skipped.slice(0, 5) });
  return res.status(200).json({ ok: true, n });
};
