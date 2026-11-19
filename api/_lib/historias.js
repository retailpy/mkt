// v362 · Historias de Instagram de Superseis, Stock y Delimarket → app_state s:META_STORIES.
// Instagram da las historias (y sus números) solo mientras están publicadas: 24 horas. Por eso esta función corre varias veces por
// día (crons cada ~4 h) y guarda lo último que midió de cada una. Lo que venció antes de activarla no se puede pedir: se mide desde
// que empieza a correr. Formato (una clave por historia, así cada cambio baja solo lo que cambió):
//   "updated": "...", "since": "...",
//   "st:<id>": { b, ts, ty, v, r, rp, sh, ti, nf, nb, ne, img, ln, at, h }   ← historias del mes en curso (v364: y las del mes
//        anterior solo hasta el día 2, cuando ya se midieron todas; antes quedaban todo el mes y la fila crecía al doble)
//        v vistas · r alcance (cuentas únicas) · rp respuestas · sh compartidas · ti interacciones · nf/nb/ne toques adelante, atrás
//        y salidas · img la imagen (o la portada si es video; solo los primeros días) · ln el link de la historia en Instagram (v364)
//        · at cuándo se midió · h horas que tenía
//   "top:YYYY-MM": { marca: [ las 12 con más alcance del mes ] }   ← v364: 13 meses (el registro del mes; la imagen la guarda
//        la app en Google Drive, s:STORY_IMGS, porque la de Instagram vence a los pocos días)
//   "sum:YYYY-MM": { marca: { n, v, r, rp, sh, ne, d:{ "DD":[n, v, r] }, hr:{ "HH":[n, v] } } }   ← 13 meses
//   "err:<marca>": el error de la última vez (o se borra si anduvo)
// En esta clave, mandar una clave con null la borra (ingest_meta, migración 20261119120000).
//
// Vive en _lib (no es una función aparte: el plan de Vercel permite 12) y se llama con /api/seguidores?que=historias.
// Probar sin guardar:  /api/seguidores?que=historias&dry=1&secret=EL_CRON_SECRET
const { cronOrUser, graph, brandPages, save, readMeta, today, tokenHint } = require("./meta");

const BRANDS = ["Superseis", "Stock", "Delimarket"], TOP = 12, TOP_MONTHS = 13, SUM_MONTHS = 13, IMG_DAYS = 3, KEEP_DAYS = 2;
const pyDay = ts => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion" }).format(new Date(ts));
const pyHour = ts => new Intl.DateTimeFormat("en-GB", { timeZone: "America/Asuncion", hour: "2-digit", hour12: false }).format(new Date(ts)).slice(0, 2);
const prevOf = m => { const [y, n] = m.split("-").map(Number); return n === 1 ? `${y - 1}-12` : `${y}-${String(n - 1).padStart(2, "0")}`; };
const monthsBack = (m, k) => { let x = m; for (let i = 0; i < k; i++) x = prevOf(x); return x; };

