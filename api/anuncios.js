// Anuncios de Pauta Meta Ads: los que se pautaron en el mes (tuvieron impresiones) y los que están corriendo ahora de
// verdad (conjunto de anuncios activo, ya empezado y sin terminar), con imagen, copy, campaña, fechas de inicio y fin
// y números del mes. Guarda en app_state → s:META_CREATIVES (v 2):
//   { "updated": "...", "v": 2, "errors": { "Superseis": "motivo" },
//     "AAAA-MM": { "Superseis": [ { id, name, title, body, img, big, status, camp, campId, obj, start, end,
//                                    impressions, reach, clicks, link, convs, lpv, eng, spend } ] }, ... }
//   status: "ACTIVE" (en el aire ahora) · "SCHEDULED" (programado, todavía no empezó) · "PAUSED" (pausado o frenado
//   antes de su fin) · "ENDED" (terminó). Ojo: Meta deja “ACTIVE” los anuncios de conjuntos que ya terminaron hace meses;
//   por eso lo que corre ahora se decide por las fechas del conjunto, no por ese estado.
// Trae el mes actual y el mes pasado (para cerrar sus números y renovar las imágenes, que Meta vence a los pocos días).
// Lo usa Pauta Meta Ads (Corriendo ahora y Pautas del mes). El token necesita el permiso ads_read sobre las cuentas.
//
// Probar sin guardar:  /api/anuncios?dry=1&secret=EL_CRON_SECRET
const { cronOrUser, graph, save, today, tokenHint } = require("./_lib/meta");

// Cuenta publicitaria de cada marca (son identificadores, no claves).
const CUENTAS = {
  "Superseis": "706143858333408",
  "Stock": "1473310073555714",
  "Delimarket": "820988930160204",
  "Bianca": "945043140759135",
  "Dayo": "521539843869936",
  "Clasipar": "1972967459807581",
  "PediWOW": "465358739590522",
};

const MAX_PER_BRAND = 60; // tope de anuncios por marca y por mes (primero los que corren ahora, después los de más gasto)
const DETAIL = "name,created_time,effective_status,adset{start_time,end_time},campaign{name,objective,stop_time}," +
  "creative.thumbnail_width(320).thumbnail_height(320){title,body,thumbnail_url,image_url,object_story_spec}";
const INSIGHTS = "ad_id,ad_name,campaign_id,campaign_name,impressions,reach,clicks,inline_link_clicks,spend,actions";
const OBJ = { OUTCOME_AWARENESS: "Alcance", OUTCOME_ENGAGEMENT: "Interacción", OUTCOME_TRAFFIC: "Tráfico", OUTCOME_SALES: "Ventas",
  OUTCOME_LEADS: "Mensajes", OUTCOME_APP_PROMOTION: "App", REACH: "Alcance", BRAND_AWARENESS: "Alcance", POST_ENGAGEMENT: "Interacción",
  LINK_CLICKS: "Tráfico", MESSAGES: "Mensajes", CONVERSIONS: "Ventas", VIDEO_VIEWS: "Interacción" };

// "2026-09-22T15:49:07-0300" → milisegundos (con los dos puntos en la zona para que cualquier motor lo lea).
const ms = s => s ? Date.parse(String(s).replace(/([+-]\d\d)(\d\d)$/, "$1:$2")) : NaN;
const day = s => s ? String(s).slice(0, 10) : null; // fecha en la zona de la cuenta (Paraguay)
const act = (r, type) => +((r.actions || []).find(a => a.action_type === type)?.value || 0);

