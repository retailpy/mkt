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
const { ORDEN, cronOrUser, brandPages, save, readMeta, tokenHint } = require("./_lib/meta");

const GRAPH = "https://graph.facebook.com/v21.0";
const DAYS = 30;  // solo las conversaciones con movimiento en los últimos 30 días
const MAXC = 60;  // tope de conversaciones por red y por marca
const MSGS = 5;   // últimos mensajes de cada conversación
const recent = c => !c.updated_time || Date.now() - new Date(c.updated_time).getTime() <= DAYS * 864e5;
const tooBig = e => /reduce the amount of data/i.test(e.message || "");
// Vercel corta la función a los 60 s y entonces no se guarda nada. Por eso: cada consulta a Meta espera como mucho
// REQ_MS; pasados STOP no se piden más cosas; y a los SAVE se guarda lo que haya (lo que no se llegó a leer queda
// como estaba la vez anterior).
const REQ_MS = 12000, STOP = 34000, SAVE = 46000;
let t0 = 0;
const late = () => Date.now() - t0 > STOP;
const lateErr = msg => Object.assign(new Error(msg), { late: true });

async function g(path, params, token){
  if (late()) throw lateErr("se terminó el tiempo");
  const url = new URL(GRAPH + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), REQ_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal }), j = await r.json().catch(() => ({}));
    if (!r.ok || j.error){ const e = j.error || {}, err = new Error(e.message || `HTTP ${r.status}`); err.code = e.code; throw err; }
    return j;
  } catch (e){ throw e.name === "AbortError" ? lateErr("Meta tardó demasiado en responder") : e; }
  finally { clearTimeout(timer); }
}

// Sigue las páginas de conversaciones (vienen de la más nueva a la más vieja) hasta pasar los 30 días.
// Si se acaba el tiempo a mitad de camino, devuelve lo que ya leyó (partial).
async function recentConvs(path, params, pt){
  const out = []; let j = await g(path, params, pt), partial = false;
  for (;;){
    const d = j.data || []; out.push(...d.filter(recent));
    if (out.length >= MAXC || d.some(c => !recent(c)) || !j.paging?.next || !j.paging?.cursors?.after) break;
    try { j = await g(path, { ...params, after: j.paging.cursors.after }, pt); }
    catch (e){ if (!e.late) throw e; partial = true; break; }
  }
  return { list: out.slice(0, MAXC), partial };
}

// Los últimos mensajes de una conversación. Si Instagram dice que es mucho (pasa cuando alguien compartió una historia
// o un reel), se piden solo los id y después cada mensaje por separado.
async function detail(c, pt){
  try { return { ...c, ...(await g(`/${c.id}`, { fields: `participants,messages.limit(${MSGS}){message,from,created_time}` }, pt)) }; }
  catch (e){ if (!tooBig(e)) throw e; }
  const ids = await g(`/${c.id}`, { fields: `participants,messages.limit(${MSGS}){id}` }, pt);
  const msgs = await Promise.all((ids.messages?.data || []).map(m => g(`/${m.id}`, { fields: "message,from,created_time" }, pt)
    .catch(e => e.late ? null : g(`/${m.id}`, { fields: "from,created_time" }, pt).catch(() => null)))); // sin texto: foto, video o adjunto
  return { ...c, participants: ids.participants, messages: { data: msgs.filter(Boolean) } };
}