async function metrics(id, list, extra = {}){
  try {
    const j = await graph(`/${id}/insights`, { metric: list, ...extra }), o = {};
    for (const m of j.data || []) o[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? null;
    return o;
  } catch (e){ return null; } // si Meta no da alguna métrica para esta historia, se prueba con menos
}
// Las métricas van en consultas separadas: si una falla, no se pierden las otras.
async function storyInsights(id){
  const a = (await metrics(id, "reach,replies,shares,total_interactions")) || (await metrics(id, "reach,replies")) || {};
  const v = (await metrics(id, "views")) || (await metrics(id, "impressions")) || {};
  const nav = {};
  try {
    const j = await graph(`/${id}/insights`, { metric: "navigation", breakdown: "story_navigation_action_type" });
    for (const m of j.data || []) for (const r of m.total_value?.breakdowns?.[0]?.results || []) nav[r.dimension_values?.[0]] = r.value;
  } catch (e){}
  return { v: v.views ?? v.impressions ?? null, r: a.reach ?? null, rp: a.replies ?? null, sh: a.shares ?? null, ti: a.total_interactions ?? null,
    nf: nav.tap_forward ?? null, nb: nav.tap_back ?? null, ne: nav.tap_exit ?? null };
}
async function pool(items, n, fn){
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length){ const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}
const views = x => x.v ?? x.r ?? 0, reachOf = x => x.r ?? x.v ?? 0; // v364: el top va por alcance
// Resumen de un mes por marca (con lo de cada día y cada hora, para el informe) y las 12 más vistas.
function monthStats(list){
  const s = { n: 0, v: 0, r: 0, rp: 0, sh: 0, ne: 0, d: {}, hr: {} };
  for (const x of list){
    s.n++; s.v += x.v || 0; s.r += x.r || 0; s.rp += x.rp || 0; s.sh += x.sh || 0; s.ne += x.ne || 0;
    const d = pyDay(x.ts).slice(8), h = pyHour(x.ts);
    const D = s.d[d] || (s.d[d] = [0, 0, 0]); D[0]++; D[1] += x.v || 0; D[2] += x.r || 0;
    const H = s.hr[h] || (s.hr[h] = [0, 0]); H[0]++; H[1] += views(x);
  }
  return s;
}
const topOf = list => [...list].sort((a, b) => reachOf(b) - reachOf(a) || views(b) - views(a)).slice(0, TOP).map(x => ({ id: x.id, ts: x.ts, ty: x.ty, v: x.v ?? null, r: x.r ?? null, rp: x.rp ?? null, sh: x.sh ?? null, ne: x.ne ?? null }));

const handler = async (req, res) => {
  const who = await cronOrUser(req); // el cron o el botón “Actualizar” de la app
  if (!who) return res.status(401).json({ ok: false, error: "No autorizado: falta ?secret= o es incorrecto" });
  if (!process.env.META_TOKEN){ console.error("ERROR: falta la variable META_TOKEN en Vercel"); return res.status(500).json({ ok: false, error: "Falta la variable META_TOKEN en Vercel" }); }
  const dry = req.query.dry === "1" && who === "cron";
  try {
    const [{ byBrand }, old] = await Promise.all([brandPages(), readMeta("s:META_STORIES").catch(() => null)]);
    const prev = old && typeof old === "object" ? old : {};
    const { at, month } = today(), now = Date.now();
    const out = { updated: at, ...(prev.since ? {} : { since: at }) }, summary = {};
    const all = new Map(Object.entries(prev).filter(([k, v]) => k.startsWith("st:") && v && typeof v === "object").map(([k, v]) => [k.slice(3), { ...v, id: k.slice(3) }]));
    await Promise.all(BRANDS.map(async (b) => {
      const p = byBrand[b];
      if (!p || !p.igId){ summary[b] = "sin Instagram vinculado a la página"; out["err:" + b] = summary[b]; return; }
      try {
        const j = await graph(`/${p.igId}/stories`, { fields: "id,media_type,media_url,thumbnail_url,permalink,timestamp", limit: "100" });
        const list = (j.data || []).filter(s => s && s.id && s.timestamp), ins = await pool(list, 6, s => storyInsights(s.id));
        list.forEach((s, i) => {
          const was = all.get(s.id) || {}, m = ins[i] || {}, keep = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v ?? was[k] ?? null])); // si una métrica falló esta vez, queda la anterior
          const img = (s.media_type === "VIDEO" ? s.thumbnail_url : s.media_url) || was.img || null, ln = s.permalink || was.ln || null;
          const e = { b, ts: s.timestamp, ty: s.media_type === "VIDEO" ? "Video" : "Imagen", ...keep, ...(img ? { img } : {}), ...(ln ? { ln } : {}), at, h: Math.round((now - Date.parse(s.timestamp)) / 36e5 * 10) / 10 };
          all.set(s.id, { ...e, id: s.id }); out["st:" + s.id] = e;
        });
        summary[b] = list.length; if (prev["err:" + b]) out["err:" + b] = null;
      } catch (e){
        const hint = tokenHint(e); summary[b] = "error: " + e.message; out["err:" + b] = `${e.message}${hint ? " — " + hint : ""}`.slice(0, 300);
      }
    }));
    // Resumen y top de cada mes que tiene sus historias guardadas: el mes en curso y, hasta el día 2, el anterior (las del último
    // día se terminan de medir al otro día). Después el anterior queda fijo con su resumen y su top.
    const keepFrom = pyDay(now - KEEP_DAYS * 864e5).slice(0, 7), byMonth = {};
    for (const x of all.values()){ const m = pyDay(x.ts).slice(0, 7); if (m < keepFrom) continue; ((byMonth[m] = byMonth[m] || {})[x.b] = byMonth[m][x.b] || []).push(x); }
    for (const [m, bs] of Object.entries(byMonth)){
      out["sum:" + m] = Object.fromEntries(Object.entries(bs).map(([b, l]) => [b, monthStats(l)]));
      out["top:" + m] = Object.fromEntries(Object.entries(bs).map(([b, l]) => [b, topOf(l)]));
    }
    // Limpieza: las historias de los meses ya cerrados se borran (queda su resumen y su top); la imagen, solo los primeros días.
    for (const [id, x] of all){
      const m = pyDay(x.ts).slice(0, 7);
      if (m < keepFrom){ out["st:" + id] = null; continue; }
      if (x.img && now - Date.parse(x.ts) > IMG_DAYS * 864e5 && prev["st:" + id]?.img){ const { img, id: _, ...rest } = x; out["st:" + id] = rest; }
    }
    for (const k of Object.keys(prev)){
      if (k.startsWith("top:") && k.slice(4) < monthsBack(month, TOP_MONTHS - 1)) out[k] = null;
      if (k.startsWith("sum:") && k.slice(4) < monthsBack(month, SUM_MONTHS - 1)) out[k] = null;
    }
    if (!dry) await save("s:META_STORIES", out);
    console.log(`[historias] ${JSON.stringify(summary)}${dry ? " (prueba, sin guardar)" : " guardadas"}`);
    return res.status(200).json({ ok: true, dry, saved: !dry, historias: summary, claves: Object.keys(out).length });
  } catch (e){
    console.error(`[${req.url}] ERROR: ${e.message}${e.code ? ` (código ${e.code})` : ""}${tokenHint(e) ? " → " + tokenHint(e) : ""}`);
    return res.status(500).json({ ok: false, error: e.message, hint: tokenHint(e) });
  }
};
module.exports = handler;
module.exports._test = { monthStats, topOf, storyInsights, pyDay, pyHour };
