// Mensajes directos reales de cada marca: Instagram (DM) y Facebook (Messenger). Guarda en app_state → s:META_INBOX:
//   { "updated": "...", "Stock": { "page": "...", "pageId": "...", "handle": "@...", "err": null,
//       "convs": [ { id, net:"IG"|"FB", who, ts, answered, waitSince, msgs:[ { t, me, ts, att } ] } ],
//       "hist": [ { id, conv, net, who, ts, t, ctx } ],   ← mensajes con queja del mes actual y el anterior (Reclamos del mes)
//       "diag": { "IG": { lista, detalle, total, n, omitidas, cortado } } }, ... }   ← diag: cuántos segundos tardó Meta y cuántas llegaron
// Lo usa la sección “Mensajes” del Panel de Trabajo de CM: quién escribió y si ya se contestó (solo lectura:
// para contestar se usa Meta Business Suite). La leen solo Admin total, Admin y CM (lo controla la base).
//
// La llaman: el cron diario de Vercel y el botón “Actualizar” de la app (con la sesión de Admin o CM).
// Cada marca se lee en su propia llamada (/api/mensajes?brand=Superseis), todas a la vez: así cada una tiene el minuto
// entero para Instagram, que Meta tarda mucho en dar. Cada una guarda solo su marca (no pisa a las demás).
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
// REQ_MS (la primera página de la lista de Instagram, hasta LIST_IG_MS: Meta suele tardar más de 12 s en darla);
// pasados STOP no se piden más cosas; y a los SAVE se guarda lo que haya: lo que ya llegó y, lo que no se llegó a
// leer, como estaba la vez anterior. STOP + REQ_MS < SAVE: lo último que se pidió llega antes de guardar.
// Con una marca por llamada: la lista de Instagram tiene hasta LIST_IG_MS por intento.
const REQ_MS = 12000, LIST_IG_MS = 40000, STOP = 46000, SAVE = 52000;
// Cada llamada lleva su propio reloj (Vercel puede atender varias marcas en la misma instancia a la vez).
const { AsyncLocalStorage } = require("async_hooks");
const clock = new AsyncLocalStorage();
const since = () => Date.now() - (clock.getStore()?.t0 || Date.now());
const late = () => since() > STOP;
const lateErr = msg => Object.assign(new Error(msg), { late: true });

async function g(path, params, token, ms = REQ_MS){
  if (late()) throw lateErr("se terminó el tiempo");
  const url = new URL(GRAPH + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal }), j = await r.json().catch(() => ({}));
    if (!r.ok || j.error){ const e = j.error || {}, err = new Error(e.message || `HTTP ${r.status}`); err.code = e.code; throw err; }
    return j;
  } catch (e){ throw e.name === "AbortError" ? lateErr("Meta tardó demasiado en responder") : e; }
  finally { clearTimeout(timer); }
}

