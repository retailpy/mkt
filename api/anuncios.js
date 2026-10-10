// Anuncios de Pauta Meta Ads: los que están ACTIVOS ahora (aunque todavía no tengan impresiones este mes) y los que se
// pautaron en el mes, con su imagen reducida y su copy. Guarda en app_state → s:META_CREATIVES:
//   { "updated": "...", "errors": { "Superseis": "motivo" }, "AAAA-MM": { "Superseis": [ { id, name, title, body, img, status, impressions, reach, clicks, spend } ] }, ... }
// Lo usa Pauta Meta Ads (Corriendo ahora y Anuncios pautados). Corre todos los días (las imágenes de Meta vencen a los pocos días).
// El token necesita el permiso ads_read sobre las cuentas publicitarias.
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

const MAX_PER_BRAND = 80; // tope de anuncios por marca (primero los activos, después los de más gasto)
const CREATIVE = "effective_status,creative.thumbnail_width(320).thumbnail_height(320){title,body,thumbnail_url,image_url,object_story_spec}";

async function pool(items, n, fn){
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length){ const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

// Anuncios activos ahora (id y nombre), sigue las páginas hasta 3 veces.
async function activeAds(act){
  const out = []; let j = await graph(`/act_${act}/ads`, { fields: "id,name,effective_status", effective_status: JSON.stringify(["ACTIVE"]), limit: "100" });
  for (let n = 0; n < 3; n++){
    out.push(...(j.data || []));
    if (out.length >= MAX_PER_BRAND || !j.paging?.next || !j.paging?.cursors?.after) break;
    j = await graph(`/act_${act}/ads`, { fields: "id,name,effective_status", effective_status: JSON.stringify(["ACTIVE"]), limit: "100", after: j.paging.cursors.after });
  }
  return out;
}

// Imagen y copy de cada anuncio, en grupos chicos (si Meta pide menos datos, se piden de a uno).
async function creatives(ids){
  const out = {};
  for (let i = 0; i < ids.length; i += 20){
    const chunk = ids.slice(i, i + 20);
    try { Object.assign(out, await graph("/", { ids: chunk.join(","), fields: CREATIVE })); }
    catch (e){ await pool(chunk, 5, async id => { try { out[id] = await graph(`/${id}`, { fields: CREATIVE }); } catch {} }); }
  }
  return out;
}

module.exports = async (req, res) => {
  const who = await cronOrUser(req); // el cron o el botón “Actualizar” de la app (Admin total, Admin o CM)
  if (!who) return res.status(401).json({ ok: false, error: "No autorizado: falta ?secret= o es incorrecto" });
  if (!process.env.META_TOKEN){ console.error("ERROR: falta la variable META_TOKEN en Vercel"); return res.status(500).json({ ok: false, error: "Falta la variable META_TOKEN en Vercel" }); }
  const dry = req.query.dry === "1" && who === "cron";
  const { month, at } = today();
  const out = {}, errors = {};
  // Todas las marcas a la vez (cada una en lo suyo): si una falla, las demás se guardan igual y el motivo queda anotado.
  await Promise.all(Object.entries(CUENTAS).map(async ([brand, act]) => {
    const notes = [];
    try {
      // 1) Lo que corre ahora y 2) lo que tuvo impresiones este mes. Si una de las dos consultas falla, se sigue con la otra.
      let live = [], rows = [];
      try { live = await activeAds(act); } catch (e){ notes.push("activos: " + e.message); }
      try { rows = ((await graph(`/act_${act}/insights`, { level: "ad", date_preset: "this_month", fields: "ad_id,ad_name,impressions,reach,clicks,spend", limit: "200" })).data || []).filter(r => +r.impressions > 0); }
      catch (e){ notes.push("gasto: " + e.message); }
      if (!live.length && !rows.length && notes.length) throw new Error(notes.join(" · "));
      const metr = new Map(rows.map(r => [r.ad_id, r]));
      const names = new Map([...live.map(a => [a.id, a.name]), ...rows.map(r => [r.ad_id, r.ad_name])]);
      const extra = rows.filter(r => !live.some(a => a.id === r.ad_id)).sort((x, y) => +y.spend - +x.spend);
      const ids = [...new Set([...live.map(a => a.id), ...extra.map(r => r.ad_id)])].slice(0, MAX_PER_BRAND);
      const det = await creatives(ids);
      out[brand] = ids.map(id => {
        const a = det[id] || {}, c = a.creative || {}, ld = c.object_story_spec?.link_data || {}, vd = c.object_story_spec?.video_data || {}, r = metr.get(id) || {};
        return { id, name: names.get(id) || "",
          title: c.title || ld.name || vd.title || "",
          body: String(c.body || ld.message || vd.message || "").slice(0, 600),
          img: c.thumbnail_url || c.image_url || ld.picture || vd.image_url || null,
          status: a.effective_status || (live.some(x => x.id === id) ? "ACTIVE" : null),
          impressions: +r.impressions || 0, reach: +r.reach || 0, clicks: +r.clicks || 0, spend: +r.spend || 0 };
      }).sort((x, y) => (y.status === "ACTIVE") - (x.status === "ACTIVE") || y.spend - x.spend);
      if (notes.length) errors[brand] = notes.join(" · ");
    } catch (e){
      errors[brand] = e.message + (tokenHint(e) ? " → " + tokenHint(e) : "");
      console.error(`[anuncios] ${brand} ERROR: ${errors[brand]}`);
    }
  }));
  try {
    if (!dry && Object.keys(out).length) await save("s:META_CREATIVES", { updated: at, errors, [month]: out });
  } catch (e){
    console.error(`[anuncios] ERROR al guardar: ${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
  const counts = Object.fromEntries(Object.entries(out).map(([b, l]) => [b, { total: l.length, activos: l.filter(x => x.status === "ACTIVE").length, conImagen: l.filter(x => x.img).length }]));
  console.log(`[anuncios] ${month}: ${JSON.stringify(counts)} errores: ${JSON.stringify(errors)}${dry ? " (prueba, sin guardar)" : ""}`);
  return res.status(Object.keys(out).length ? 200 : 500).json({ ok: Object.keys(out).length > 0, dry, month, ads: counts, errors });
};
