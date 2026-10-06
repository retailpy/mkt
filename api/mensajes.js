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
const DAYS = 30;  // solo las conversaciones con movimiento en los últimos 30 días
const MAXC = 80;  // tope de conversaciones por red y por marca
const MSGS = 6;   // últimos mensajes de cada conversación
const since = Date.now() - DAYS * 864e5;
const recent = c => !c.updated_time || new Date(c.updated_time).getTime() >= since;
const tooBig = e => /reduce the amount of data/i.test(e.message || "");

async function g(path, params, token){
  const url = new URL(GRAPH + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const r = await fetch(url), j = await r.json().catch(() => ({}));
  if (!r.ok || j.error){ const e = j.error || {}, err = new Error(e.message || `HTTP ${r.status}`); err.code = e.code; throw err; }
  return j;
}

// Sigue las páginas de conversaciones (vienen de la más nueva a la más vieja) hasta pasar los 30 días.
async function recentConvs(path, params, pt){
  const out = []; let j = await g(path, params, pt);
  for (;;){
    const d = j.data || []; out.push(...d.filter(recent));
    if (out.length >= MAXC || d.some(c => !recent(c)) || !j.paging?.next || !j.paging?.cursors?.after) break;
    j = await g(path, { ...params, after: j.paging.cursors.after }, pt);
  }
  return out.slice(0, MAXC);
}

// Los mensajes de una conversación; si Instagram dice que es mucho, se piden menos y, al final, de a uno.
async function detail(c, pt){
  for (const n of [MSGS, 2]){
    try { return { ...c, ...(await g(`/${c.id}`, { fields: `participants,messages.limit(${n}){message,from,created_time}` }, pt)) }; }
    catch (e){ if (!tooBig(e)) throw e; }
  }
  const ids = await g(`/${c.id}`, { fields: "participants,messages.limit(3){id}" }, pt);
  const msgs = await Promise.all((ids.messages?.data || []).map(m => g(`/${m.id}`, { fields: "message,from,created_time" }, pt).catch(() => null)));
  return { ...c, participants: ids.participants, messages: { data: msgs.filter(Boolean) } };
}

async function pool(items, n, fn){
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length){ const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

// Conversaciones de los últimos 30 días de una red. Primero todo junto (rápido); si Meta pide traer menos
// (pasa seguido con Instagram), primero la lista liviana y después los mensajes de cada conversación.
async function convsOf(pageId, platform, pt){
  const nested = `id,updated_time,participants,messages.limit(${MSGS}){message,from,created_time${platform === "messenger" ? ",attachments" : ""}}`;
  try { return { list: await recentConvs(`/${pageId}/conversations`, { platform, fields: nested, limit: "25" }, pt), skipped: 0 }; }
  catch (e){ if (!tooBig(e)) throw e; }
  const light = await recentConvs(`/${pageId}/conversations`, { platform, fields: "id,updated_time", limit: "25" }, pt);
  let skipped = 0;
  const list = (await pool(light, 4, c => detail(c, pt).catch(() => { skipped++; return null; }))).filter(Boolean);
  return { list, skipped };
}

const short = (s, n = 400) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

function shape(c, net, meIds){
  const msgs = (c.messages?.data || []).slice(0, MSGS).reverse().map(m => ({
    t: short(m.message), me: meIds.includes(String(m.from?.id || "")), ts: m.created_time, att: !m.message, // foto, video, sticker o respuesta a una historia
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
    // Todas las marcas a la vez (si no, Vercel corta la función antes de guardar).
    await Promise.all(ORDEN.map(async (b) => {
      const p = byBrand[b]; if (!p) return;
      const pt = tokens[p.pageId], out = { page: p.page, pageId: p.pageId, handle: p.handle, convs: [], err: null };
      if (!pt){ out.err = "Sin acceso a la página (no se pudo obtener su token)"; payload[b] = out; return; }
      const errs = [], n = {};
      for (const [net, platform, me] of [["FB", "messenger", [p.pageId]], ["IG", "instagram", [p.pageId, p.igId].filter(Boolean)]]){
        if (net === "IG" && !p.igId) continue;
        try {
          const { list, skipped } = await convsOf(p.pageId, platform, pt);
          out.convs.push(...list.map(c => shape(c, net, me.map(String))));
          n[net] = list.length; if (skipped) n[net + "omitidas"] = skipped;
        } catch (e){ errs.push(`${net === "IG" ? "Instagram" : "Facebook"}: ${e.message}${e.code === 10 || e.code === 200 || e.code === 230 ? " (falta un permiso de mensajes en el token)" : ""}`); }
      }
      out.convs.sort((a, c) => String(c.ts || "").localeCompare(String(a.ts || "")));
      out.err = errs.length ? errs.join(" · ") : null;
      payload[b] = out;
      summary[b] = { ...n, sinContestar: out.convs.filter(c => !c.answered).length, err: out.err };
    }));
    if (!dry) await save("s:META_INBOX", payload);
    console.log(`[mensajes] ${JSON.stringify(summary)}${dry ? " (prueba, sin guardar)" : " guardados"}`);
    return res.status(200).json({ ok: true, dry, saved: !dry, summary });
  } catch (e){
    console.error(`[${req.url}] ERROR: ${e.message}${e.code ? ` (código ${e.code})` : ""}`);
    return res.status(500).json({ ok: false, error: e.message, hint: tokenHint(e) });
  }
};
