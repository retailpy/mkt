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
async function ingest(brand, conv, info, msg){
  const url = process.env.SUPABASE_URL, apikey = process.env.SUPABASE_KEY, secret = process.env.INGEST_KEY;
  const r = await fetch(`${url}/rest/v1/rpc/ingest_dm`, {
    method: "POST", headers: { apikey, Authorization: `Bearer ${apikey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_secret: secret, p_brand: brand, p_conv: conv, p_info: info, p_msg: msg }, (k, v) => typeof v === "string" ? v.replace(LONE, "") : v),
  });
  if (!r.ok) throw new Error(`Supabase: ${await r.text()}`);
}
const rawBody = req => new Promise((ok, ko) => { const ch = []; req.on("data", c => ch.push(c)); req.on("end", () => ok(Buffer.concat(ch))); req.on("error", ko); });
function signed(raw, header){
  const secret = process.env.META_APP_SECRET; if (!secret || !header) return false;
  const want = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(String(header)), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  const q = req.query || {};
  // 1) Verificación de Meta (al poner la dirección del webhook en la app).
  if (req.method === "GET" && q["hub.mode"] === "subscribe"){
    if (q["hub.verify_token"] === VERIFY()) return res.status(200).send(String(q["hub.challenge"] || ""));
    return res.status(403).send("token de verificación incorrecto");
  }
  // 2) Configurar o revisar (desde la app o el cron).
  if (req.method === "GET" && (q.setup || q.status)){
    if (!(await cronOrUser(req))) return res.status(401).json({ ok: false, error: "No autorizado" });
    try {
      const p = await pages(), out = {};
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
      return res.status(200).json({ ok: true, secret: !!process.env.META_APP_SECRET, verify: process.env.META_VERIFY_TOKEN ? "propio" : "retail-mkt-hub", pages: out });
    } catch (e){ return res.status(500).json({ ok: false, error: e.message }); }
  }
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  // 3) Un aviso de Meta: se comprueba la firma y se guarda cada mensaje.
  const raw = await rawBody(req);
  if (!process.env.META_APP_SECRET){ console.error("ERROR webhook-meta: falta la variable META_APP_SECRET en Vercel"); return res.status(200).json({ ok: false }); }
  if (!signed(raw, req.headers["x-hub-signature-256"])){ console.error("ERROR webhook-meta: firma inválida"); return res.status(401).json({ ok: false }); }
  let body; try { body = JSON.parse(raw.toString("utf8")); } catch { return res.status(400).json({ ok: false }); }
  if (body.object !== "instagram") return res.status(200).json({ ok: true, skip: body.object }); // Facebook se lee con /api/mensajes
  let n = 0;
  try {
    const p = await pages();
    for (const e of body.entry || []){
      const brand = p.byIg[String(e.id)]; if (!brand) continue;
      const tok = p.tokens[p.byBrand[brand].pageId];
      for (const m of e.messaging || []){
        const msg = m.message; if (!msg || !msg.mid || msg.is_deleted) continue;
        const me = !!msg.is_echo, uid = String(me ? m.recipient?.id : m.sender?.id || ""); if (!uid || uid === String(e.id)) continue;
        const who = me ? null : await whoIs(uid, tok);
        await ingest(brand, uid, { net: "IG", uid, who }, { mid: msg.mid, t: short(msg.text || ""), me, ts: new Date(m.timestamp || Date.now()).toISOString(), att: !msg.text });
        n++;
      }
    }
  } catch (e){ console.error(`ERROR webhook-meta: ${e.message}`); }
  return res.status(200).json({ ok: true, n });
};
