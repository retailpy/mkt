// Publicaciones de Instagram de cada marca (las mismas cuentas que Seguidores). Guarda en app_state → s:META_POSTS:
//   { "updated": "...",
//     "Stock": { "handle": "@...", "posts": [ { id, type, cap, img, link, ts, likes, comments, reach, saved, shares } ] },   ← las últimas 30
//     "m:2026-09": { "Stock": [ ... ], ... }, "m:2026-10": { ... }, ... }                                                    ← archivo de cada mes
// Cada mes muestra sus publicaciones: las últimas 9 con imagen y el top por alcance. El archivo de cada mes guarda solo eso
// (para que la app cargue liviana) y queda guardado aunque pasen los meses; las imágenes de los meses viejos se renuevan acá
// porque las de Instagram vencen a los pocos días (por eso corre todos los días).
//
// Probar sin guardar:  /api/publicaciones?dry=1&secret=EL_CRON_SECRET
const { ORDEN, cronOrUser, graph, brandPages, save, readMeta, today, tokenHint } = require("./_lib/meta");

const FIELDS = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";
const FIRST_MONTH = "2026-09"; // la app arranca en septiembre 2026: antes no hay meses
const LATEST = 30;        // últimas publicaciones por marca
const MAX_FETCH = 150;    // tope al traer el mes actual y el anterior
const INSIGHT_DAYS = 45;  // alcance solo de las publicaciones recientes (el resto ya no cambia)
const FRESH_DAYS = 10;    // después de 10 días, si ya se tenía el alcance, no se vuelve a pedir
const KEEP_IMG = 9, KEEP_TOP = 15; // por marca y por mes: las últimas 9 con imagen + las 15 de más alcance

const ym = ts => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion" }).format(new Date(ts)).slice(0, 7);
const prevOf = m => { const [y, n] = m.split("-").map(Number); return n === 1 ? `${y - 1}-12` : `${y}-${String(n - 1).padStart(2, "0")}`; };
const isImg = p => !/reel|video/i.test(p.type || "");
const score = p => p.reach ?? ((p.likes || 0) + (p.comments || 0) + (p.saved || 0) + (p.shares || 0));
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

async function pool(items, n, fn){
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length){ const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

// Lo que se guarda de cada mes: las últimas 9 con imagen y las de más alcance (sin repetir).
function monthPick(list){
  const byTs = [...list].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  const keep = new Map();
  byTs.filter(isImg).slice(0, KEEP_IMG).forEach(p => keep.set(p.id, p));
  [...list].sort((a, b) => score(b) - score(a)).slice(0, KEEP_TOP).forEach(p => keep.set(p.id, p));
  return [...keep.values()].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
}

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

module.exports = async (req, res) => {
  const who = await cronOrUser(req); // el cron o el botón “Actualizar” de la app (Admin total, Admin o CM)
  if (!who) return res.status(401).json({ ok: false, error: "No autorizado: falta ?secret= o es incorrecto" });
  if (!process.env.META_TOKEN){ console.error("ERROR: falta la variable META_TOKEN en Vercel"); return res.status(500).json({ ok: false, error: "Falta la variable META_TOKEN en Vercel" }); }
  const dry = req.query.dry === "1" && who === "cron";
  try {
    const [{ byBrand }, old] = await Promise.all([brandPages(), readMeta("s:META_POSTS").catch(() => null)]);
    const prevData = old && typeof old === "object" ? old : {};
    const { at, month } = today(), prev = prevOf(month);
    const months = [month, prev].filter(m => m >= FIRST_MONTH);
    // Lo que ya se sabía de cada publicación (para no volver a pedir el alcance de las que ya no cambian).
    const known = new Map();
    for (const [k, v] of Object.entries(prevData)){
      if (k.startsWith("m:")) Object.values(v || {}).forEach(list => (list || []).forEach(p => p?.id && known.set(p.id, p)));
      else (v?.posts || []).forEach(p => p?.id && known.set(p.id, p));
    }
    const payload = { updated: at }, summary = {}, monthsOut = Object.fromEntries(months.map(m => ["m:" + m, {}]));
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
          const need = t >= since && (t >= fresh || k.reach == null);
          const ins = need ? await insights(m.id) : {};
          return {
            id: m.id, type: typeOf(m),
            cap: Array.from(String(m.caption || "")).slice(0, 300).join(""), // por letras: no corta emojis
            img: imgOf(m), link: m.permalink, ts: m.timestamp,
            likes: m.like_count ?? null, comments: m.comments_count ?? null,
            reach: ins.reach ?? k.reach ?? null, saved: ins.saved ?? k.saved ?? null, shares: ins.shares ?? k.shares ?? null,
          };
        });
        payload[b] = { handle: p.handle, posts: posts.slice(0, LATEST) };
        for (const m of months){ const list = posts.filter(x => ym(x.ts) === m); if (list.length) monthsOut["m:" + m][b] = monthPick(list); }
        summary[b] = { ultimas: Math.min(posts.length, LATEST), ...Object.fromEntries(months.map(m => [m, posts.filter(x => ym(x.ts) === m).length])) };
      } catch (e){ summary[b] = "error: " + e.message; payload[b] = { handle: p.handle, posts: prevData[b]?.posts || [], err: e.message };
        for (const m of months){ const keep = prevData["m:" + m]?.[b]; if (keep) monthsOut["m:" + m][b] = keep; } } // si falla, el mes guardado queda como estaba
    }));
    Object.assign(payload, monthsOut);
    // Meses ya cerrados (más viejos que el anterior): quedan como estaban, con las imágenes renovadas.
    const archived = Object.keys(prevData).filter(k => k.startsWith("m:") && k.slice(2) >= FIRST_MONTH && !months.includes(k.slice(2)));
    if (archived.length){
      const ids = [...new Set(archived.flatMap(k => Object.values(prevData[k] || {}).flatMap(list => (list || []).map(p => p.id))))];
      const fresh2 = await refreshMedia(ids).catch(() => ({}));
      for (const k of archived){
        payload[k] = Object.fromEntries(Object.entries(prevData[k] || {}).map(([b, list]) => [b, (list || []).map(p => { const f = fresh2[p.id];
          return f ? { ...p, img: imgOf(f) || p.img, likes: f.like_count ?? p.likes, comments: f.comments_count ?? p.comments } : p; })]));
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
