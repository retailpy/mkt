// Contestar un mensaje directo de Instagram desde la app (Mensajes → abrir la conversación → Enviar).
// Sale desde la cuenta de la marca: POST /{página}/messages con el token de la página (API de mensajes de Instagram).
// Lo que se manda se guarda en s:META_DM (ingest_dm) para que se vea al momento; el aviso de Meta que llega después
// (is_echo) trae el mismo id y no se repite.
//   POST { brand:"Superseis", to:"<id de la persona en Instagram>", text:"…" }   (sesión de Admin total o CM)
// Meta solo deja contestar dentro de las 24 horas del último mensaje de la persona, y hace falta el permiso
// instagram_manage_messages (con acceso avanzado para escribirle a cualquier persona).
const { ORDEN, brandPages } = require("./_lib/meta");

const GRAPH = "https://graph.facebook.com/v21.0";
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g; // mitades de emoji sueltas

// Solo Admin total y CM (Admin es de control: ve pero no modifica). Devuelve el nombre para dejarlo anotado.
async function sender(req){
  const tok = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const url = process.env.SUPABASE_URL, apikey = process.env.SUPABASE_KEY;
  if (!tok || !url || !apikey || tok === process.env.CRON_SECRET) return null;
  const u = await fetch(`${url}/auth/v1/user`, { headers: { apikey, Authorization: `Bearer ${tok}` } }).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!u?.id) return null;
  const rows = await fetch(`${url}/rest/v1/members?select=role,active,person_id&user_id=eq.${encodeURIComponent(u.id)}`, { headers: { apikey, Authorization: `Bearer ${tok}` } }).then(r => r.ok ? r.json() : []).catch(() => []);
  const m = Array.isArray(rows) && rows.find(x => x.active && ["Admin total", "CM"].includes(x.role));
  return m ? { id: m.person_id || u.id } : null;
}
// Lo que dice Meta, en palabras.
function hint(e){
  const code = e?.code, sub = e?.error_subcode, msg = String(e?.message || "");
  if (sub === 2534022 || /outside of allowed window|24 hours/i.test(msg)) return "Pasaron más de 24 horas desde el último mensaje de la persona: Meta no deja contestar desde otras apps. Contestá desde Instagram.";
  if (code === 551 || /not available/i.test(msg)) return "Esa persona no está disponible para recibir mensajes ahora.";
  if (code === 10 || code === 200 || code === 230 || /permission|advanced access/i.test(msg)) return "Meta todavía no habilitó el envío desde la app (falta el acceso avanzado de instagram_manage_messages). Mientras tanto, contestá desde Instagram.";
  if (code === 190) return "El token de Meta venció: hay que generar uno nuevo.";
  return null;
}
async function ingest(brand, conv, msg){
  const url = process.env.SUPABASE_URL, apikey = process.env.SUPABASE_KEY;
  const r = await fetch(`${url}/rest/v1/rpc/ingest_dm`, {
    method: "POST", headers: { apikey, Authorization: `Bearer ${apikey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_secret: process.env.INGEST_KEY, p_brand: brand, p_conv: conv, p_info: { net: "IG", uid: conv }, p_msg: msg }),
  });
  if (!r.ok) throw new Error(`Supabase: ${(await r.text()).slice(0, 200)}`);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Usá POST" });
  const who = await sender(req);
  if (!who) return res.status(401).json({ ok: false, error: "No autorizado" });
  let body = req.body;
  if (typeof body === "string"){ try { body = JSON.parse(body); } catch { body = null; } }
  const brand = String(body?.brand || ""), to = String(body?.to || ""), text = String(body?.text || "").replace(LONE, "").trim();
  if (!ORDEN.includes(brand) || !/^\d{5,40}$/.test(to) || !text) return res.status(400).json({ ok: false, error: "Faltan datos (marca, persona o texto)" });
  if (text.length > 1000) return res.status(400).json({ ok: false, error: "El mensaje es muy largo (hasta 1000 letras)" });
  try {
    const { byBrand } = await brandPages(), page = byBrand[brand];
    if (!page?.pageId) return res.status(400).json({ ok: false, error: "No se encontró la página de la marca" });
    const acc = await fetch(`${GRAPH}/me/accounts?fields=id,access_token&limit=100&access_token=${encodeURIComponent(process.env.META_TOKEN || "")}`).then(r => r.json()).catch(() => ({}));
    const pt = (acc.data || []).find(p => String(p.id) === String(page.pageId))?.access_token;
    if (!pt) return res.status(400).json({ ok: false, error: "Sin acceso a la página de la marca" });
    const r = await fetch(`${GRAPH}/${page.pageId}/messages?access_token=${encodeURIComponent(pt)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: to }, message: { text }, messaging_type: "RESPONSE" }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error || !j.message_id){
      console.error(`ERROR responder: ${j.error?.message || r.status} (código ${j.error?.code || "-"}/${j.error?.error_subcode || "-"})`);
      return res.status(400).json({ ok: false, error: j.error?.message || `Meta respondió ${r.status}`, hint: hint(j.error) });
    }
    try { await ingest(brand, to, { mid: j.message_id, t: text.slice(0, 400), me: true, ts: new Date().toISOString(), att: false }); }
    catch (e){ console.error(`ERROR responder (guardar): ${e.message}`); }
    console.log(`[responder] ${brand}: mensaje enviado por ${who.id}`);
    return res.status(200).json({ ok: true, id: j.message_id });
  } catch (e){
    console.error(`ERROR responder: ${e.message}`);
    return res.status(500).json({ ok: false, error: e.message, hint: hint(e) });
  }
};
