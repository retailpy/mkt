// Publicaciones de Instagram de cada marca (las mismas cuentas que Seguidores). Guarda en app_state → s:META_POSTS:
//   { "updated": "...", "Stock": { "handle": "@...", "posts": [ { id, type, product, cap, img, link, ts, likes, comments, reach, saved, shares } ] }, ... }
// Lo usan: Seguidores por marca (últimas 6), Impacto en Redes y el Informe de redes (top 10 del mes).
// Las imágenes de Instagram vencen a los pocos días: por eso corre todos los días.
//
// Probar sin guardar:  /api/publicaciones?dry=1&secret=EL_CRON_SECRET
const { ORDEN, authorized, graph, brandPages, save, today, tokenHint } = require("./_lib/meta");

const FIELDS = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";
const MAX = 40;          // publicaciones guardadas por marca
const INSIGHT_DAYS = 45; // alcance solo de las publicaciones recientes (el resto ya no cambia)

async function insights(id){
  try {
    const j = await graph(`/${id}/insights`, { metric: "reach,saved,shares" });
    const out = {};
    for (const m of j.data || []) out[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? null;
    return out;
  } catch (e){ return {}; } // algunas publicaciones (ej. muy viejas) no tienen métricas
}

module.exports = async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "No autorizado: falta ?secret= o es incorrecto" });
  if (!process.env.META_TOKEN){ console.error("ERROR: falta la variable META_TOKEN en Vercel"); return res.status(500).json({ ok: false, error: "Falta la variable META_TOKEN en Vercel" }); }
  const dry = req.query.dry === "1";
  try {
    const { byBrand } = await brandPages();
    const { at } = today();
    const payload = { updated: at }, summary = {};
    const since = Date.now() - INSIGHT_DAYS * 86400000;
    for (const b of ORDEN){
      const p = byBrand[b];
      if (!p || !p.igId) continue;
      const j = await graph(`/${p.igId}/media`, { fields: FIELDS, limit: String(MAX) });
      const media = (j.data || []).filter(m => m.media_product_type !== "STORY");
      const posts = [];
      for (const m of media){
        const ins = new Date(m.timestamp).getTime() >= since ? await insights(m.id) : {};
        posts.push({
          id: m.id,
          type: m.media_product_type === "REELS" ? "Reel" : m.media_type === "CAROUSEL_ALBUM" ? "Carrusel" : m.media_type === "VIDEO" ? "Video" : "Post",
          cap: String(m.caption || "").slice(0, 300),
          img: m.thumbnail_url || (m.media_type === "VIDEO" ? null : m.media_url) || null,
          link: m.permalink, ts: m.timestamp,
          likes: m.like_count ?? null, comments: m.comments_count ?? null,
          reach: ins.reach ?? null, saved: ins.saved ?? null, shares: ins.shares ?? null,
        });
      }
      payload[b] = { handle: p.handle, posts };
      summary[b] = posts.length;
    }
    if (!dry) await save("s:META_POSTS", payload);
    console.log(`[publicaciones] ${JSON.stringify(summary)}${dry ? " (prueba, sin guardar)" : " guardadas"}`);
    return res.status(200).json({ ok: true, dry, saved: !dry, posts: summary });
  } catch (e){
    console.error(`[${req.url}] ERROR: ${e.message}${e.code ? ` (código ${e.code})` : ""}${tokenHint(e) ? " → " + tokenHint(e) : ""}`);
    return res.status(500).json({ ok: false, error: e.message, hint: tokenHint(e) });
  }
};
