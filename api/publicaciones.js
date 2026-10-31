// Publicaciones de Instagram de cada marca (las mismas cuentas que Seguidores). Guarda en app_state → s:META_POSTS:
//   { "updated": "...",
//     "Stock": { "handle": "@...", "posts": [ { id, type, cap, img, link, ts, likes, comments, reach, saved, shares, views } ] },   ← las últimas 30
//     "m:2026-09": { "Stock": [ ... ], ... }, "m:2026-10": { ... }, ...                                                      ← archivo de cada mes
//     "track": { since, live: { id: { b, ts, cap, pts:[[horas, alcance], …] } }, done: { id: { b, ts, cap, f, d1, d2, d3, d7, t90 } } } }
//                                                          ← v314: vida útil (alcance acumulado de cada publicación en sus primeros 14 días)
// El archivo de cada mes guarda todas las publicaciones del mes (v311: antes solo las últimas 9 con imagen y las 15 de más alcance; el
// Análisis y recomendaciones y el Informe Comercial necesitan todas), con un tope por marca (KEEP_MONTH). Queda guardado aunque pasen los
// meses; las imágenes de los meses viejos se renuevan acá porque las de Instagram vencen a los pocos días (por eso corre todos los días).
// v316: el tope sube a 250 por marca y por mes (y a 400 lo que se trae): con 80, Superseis perdía los primeros días del mes.
//
// Probar sin guardar:  /api/publicaciones?dry=1&secret=EL_CRON_SECRET
const { ORDEN, cronOrUser, graph, brandPages, save, readMeta, today, tokenHint } = require("./_lib/meta");

const FIELDS = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";
const FIRST_MONTH = "2026-08"; // la app arranca en septiembre 2026; agosto se trae una vez para TV Impacto (el mes en curso y los dos anteriores)
const LATEST = 30;        // últimas publicaciones por marca
const MAX_FETCH = 400;    // tope al traer el mes actual y el anterior (y, una sola vez, el de antes); v316: antes 200 (Superseis sube ~4 por día)
const INSIGHT_DAYS = 45;  // alcance solo de las publicaciones recientes (el resto ya no cambia)
const FRESH_DAYS = 15;    // después de 15 días, si ya se tenía el alcance, no se vuelve a pedir (v314: antes 10; la vida útil mide 14)
const KEEP_MONTH = 250; // por marca y por mes: todas (tope de seguridad; v316: antes 80 y Superseis lo pasaba)
// v317 · Para no gastar de más en Supabase (egress: cada app baja este archivo cuando cambia): solo las marcas principales
// guardan TODAS sus publicaciones, y solo de los últimos 3 meses (lo que usa el Análisis); y la imagen va solo en las que se
// muestran (las últimas 9 y las 15 de más alcance de cada mes). Las demás marcas y los meses más viejos, compactos como antes.
const KEEP_IMG = 9, KEEP_TOP = 15, FULL_MONTHS = 3;

