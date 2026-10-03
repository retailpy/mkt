// Anuncios de Meta Ads que se pautaron en el mes, con su imagen reducida y su copy. Guarda en app_state → s:META_CREATIVES:
//   { "updated": "...", "AAAA-MM": { "Superseis": [ { id, name, title, body, img, status, impressions, reach, clicks, spend } ] }, ... }
// Lo usa Pauta → Informe Meta Ads. Corre todos los días (las imágenes de Meta vencen a los pocos días).
// El token necesita el permiso ads_read sobre las cuentas publicitarias.
//
// Probar sin guardar:  /api/anuncios?dry=1&secret=EL_CRON_SECRET
const { authorized, graph, save, today, tokenHint } = require("./_lib/meta");

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

module.exports = async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "No autorizado: falta ?secret= o es incorrecto" });
  if (!process.env.META_TOKEN){ console.error("ERROR: falta la variable META_TOKEN en Vercel"); return res.status(500).json({ ok: false, error: "Falta la variable META_TOKEN en Vercel" }); }
  const dry = req.query.dry === "1";
  const { month, at } = today();
  const out = {}, errors = {};
  for (const [brand, act] of Object.entries(CUENTAS)){
    try {
      // Anuncios con impresiones este mes.
      const ins = await graph(`/act_${act}/insights`, { level: "ad", date_preset: "this_month", fields: "ad_id,ad_name,impressions,reach,clicks,spend", limit: "200" });
      const rows = (ins.data || []).filter(r => +r.impressions > 0);
      if (!rows.length){ out[brand] = []; continue; }
      const ads = [];
      for (let i = 0; i < rows.length; i += 50){
        const ids = rows.slice(i, i + 50).map(r => r.ad_id).join(",");
        const j = await graph("/", { ids, fields: "effective_status,creative.thumbnail_width(320).thumbnail_height(320){title,body,thumbnail_url,image_url,object_story_spec}" });
        for (const r of rows.slice(i, i + 50)){
          const a = j[r.ad_id] || {}, c = a.creative || {}, ld = c.object_story_spec?.link_data || {}, vd = c.object_story_spec?.video_data || {};
          ads.push({
            id: r.ad_id, name: r.ad_name,
            title: c.title || ld.name || vd.title || "",
            body: String(c.body || ld.message || vd.message || "").slice(0, 600),
            img: c.thumbnail_url || c.image_url || ld.picture || vd.image_url || null,
            status: a.effective_status || null,
            impressions: +r.impressions || 0, reach: +r.reach || 0, clicks: +r.clicks || 0, spend: +r.spend || 0,
          });
        }
      }
      out[brand] = ads.sort((x, y) => y.spend - x.spend);
    } catch (e){
      errors[brand] = e.message + (tokenHint(e) ? " → " + tokenHint(e) : "");
      console.error(`[anuncios] ${brand} ERROR: ${errors[brand]}`);
    }
  }
  try {
    if (!dry && Object.keys(out).length) await save("s:META_CREATIVES", { updated: at, [month]: out });
  } catch (e){
    console.error(`[anuncios] ERROR al guardar: ${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
  const counts = Object.fromEntries(Object.entries(out).map(([b, l]) => [b, l.length]));
  console.log(`[anuncios] ${month}: ${JSON.stringify(counts)}${dry ? " (prueba, sin guardar)" : ""}`);
  return res.status(Object.keys(out).length ? 200 : 500).json({ ok: Object.keys(out).length > 0, dry, month, ads: counts, errors });
};