// Sigue las páginas de conversaciones (vienen de la más nueva a la más vieja) hasta pasar los 30 días.
// Si se acaba el tiempo a mitad de camino, devuelve lo que ya leyó (partial). first: otro tope y tiempo para la primera página.
// pagesUntil: no se piden más páginas pasados esos ms (en Instagram, primero los mensajes de lo que ya llegó).
async function recentConvs(path, params, pt, first = {}){
  const out = []; let j = await g(path, { ...params, limit: first.limit || params.limit }, pt, first.ms), partial = false;
  for (;;){
    const d = j.data || []; out.push(...d.filter(recent));
    if (out.length >= MAXC || d.some(c => !recent(c)) || !j.paging?.next || !j.paging?.cursors?.after) break;
    if (first.pagesUntil && since() > first.pagesUntil){ partial = true; break; }
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
// Meta tarda mucho en dar la lista de Instagram: la primera página es de 5 y tiene hasta LIST_IG_MS; las siguientes, de a 10.
// d: tiempos (segundos) para el diagnóstico; got: las conversaciones que ya llegaron (si se acaba el tiempo, se guardan igual).
const secs = t => +((Date.now() - t) / 1000).toFixed(1);
async function convsOf(pageId, platform, pt, d = {}, got = []){
  const path = `/${pageId}/conversations`;
  if (platform === "messenger"){
    try { return await recentConvs(path, { platform, fields: `id,updated_time,participants,messages.limit(${MSGS}){message,from,created_time,attachments}`, limit: "25" }, pt); }
    catch (e){ if (!tooBig(e)) throw e; }
  }
  // d.intentos queda en el diagnóstico: qué se pidió, cuánto tardó y qué contestó Meta.
  const t1 = Date.now(), left = () => STOP - since(); let light = null, lastErr = null; d.intentos = [];
  const att = (fields, first, ms) => { const tt = Date.now();
    return recentConvs(path, { platform, fields, limit: "10" }, pt, { limit: first, ms, pagesUntil: platform === "instagram" ? 25000 : 0 })
      .then(r => { d.intentos.push(`${fields} x${first}: ${r.list.length} en ${secs(tt)} s`); return r; },
            e => { d.intentos.push(`${fields} x${first}: ${tooBig(e) ? "Meta pidió menos datos" : e.message} (${secs(tt)} s)`); throw e; }); };
  if (platform === "instagram"){
    // Instagram: Meta tarda mucho y a veces pide traer menos. Se piden a la vez la lista normal y una más liviana
    // (solo el id, de a 3) y se usa la que llegue primero; si las dos piden menos datos, de a 1.
    try { light = await Promise.any([att("id,updated_time", "5", Math.min(LIST_IG_MS, left())), att("id", "3", Math.min(LIST_IG_MS, left()))]); }
    catch (agg){ const errs = agg.errors || [agg]; lastErr = errs.find(e => !e.late) || errs[0];
      if (errs.some(tooBig) && left() > 6000) try { light = await att("id", "1", Math.min(LIST_IG_MS, left())); } catch (e){ lastErr = e; } }
  } else {
    try { light = await att("id,updated_time", "5", REQ_MS); }
    catch (e){ lastErr = e; if (tooBig(e)) try { light = await att("id,updated_time", "3", REQ_MS); } catch (e2){ lastErr = e2; } }
  }
  d.lista = secs(t1);
  if (!light) throw lastErr || lateErr("Meta tardó demasiado en responder");
  let skipped = 0; const t2 = Date.now();
  const list = (await pool(light.list, 6, async c => {
    if (late()){ skipped++; return null; }
    try { const x = await detail(c, pt); got.push(x); return x; } catch { skipped++; return null; }
  })).filter(Boolean);
  d.detalle = secs(t2);
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
// Reclamos del mes: los mensajes de clientes con palabras de queja se guardan aparte (hist) para que la app arme el
// resumen del mes entero, aunque la conversación ya tenga más mensajes nuevos o tenga más de 30 días.
// Quedan los del mes actual y el anterior (la app muestra cada mes).
const fold = t => String(t || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
const QUEJA = /reclam|queja|quejar|pesim|malisim|mala atencion|mal atendid|atendieron mal|maltrat|groser|falta de respeto|mal educad|vencid|podrid|mal estado|cucarach|intoxic|cobr\w* (de mas|mal|doble|dos veces)|me cobraron|precio (distinto|diferente|incorrecto|equivocado)|no respet\w* (el |la |los |las )?(precio|oferta|descuento)|estafa|enganos?\b|devolucion|reembols|no me (devolvieron|atendieron|quisieron|dejaron)|horrible|verguenza|indignad|decepcion|nunca mas|sucio|suciedad|defensa del consumidor|denuncia|me cobran|te cobra|cobran mal|en caja me|filas? (eran |son |muy |bastante )*largas|mas cajer|pocas cajas|pocos cajer|destruid|descompon|aplastad|danad|revisar bien|circuito cerrado|extraviad|robaron|no (da|das) gusto|no funcion|lastimosamente/;
const pyMonth = ts => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion" }).format(new Date(ts)).slice(0, 7);
function quejas(prevHist, convs){
  const now = new Date(), cur = pyMonth(now), d = new Date(now); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
  const keep = [pyMonth(d), cur], map = new Map();
  (Array.isArray(prevHist) ? prevHist : []).forEach(h => { if (h?.id && keep.includes(pyMonth(h.ts))) map.set(h.id, h); });
  for (const c of convs){
    const own = (c.msgs || []).filter(m => !m.me && m.t && m.ts), ctx = short(own.map(m => m.t).join(" · "), 600);
    for (const m of own){
      if (!QUEJA.test(fold(m.t)) || !keep.includes(pyMonth(m.ts))) continue;
      const id = c.id + "|" + m.ts, o = map.get(id);
      map.set(id, { id, conv: c.id, net: c.net, who: c.who, ts: m.ts, t: m.t, ctx: o && o.ctx.length > ctx.length ? o.ctx : ctx });
    }
  }
  return [...map.values()].sort((a, b) => String(b.ts).localeCompare(String(a.ts))).slice(0, 400);
}
const meOf = (p, net) => (net === "IG" ? [p.pageId, p.igId] : [p.pageId]).map(String); // los id de la marca en esa red
const fresh = c => c?.ts && Date.now() - new Date(c.ts).getTime() <= DAYS * 864e5;

// Sin ?brand: se llama a esta misma función una vez por marca, todas a la vez (cada una con su minuto), con la
// misma autorización (la del cron o la sesión de quien tocó “Actualizar”), y se junta el resumen.
async function fanOut(req, res, dry){
  const { byBrand } = await brandPages();
  const host = req.headers["x-forwarded-host"] || req.headers.host, auth = req.headers.authorization || "";
  const extra = new URLSearchParams(); if (req.query.secret) extra.set("secret", String(req.query.secret)); if (dry) extra.set("dry", "1");
  const out = await Promise.all(ORDEN.filter(b => byBrand[b]).map(async b => {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 58000);
    try {
      const r = await fetch(`https://${host}/api/mensajes?brand=${encodeURIComponent(b)}${extra.toString() ? "&" + extra : ""}`, { headers: auth ? { authorization: auth } : {}, signal: ctl.signal });
      const j = await r.json().catch(() => ({}));
      return [b, r.ok && j.ok, r.ok && j.ok ? j.summary?.[b] || {} : { err: j.error || `HTTP ${r.status}` }, j.ok === undefined || r.status === 401 || r.status === 403];
    } catch (e){ return [b, false, { err: e.name === "AbortError" ? "no contestó a tiempo" : e.message }, e.name !== "AbortError"]; }
    finally { clearTimeout(timer); }
  }));
  const summary = Object.fromEntries(out.map(([b, , s]) => [b, s])), ok = out.some(([, k]) => k);
  // Si ninguna llamada por marca pudo ni empezar (por ejemplo, Vercel no deja que la función se llame a sí misma),
  // se leen todas las marcas acá mismo, como antes.
  if (!ok && out.length && out.every(([, , , blocked]) => blocked)){ console.log(`[mensajes] sin llamadas por marca (${out[0][2].err}): se leen todas juntas`); return false; }
  console.log(`[mensajes] ${JSON.stringify(summary)}`);
  return res.status(ok ? 200 : 500).json(ok ? { ok, dry, summary } : { ok, error: out[0]?.[2]?.err || "No se pudo leer ninguna marca", summary });
}

module.exports = (req, res) => clock.run({ t0: Date.now() }, () => handle(req, res));
async function handle(req, res){
  const who = await cronOrUser(req), cron = who === "cron";
  if (!who) return res.status(401).json({ ok: false, error: "No autorizado" });
  if (!process.env.META_TOKEN) return res.status(500).json({ ok: false, error: "Falta la variable META_TOKEN en Vercel" });
  const dry = req.query.dry === "1" && cron, only = String(req.query.brand || "");
  try {
    if (!only && await fanOut(req, res, dry) !== false) return;
    if (only && !ORDEN.includes(only)) return res.status(400).json({ ok: false, error: "Marca desconocida" });
    const brands = only ? [only] : ORDEN;
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
    const work = Promise.all(brands.map(async (b) => {
      const p = byBrand[b]; if (!p) return;
      const s = st[b] = { p, nets: p.igId ? ["FB", "IG"] : ["FB"], res: {}, err: null, diag: {}, got: {} };
      const pt = tokens[p.pageId];
      if (!pt){ s.err = "Sin acceso a la página (no se pudo obtener su token)"; return; }
      await Promise.all(s.nets.map(async net => {
        const d = s.diag[net] = {}, t1 = Date.now();
        try { const r = await convsOf(p.pageId, net === "IG" ? "instagram" : "messenger", pt, d, s.got[net] = []); s.res[net] = { ...r, list: r.list.map(c => shape(c, net, meOf(p, net))).filter(c => !c.ts || fresh(c)) }; d.n = s.res[net].list.length; if (r.skipped) d.omitidas = r.skipped; }
        catch (e){ s.res[net] = { err: `${e.message}${e.code === 10 || e.code === 200 || e.code === 230 ? " (falta un permiso de mensajes en el token)" : ""}` }; }
        d.total = secs(t1);
      }));
    }));
    let timer;
    const intime = await Promise.race([work.then(() => true), new Promise(r => { timer = setTimeout(() => r(false), Math.max(1000, SAVE - since())); })]);
    clearTimeout(timer);
    // Se arma lo que se guarda con lo que haya llegado hasta ahora.
    const payload = { updated: new Date().toISOString() }, summary = {};
    for (const b of brands){
      const s = st[b]; if (!s) continue;
      const convs = [], errs = s.err ? [s.err] : [], n = {};
      for (const net of s.nets){
        const r = s.res[net];
        if (!r){ // no terminó a tiempo: lo que ya llegó, y lo demás como estaba la vez anterior
          const got = (s.got[net] || []).map(c => shape(c, net, meOf(s.p, net))), ids = new Set(got.map(c => c.id));
          convs.push(...got, ...old(b, net).filter(c => !ids.has(c.id)));
          if (s.diag[net]) s.diag[net].cortado = true;
          if (got.length) n[net] = got.length;
          if (!s.err) errs.push(`${NET[net]}: no terminó a tiempo (${got.length ? `llegaron ${got.length}; ` : ""}las demás quedan como la vez anterior)`);
          continue;
        }
        if (r.err){ convs.push(...old(b, net)); errs.push(`${NET[net]}: ${r.err}`); continue; }
        const ids = new Set(r.list.map(c => c.id));
        convs.push(...r.list, ...(r.partial ? old(b, net).filter(c => !ids.has(c.id)) : [])); // lo que faltó leer, como estaba
        n[net] = r.list.length; if (r.skipped) n[net + "omitidas"] = r.skipped;
      }
      convs.sort((a, c) => String(c.ts || "").localeCompare(String(a.ts || "")));
      payload[b] = { page: s.p.page, pageId: s.p.pageId, handle: s.p.handle, convs, hist: quejas(prev[b]?.hist, convs), err: errs.length ? errs.join(" · ") : null, diag: s.diag };
      summary[b] = { ...n, sinContestar: convs.filter(c => !c.answered).length, err: payload[b].err };
    }
    if (!dry) await save("s:META_INBOX", payload);
    console.log(`[mensajes] ${JSON.stringify(summary)}${intime ? "" : " (se cortó por tiempo: se guardó lo que había)"}${dry ? " (prueba, sin guardar)" : " guardados"}`);
    return res.status(200).json({ ok: true, dry, saved: !dry, complete: intime, summary });
  } catch (e){
    console.error(`[${req.url}] ERROR: ${e.message}${e.code ? ` (código ${e.code})` : ""}`);
    return res.status(500).json({ ok: false, error: e.message, hint: tokenHint(e) });
  }
}
