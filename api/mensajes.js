// Mensajes directos reales de cada marca: Instagram (DM) y Facebook (Messenger). Guarda en app_state → s:META_INBOX:
//   { "updated": "...", "Stock": { "page": "...", "pageId": "...", "handle": "@...", "err": null,
//       "convs": [ { id, net:"IG"|"FB", who, ts, answered, waitSince, msgs:[ { t, me, ts, att } ] } ] }, ... }
// Lo usa la sección “Mensajes” del Panel de Trabajo de CM: quién escribió y si ya se contestó (solo lectura:
// para contestar se usa Meta Business Suite). La leen solo Admin total, Admin y CM (lo controla la base).
//
// La llaman: el cron diario de Vercel y el botón “Actualizar” de la app (con la sesión de Admin o CM).
// Probar sin guardar:  /api/mensajes?dry=1&secret=EL_CRON_SECRET
// Permisos que necesita el META_TOKEN además de los de siempre: pages_messaging, instagram_manage_messages y
// pages_manage_metadata. En cada cuenta de Instagram tiene que estar activado “Permitir acceso a los mensajes”.
const { ORDEN, cronOrUser, brandPages, save, tokenHint } = require("./_lib/meta");

const GRAPH = "https://graph.facebook.com/v21.0";
const CONVS = 40; // conversaciones por red y por marca (las más recientes)
const MSGS = 6;   // últimos mensajes de cada conversación

async function g(path, params, token){
  const url = new URL(GRAPH + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const r = await fetch(url), j = await r.json().catch(() => ({}));
  if (!r.ok || j.error){ const e = j.error || {}, err = new Error(e.message || `HTTP ${r.status}`); err.code = e.code; throw err; }
  return j;
}

const short = (s, n = 400) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

function shape(c, net, meIds){
  const msgs = (c.messages?.data || []).slice(0, MSGS).reverse().map(m => ({
    t: short(m.message), me: meIds.includes(String(m.from?.id || "")), ts: m.created_time, att: !!(m.attachments?.data?.length) && !m.message,
  }));
  const other = (c.participants?.data || []).find(p => !meIds.includes(String(p.id))) || {};
  const last = msgs[msgs.length - 1];
  let waitSince = null; // desde cuándo espera respuesta: el primer mensaje del cliente después de la última respuesta
  for (let i = msgs.length - 1; i >= 0 && !msgs[i].me; i--) waitSince = msgs[i].ts;
  return { id: c.id, net, who: other.username ? "@" + other.username : other.name || "Cliente", ts: c.updated_time || last?.ts || null,
    answered: !!last?.me, waitSince: last && !last.me ? waitSince : null, msgs };
}

module.exports = async (req, res) => {
  const who = await cronOrUser(req), cron = who === "cron";
  if (!who) return res.status(401).json({ ok: false, error: "No autorizado" });
  if (!process.env.META_TOKEN) return res.status(500).json({ ok: false, error: "Falta la variable META_TOKEN en Vercel" });
  const dry = req.query.dry === "1" && cron;
  try {
    const { byBrand } = await brandPages();
    // Token de cada página (con el token del usuario del sistema se obtiene el de cada página que administra).
    const tokens = {};
    let j = await g("/me/accounts", { fields: "id,access_token", limit: "100" }, process.env.META_TOKEN);
    for (;;){ (j.data || []).forEach(p => { tokens[p.id] = p.access_token; }); if (!j.paging?.next) break; j = await fetch(j.paging.next).then(r => r.json()); if (j.error) break; }
    const payload = { updated: new Date().toISOString() }, summary = {};
    const fields = `id,updated_time,participants,messages.limit(${MSGS}){message,from,created_time,attachments}`;
    for (const b of ORDEN){
      const p = byBrand[b]; if (!p) continue;
      const pt = tokens[p.pageId], out = { page: p.page, pageId: p.pageId, handle: p.handle, convs: [], err: null };
      if (!pt){ out.err = "Sin acceso a la página (no se pudo obtener su token)"; payload[b] = out; continue; }
      const errs = [];
      for (const [net, platform, me] of [["FB", "messenger", [p.pageId]], ["IG", "instagram", [p.pageId, p.igId].filter(Boolean)]]){
        if (net === "IG" && !p.igId) continue;
        try {
          // Instagram a veces pide traer menos datos por consulta: se reintenta con menos conversaciones y mensajes.
          let r, last;
          for (const [nc, nm] of [[CONVS, MSGS], [15, 3], [8, 2]]){
            try { r = await g(`/${p.pageId}/conversations`, { platform, fields: fields.replace(`messages.limit(${MSGS})`, `messages.limit(${nm})`), limit: String(nc) }, pt); break; }
            catch (e){ last = e; if (!/reduce the amount of data/i.test(e.message || "")) throw e; }
          }
          if (!r) throw last;
          out.convs.push(...(r.data || []).map(c => shape(c, net, me.map(String))));
        } catch (e){ errs.push(`${net === "IG" ? "Instagram" : "Facebook"}: ${e.message}${e.code === 10 || e.code === 200 || e.code === 230 ? " (falta un permiso de mensajes en el token)" : ""}`); }
      }
      out.convs.sort((a, c) => String(c.ts || "").localeCompare(String(a.ts || "")));
      out.err = errs.length ? errs.join(" · ") : null;
      payload[b] = out;
      summary[b] = { convs: out.convs.length, sinContestar: out.convs.filter(c => !c.answered).length, err: !!out.err };
    }
    if (!dry) await save("s:META_INBOX", payload);
    console.log(`[mensajes] ${JSON.stringify(summary)}${dry ? " (prueba, sin guardar)" : " guardados"}`);
    return res.status(200).json({ ok: true, dry, saved: !dry, summary });
  } catch (e){
    console.error(`[${req.url}] ERROR: ${e.message}${e.code ? ` (código ${e.code})` : ""}`);
    return res.status(500).json({ ok: false, error: e.message, hint: tokenHint(e) });
  }
};