async function pool(items, n, fn){
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length){ const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

// Conversaciones de los últimos 30 días de una red.
// Facebook: todo junto en una consulta (rápido). Instagram casi siempre pide traer menos datos por consulta, así que
// va directo a la lista liviana (solo id y fecha) y después los mensajes de cada conversación, de a varias a la vez.
async function convsOf(pageId, platform, pt){
  const path = `/${pageId}/conversations`;
  if (platform === "messenger"){
    try { return await recentConvs(path, { platform, fields: `id,updated_time,participants,messages.limit(${MSGS}){message,from,created_time,attachments}`, limit: "25" }, pt); }
    catch (e){ if (!tooBig(e)) throw e; }
  }
  let light;
  try { light = await recentConvs(path, { platform, fields: "id,updated_time", limit: "25" }, pt); }
  catch (e){ if (!tooBig(e)) throw e; light = await recentConvs(path, { platform, fields: "id,updated_time", limit: "10" }, pt); }
  let skipped = 0;
  const list = (await pool(light.list, 6, c => late() ? (skipped++, null) : detail(c, pt).catch(() => { skipped++; return null; }))).filter(Boolean);
  return { list, partial: light.partial || skipped > 0, skipped };
}

const short = (s, n = 400) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

function shape(c, net, meIds){
  const msgs = (c.messages?.data || []).slice(0, MSGS).reverse().map(m => ({
    t: short(m.message), me: meIds.includes(String(m.from?.id || "")), ts: m.created_time, att: !m.message, // foto, video, sticker o respuesta a una historia
  }));
  const other = (c.participants?.data || []).find(p => !meIds.includes(String(p.id))) || {};
  const last = msgs[msgs.length - 1];
  // Contestado: la marca ya respondió algo en la conversación (un “gracias” del cliente después no la vuelve a abrir).
  const answered = msgs.some(m => m.me);
  return { id: c.id, net, who: other.username ? "@" + other.username : other.name || "Cliente", ts: c.updated_time || last?.ts || null,
    answered, waitSince: answered ? null : msgs[0]?.ts || null, msgs };
}

const NET = { FB: "Facebook", IG: "Instagram" };
const fresh = c => c?.ts && Date.now() - new Date(c.ts).getTime() <= DAYS * 864e5;

module.exports = async (req, res) => {
  t0 = Date.now();
  const who = await cronOrUser(req), cron = who === "cron";
  if (!who) return res.status(401).json({ ok: false, error: "No autorizado" });
  if (!process.env.META_TOKEN) return res.status(500).json({ ok: false, error: "Falta la variable META_TOKEN en Vercel" });
  const dry = req.query.dry === "1" && cron;
  try {
    // Lo guardado la vez anterior: si una red no se llega a leer, quedan esas conversaciones (no se pierde nada).
    const [{ byBrand }, before] = await Promise.all([brandPages(), readMeta("s:META_INBOX").catch(() => null)]);
    const prev = before && typeof before === "object" ? before : {};
    const old = (b, net) => (prev[b]?.convs || []).filter(c => c.net === net && fresh(c));
    // Token de cada página (con el token del usuario del sistema se obtiene el de cada página que administra).
    const tokens = {};
    let j = await g("/me/accounts", { fields: "id,access_token", limit: "100" }, process.env.META_TOKEN);
    for (;;){ (j.data || []).forEach(p => { tokens[p.id] = p.access_token; }); if (!j.paging?.next) break; j = await fetch(j.paging.next).then(r => r.json()); if (j.error) break; }
    // Cada marca y cada red a la vez; el resultado de cada una se anota apenas llega.
    const st = {};
    const work = Promise.all(ORDEN.map(async (b) => {
      const p = byBrand[b]; if (!p) return;
      const s = st[b] = { p, nets: p.igId ? ["FB", "IG"] : ["FB"], res: {}, err: null };
      const pt = tokens[p.pageId];
      if (!pt){ s.err = "Sin acceso a la página (no se pudo obtener su token)"; return; }
      await Promise.all(s.nets.map(async net => {
        const me = (net === "IG" ? [p.pageId, p.igId] : [p.pageId]).map(String);
        try { const r = await convsOf(p.pageId, net === "IG" ? "instagram" : "messenger", pt); s.res[net] = { ...r, list: r.list.map(c => shape(c, net, me)) }; }
        catch (e){ s.res[net] = { err: `${e.message}${e.code === 10 || e.code === 200 || e.code === 230 ? " (falta un permiso de mensajes en el token)" : ""}` }; }
      }));
    }));
    let timer;
    const intime = await Promise.race([work.then(() => true), new Promise(r => { timer = setTimeout(() => r(false), Math.max(1000, SAVE - (Date.now() - t0))); })]);
    clearTimeout(timer);
    // Se arma lo que se guarda con lo que haya llegado hasta ahora.
    const payload = { updated: new Date().toISOString() }, summary = {};
    for (const b of ORDEN){
      const s = st[b]; if (!s) continue;
      const convs = [], errs = s.err ? [s.err] : [], n = {};
      for (const net of s.nets){
        const r = s.res[net];
        if (!r){ convs.push(...old(b, net)); if (!s.err) errs.push(`${NET[net]}: no terminó a tiempo (quedan las de la vez anterior)`); continue; }
        if (r.err){ convs.push(...old(b, net)); errs.push(`${NET[net]}: ${r.err}`); continue; }
        const ids = new Set(r.list.map(c => c.id));
        convs.push(...r.list, ...(r.partial ? old(b, net).filter(c => !ids.has(c.id)) : [])); // lo que faltó leer, como estaba
        n[net] = r.list.length; if (r.skipped) n[net + "omitidas"] = r.skipped;
      }
      convs.sort((a, c) => String(c.ts || "").localeCompare(String(a.ts || "")));
      payload[b] = { page: s.p.page, pageId: s.p.pageId, handle: s.p.handle, convs, err: errs.length ? errs.join(" · ") : null };
      summary[b] = { ...n, sinContestar: convs.filter(c => !c.answered).length, err: payload[b].err };
    }
    if (!dry) await save("s:META_INBOX", payload);
    console.log(`[mensajes] ${JSON.stringify(summary)}${intime ? "" : " (se cortó por tiempo: se guardó lo que había)"}${dry ? " (prueba, sin guardar)" : " guardados"}`);
    return res.status(200).json({ ok: true, dry, saved: !dry, complete: intime, summary });
  } catch (e){
    console.error(`[${req.url}] ERROR: ${e.message}${e.code ? ` (código ${e.code})` : ""}`);
    return res.status(500).json({ ok: false, error: e.message, hint: tokenHint(e) });
  }
};