// v314 · Vida útil: en cada corrida (2 por día) se anota el alcance acumulado de cada publicación de las marcas principales
// mientras tiene 15 días o menos. Al pasar los 14 días se resume: alcance final (a los 14 días), qué parte tenía a las
// 24, 48, 72 y 168 horas (entre dos anotaciones, en línea recta) y en cuántos días llegó al 90 %. Los resúmenes se
// guardan 120 días. Si a una publicación le falta la primera anotación (dentro de las primeras 24 h) o no llegó a los 14
// días, no se resume (no se inventa).
const TRACK_BRANDS = ["Superseis", "Stock", "Delimarket"], TRACK_DAYS = 15, TRACK_FINAL_H = 336, TRACK_KEEP_DAYS = 120;
const curveAt = (pts, h) => { const P = [[0, 0], ...pts]; for (let i = 1; i < P.length; i++){ if (P[i][0] >= h){ const [h0, r0] = P[i - 1], [h1, r1] = P[i]; return h1 === h0 ? r1 : r0 + (r1 - r0) * (h - h0) / (h1 - h0); } } return null; };
function trackSummary(pts){
  if (!pts.length || pts[0][0] > 24 || pts[pts.length - 1][0] < TRACK_FINAL_H) return null;
  const f = curveAt(pts, TRACK_FINAL_H); if (!f || f <= 0) return null;
  const at = h => Math.round(Math.min(1, Math.max(0, curveAt(pts, h) / f)) * 1000) / 1000;
  const P = [[0, 0], ...pts]; let t90 = null;
  for (let i = 1; i < P.length && t90 === null; i++) if (P[i][1] >= .9 * f){ const [h0, r0] = P[i - 1], [h1, r1] = P[i]; t90 = (r1 === r0 ? h1 : h0 + (h1 - h0) * (.9 * f - r0) / (r1 - r0)) / 24; }
  return { f: Math.round(f), d1: at(24), d2: at(48), d3: at(72), d7: at(168), t90: t90 === null ? null : Math.round(t90 * 2) / 2 };
}
function trackUpdate(prev, seen, nowMs){
  const t = prev && typeof prev === "object" ? prev : {}, live = { ...(t.live || {}) }, done = { ...(t.done || {}) };
  for (const p of seen){
    const h = Math.round((nowMs - Date.parse(p.ts)) / 36e5 * 10) / 10; if (h < 0 || h > TRACK_DAYS * 24 || done[p.id]) continue;
    const e = live[p.id] || { b: p.b, ts: p.ts, cap: Array.from(String(p.cap || "")).slice(0, 120).join(""), pts: [] }, last = e.pts[e.pts.length - 1];
    if (last && h - last[0] < 1) e.pts[e.pts.length - 1] = [h, p.reach]; else e.pts.push([h, p.reach]);
    live[p.id] = e;
  }
  for (const [id, e] of Object.entries(live)){ // las que ya pasaron los 15 días: se resumen (o se descartan si les falta un tramo)
    if ((nowMs - Date.parse(e.ts)) / 36e5 <= TRACK_DAYS * 24) continue;
    const s = trackSummary(e.pts); if (s) done[id] = { b: e.b, ts: e.ts, cap: e.cap, ...s }; delete live[id];
  }
  for (const [id, e] of Object.entries(done)) if (nowMs - Date.parse(e.ts) > TRACK_KEEP_DAYS * 864e5) delete done[id];
  return { since: t.since || new Date(nowMs).toISOString(), live, done };
}
const ym = ts => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion" }).format(new Date(ts)).slice(0, 7);
const prevOf = m => { const [y, n] = m.split("-").map(Number); return n === 1 ? `${y - 1}-12` : `${y}-${String(n - 1).padStart(2, "0")}`; };

const typeOf = m => m.media_product_type === "REELS" ? "Reel" : m.media_type === "CAROUSEL_ALBUM" ? "Carrusel" : m.media_type === "VIDEO" ? "Video" : "Post";
const imgOf = m => m.thumbnail_url || (m.media_type === "VIDEO" ? null : m.media_url) || null;