async function pool(items, n, fn){
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length){ const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

// Sigue las páginas de una lista de Meta (hasta `pages` veces).
async function all(path, params, pages = 4){
  const out = []; let j = await graph(path, params);
  for (let n = 0; n < pages; n++){
    out.push(...(j.data || []));
    if (!j.paging?.next || !j.paging?.cursors?.after) break;
    j = await graph(path, { ...params, after: j.paging.cursors.after });
  }
  return out;
}

// Lo que corre ahora de verdad: conjuntos activos que ya empezaron y no terminaron (y los programados, que empiezan después).
async function runningAds(acc, now){
  const sets = await all(`/act_${acc}/adsets`, { fields: "id,start_time,end_time,campaign{stop_time}", effective_status: JSON.stringify(["ACTIVE"]), limit: "200" });
  const live = new Set(), soon = new Set();
  const pick = sets.filter(s => { const end = ms(s.end_time || s.campaign?.stop_time); return !(end <= now); });
  await pool(pick, 4, async s => {
    const ads = await all(`/${s.id}/ads`, { fields: "id", effective_status: JSON.stringify(["ACTIVE"]), limit: "100" }, 2);
    ads.forEach(a => (ms(s.start_time) > now ? soon : live).add(a.id));
  });
  return { live, soon };
}

// Imagen, copy, campaña y fechas de cada anuncio, en grupos chicos (si Meta pide menos datos, se piden de a uno).
async function details(ids){
  const out = {};
  for (let i = 0; i < ids.length; i += 20){
    const chunk = ids.slice(i, i + 20);
    try { Object.assign(out, await graph("/", { ids: chunk.join(","), fields: DETAIL })); }
    catch (e){ await pool(chunk, 5, async id => { try { out[id] = await graph(`/${id}`, { fields: DETAIL }); } catch {} }); }
  }
  return out;
}

// Los anuncios de un mes de una marca: los que tuvieron impresiones (y, en el mes actual, los que corren o están programados).
async function brandMonth(acc, preset, run, now){
  const rows = (await all(`/act_${acc}/insights`, { level: "ad", date_preset: preset, fields: INSIGHTS, limit: "500" }, 3)).filter(r => +r.impressions > 0);
  const metr = new Map(rows.map(r => [r.ad_id, r]));
  const order = id => run && run.live.has(id) ? 2 : run && run.soon.has(id) ? 1 : 0;
  const ids = [...new Set([...rows.map(r => r.ad_id), ...(run ? [...run.live, ...run.soon] : [])])]
    .sort((x, y) => order(y) - order(x) || (+(metr.get(y)?.spend) || 0) - (+(metr.get(x)?.spend) || 0)).slice(0, MAX_PER_BRAND);
  const det = await details(ids);
  return ids.map(id => {
    const a = det[id] || {}, c = a.creative || {}, ld = c.object_story_spec?.link_data || {}, vd = c.object_story_spec?.video_data || {}, r = metr.get(id) || {};
    // Inicio: el del conjunto, o la creación del anuncio si se sumó después (nunca después del fin).
    const endRaw = a.adset?.end_time || a.campaign?.stop_time || null;
    const startRaw = a.created_time && ms(a.created_time) > ms(a.adset?.start_time) && !(ms(a.created_time) >= ms(endRaw)) ? a.created_time : a.adset?.start_time || a.created_time;
    const status = order(id) === 2 ? "ACTIVE" : order(id) === 1 ? "SCHEDULED" : (ms(endRaw) <= now ? "ENDED" : /PAUSED|DISAPPROVED|WITH_ISSUES|PENDING/.test(a.effective_status || "") ? "PAUSED" : "ENDED");
    const img = c.thumbnail_url || c.image_url || ld.picture || vd.image_url || null, big = c.image_url || ld.picture || vd.image_url || null;
    return { id, name: a.name || r.ad_name || "",
      title: c.title || ld.name || vd.title || "",
      body: String(c.body || ld.message || vd.message || "").slice(0, 600),
      img, big: big && big !== img ? big : null, status,
      camp: a.campaign?.name || r.campaign_name || "", campId: r.campaign_id || a.campaign?.id || null, obj: OBJ[a.campaign?.objective] || "",
      start: day(startRaw), end: day(endRaw),
      impressions: +r.impressions || 0, reach: +r.reach || 0, clicks: +r.clicks || 0, link: +r.inline_link_clicks || 0,
      convs: act(r, "onsite_conversion.messaging_conversation_started_7d"), lpv: act(r, "landing_page_view"), eng: act(r, "post_engagement"),
      spend: +r.spend || 0 };
  });
}

const prevOf = m => { const [y, n] = m.split("-").map(Number); return n === 1 ? `${y - 1}-12` : `${y}-${String(n - 1).padStart(2, "0")}`; };

module.exports = async (req, res) => {
  const who = await cronOrUser(req); // el cron o el botón “Actualizar” de la app (Admin total, Admin o CM)
  if (!who) return res.status(401).json({ ok: false, error: "No autorizado: falta ?secret= o es incorrecto" });
  if (!process.env.META_TOKEN){ console.error("ERROR: falta la variable META_TOKEN en Vercel"); return res.status(500).json({ ok: false, error: "Falta la variable META_TOKEN en Vercel" }); }
  const dry = req.query.dry === "1" && who === "cron";
  const { month, at } = today(), prev = prevOf(month), now = Date.now();
  const out = {}, outPrev = {}, errors = {};
  let prevOk = true;
  // Todas las marcas a la vez (cada una en lo suyo): si una falla, las demás se guardan igual y el motivo queda anotado.
  await Promise.all(Object.entries(CUENTAS).map(async ([brand, acc]) => {
    const notes = [];
    try {
      let run = null;
      try { run = await runningAds(acc, now); } catch (e){ notes.push("en el aire: " + e.message); }
      out[brand] = await brandMonth(acc, "this_month", run || { live: new Set(), soon: new Set() }, now);
      if (notes.length) errors[brand] = notes.join(" · ");
    } catch (e){
      errors[brand] = [...notes, e.message].join(" · ") + (tokenHint(e) ? " → " + tokenHint(e) : "");
      console.error(`[anuncios] ${brand} ERROR: ${errors[brand]}`);
    }
    try { outPrev[brand] = await brandMonth(acc, "last_month", null, now); }
    catch (e){ prevOk = false; console.error(`[anuncios] ${brand} mes pasado ERROR: ${e.message}`); }
  }));
  const payload = { updated: at, v: 2, errors, [month]: out };
  if (prevOk) payload[prev] = outPrev; // el mes pasado solo se reemplaza si se pudo leer entero
  try {
    if (!dry && Object.keys(out).length) await save("s:META_CREATIVES", payload);
  } catch (e){
    console.error(`[anuncios] ERROR al guardar: ${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
  const counts = Object.fromEntries(Object.entries(out).map(([b, l]) => [b, { total: l.length, enElAire: l.filter(x => x.status === "ACTIVE").length, programados: l.filter(x => x.status === "SCHEDULED").length, conImagen: l.filter(x => x.img).length, gasto: Math.round(l.reduce((s, x) => s + x.spend, 0) * 100) / 100 }]));
  console.log(`[anuncios] ${month}: ${JSON.stringify(counts)} errores: ${JSON.stringify(errors)}${prevOk ? "" : " (mes pasado sin guardar)"}${dry ? " (prueba, sin guardar)" : ""}`);
  return res.status(Object.keys(out).length ? 200 : 500).json({ ok: Object.keys(out).length > 0, dry, month, ads: counts, prevSaved: prevOk, errors });
};