async function insights(id){
  try {
    const j = await graph(`/${id}/insights`, { metric: "reach,saved,shares" });
    const out = {};
    for (const m of j.data || []) out[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? null;
    return out;
  } catch (e){ return {}; } // algunas publicaciones (ej. muy viejas) no tienen métricas
}
// v312: las vistas (reproducciones / veces que se mostró) van en una consulta aparte: si Meta no las da para alguna publicación,
// no se pierde el alcance de las demás métricas.
async function viewsOf(id){
  try { const j = await graph(`/${id}/insights`, { metric: "views" }); const m = (j.data || [])[0]; return m ? m.values?.[0]?.value ?? m.total_value?.value ?? null : null; }
  catch (e){ return null; }
}

async function pool(items, n, fn){
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length){ const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

const hasImg = p => !!p.img; // incluye los reels: se muestran con su portada
const score = p => p.reach ?? ((p.likes || 0) + (p.comments || 0) + (p.saved || 0) + (p.shares || 0));
const byTsDesc = l => [...l].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
// Compacto: las últimas 9 con imagen y las 15 de más alcance (sin repetir).
function compact(list){
  const keep = new Map();
  byTsDesc(list).filter(hasImg).slice(0, KEEP_IMG).forEach(p => keep.set(p.id, p));
  [...list].sort((a, b) => score(b) - score(a)).slice(0, KEEP_TOP).forEach(p => keep.set(p.id, p));
  return byTsDesc([...keep.values()]);
}
// Completo: todas (hasta 250), con imagen solo las que se muestran (las del compacto).
function full(list){ const shown = new Set(compact(list).map(p => p.id)); return byTsDesc(list).slice(0, KEEP_MONTH).map(p => shown.has(p.id) ? p : (({ img, ...rest }) => rest)(p)); }
const fullWindow = cur => { let m = cur; for (let i = 1; i < FULL_MONTHS; i++) m = prevOf(m); return m; }; // el mes más viejo que va completo
const monthPick = (list, b, m, cur) => (TRACK_BRANDS.includes(b) && m >= fullWindow(cur) ? full : compact)(list);

// Imágenes y me gusta nuevos para publicaciones ya guardadas (meses viejos): de a 50 por consulta.
async function refreshMedia(ids){
  const out = {};
  for (let i = 0; i < ids.length; i += 50){
    const chunk = ids.slice(i, i + 50), fields = "media_type,media_url,thumbnail_url,like_count,comments_count";
    try { Object.assign(out, await graph("/", { ids: chunk.join(","), fields })); }
    catch (e){ // si alguna se borró, la consulta entera falla: se piden de a una
      await pool(chunk, 8, async id => { try { out[id] = await graph(`/${id}`, { fields }); } catch {} });
    }
  }
  return out;
}

const handler = async (req, res) => {
  const who = await cronOrUser(req); // el cron o el botón “Actualizar” de la app (Admin total, Admin o CM)
  if (!who) return res.status(401).json({ ok: false, error: "No autorizado: falta ?secret= o es incorrecto" });
  if (!process.env.META_TOKEN){ console.error("ERROR: falta la variable META_TOKEN en Vercel"); return res.status(500).json({ ok: false, error: "Falta la variable META_TOKEN en Vercel" }); }
  const dry = req.query.dry === "1" && who === "cron";
  try {
    const [{ byBrand }, old] = await Promise.all([brandPages(), readMeta("s:META_POSTS").catch(() => null)]);
    const prevData = old && typeof old === "object" ? old : {};
    const { at, month } = today(), prev = prevOf(month);
    // El de antes del anterior (ej. agosto en octubre) se trae una sola vez, si todavía no está guardado: TV Impacto muestra el mes en
    // curso y los dos anteriores. Después queda como los demás meses cerrados.
    const back = prevOf(prev), months = [month, prev, ...(prevData["m:" + back] ? [] : [back])].filter(m => m >= FIRST_MONTH);
    // Lo que ya se sabía de cada publicación (para no volver a pedir el alcance de las que ya no cambian).
    const known = new Map();
    for (const [k, v] of Object.entries(prevData)){
      if (k.startsWith("m:")) Object.values(v || {}).forEach(list => (list || []).forEach(p => p?.id && known.set(p.id, p)));
      else (v?.posts || []).forEach(p => p?.id && known.set(p.id, p));
    }
    const payload = { updated: at }, summary = {}, monthsOut = Object.fromEntries(months.map(m => ["m:" + m, {}])), seen = [];
    const since = Date.now() - INSIGHT_DAYS * 864e5, fresh = Date.now() - FRESH_DAYS * 864e5, oldest = months[months.length - 1];
    // Todas las marcas a la vez; si una falla, se guardan las demás.
    await Promise.all(ORDEN.map(async (b) => {
      const p = byBrand[b];
      if (!p || !p.igId){ if (p) summary[b] = "sin Instagram vinculado a la página"; return; }
      try {
        // Del más nuevo al más viejo, hasta cubrir el mes actual y el anterior.
        const media = []; let j = await graph(`/${p.igId}/media`, { fields: FIELDS, limit: "50" });
        for (;;){
          const d = (j.data || []).filter(m => m.media_product_type !== "STORY"); media.push(...d);
          const last = (j.data || []).slice(-1)[0];
          if (media.length >= MAX_FETCH || !last || ym(last.timestamp) < oldest || !j.paging?.next || !j.paging?.cursors?.after) break;
          j = await graph(`/${p.igId}/media`, { fields: FIELDS, limit: "50", after: j.paging.cursors.after });
        }
        const posts = await pool(media, 10, async (m) => {
          const t = new Date(m.timestamp).getTime(), k = known.get(m.id) || {};
          const need = (t >= since && (t >= fresh || k.reach == null)) || (months.includes(back) && ym(m.timestamp) === back && !known.has(m.id)); // las del mes traído una vez: su alcance, una vez
          const [ins, views] = need ? await Promise.all([insights(m.id), viewsOf(m.id)]) : [{}, null];
          return {
            id: m.id, type: typeOf(m),
            cap: Array.from(String(m.caption || "")).slice(0, 300).join(""), // por letras: no corta emojis
            img: imgOf(m), link: m.permalink, ts: m.timestamp,
            likes: m.like_count ?? null, comments: m.comments_count ?? null,
            reach: ins.reach ?? k.reach ?? null, saved: ins.saved ?? k.saved ?? null, shares: ins.shares ?? k.shares ?? null, views: views ?? k.views ?? null,
          };
        });
        payload[b] = { handle: p.handle, posts: posts.slice(0, LATEST) };
        if (TRACK_BRANDS.includes(b)) posts.forEach(x => { if (typeof x.reach === "number" && Date.now() - Date.parse(x.ts) <= TRACK_DAYS * 864e5) seen.push({ b, id: x.id, ts: x.ts, cap: x.cap, reach: x.reach }); });
        for (const m of months){ const list = posts.filter(x => ym(x.ts) === m); if (list.length) monthsOut["m:" + m][b] = monthPick(list, b, m, month); }
        summary[b] = { ultimas: Math.min(posts.length, LATEST), ...Object.fromEntries(months.map(m => [m, posts.filter(x => ym(x.ts) === m).length])) };
      } catch (e){ summary[b] = "error: " + e.message; payload[b] = { handle: p.handle, posts: prevData[b]?.posts || [], err: e.message };
        for (const m of months){ const keep = prevData["m:" + m]?.[b]; if (keep) monthsOut["m:" + m][b] = keep; } } // si falla, el mes guardado queda como estaba
    }));
    Object.assign(payload, monthsOut);
    payload.track = trackUpdate(prevData.track, seen, Date.now()); // v314: vida útil
    summary.vidaUtil = { midiendo: Object.keys(payload.track.live).length, resumidas: Object.keys(payload.track.done).length, desde: payload.track.since };
    // Meses ya cerrados (más viejos que el anterior): quedan como estaban, con las imágenes renovadas.
    const archived = Object.keys(prevData).filter(k => k.startsWith("m:") && k.slice(2) >= FIRST_MONTH && !months.includes(k.slice(2)));
    if (archived.length){
      const ids = [...new Set(archived.flatMap(k => Object.values(prevData[k] || {}).flatMap(list => (list || []).filter(hasImg).map(p => p.id))))]; // v317: solo las que llevan imagen
      const fresh2 = await refreshMedia(ids).catch(() => ({}));
      for (const k of archived){
        payload[k] = Object.fromEntries(Object.entries(prevData[k] || {}).map(([b, list]) => [b, monthPick((list || []).map(p => { const f = fresh2[p.id];
          return f && p.img ? { ...p, img: imgOf(f) || p.img, likes: f.like_count ?? p.likes, comments: f.comments_count ?? p.comments } : p; }), b, k.slice(2), month)])); // v317: los meses viejos quedan compactos
      }
      summary.archivo = archived.map(k => k.slice(2));
    }
    if (!dry) await save("s:META_POSTS", payload);
    console.log(`[publicaciones] ${JSON.stringify(summary)}${dry ? " (prueba, sin guardar)" : " guardadas"}`);
    return res.status(200).json({ ok: true, dry, saved: !dry, posts: summary });
  } catch (e){
    console.error(`[${req.url}] ERROR: ${e.message}${e.code ? ` (código ${e.code})` : ""}${tokenHint(e) ? " → " + tokenHint(e) : ""}`);
    return res.status(500).json({ ok: false, error: e.message, hint: tokenHint(e) });
  }
};
module.exports = handler;
module.exports.trackUpdate = trackUpdate; // para probarlo sin llamar a Meta
module.exports.trackSummary = trackSummary;
module.exports.monthPick = monthPick;
