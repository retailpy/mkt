// Ciudades, edades y sexo de los seguidores de Instagram por marca (Meta ya no los da para Facebook).
// Guarda en app_state → s:META_DEMO:
//   { "updated": "...", "Superseis": { "handle", "foll", "cities": [["Asunción", 1234], ...], "ages": { "18-24": 900, ... },
//                                       "gender": { "F": 1, "M": 1, "U": 1 } }, ...,
//     "2026-10": { "Superseis": {...}, ... } }   ← la foto de cada mes (la última del mes queda guardada)
// Meta no entrega demografía de cuentas con menos de 100 seguidores: esas marcas quedan en "sinDatos".
//
// Probar sin guardar:  /api/demograficos?dry=1&secret=EL_CRON_SECRET
const { ORDEN, authorized, graph, brandPages, save, today, tokenHint } = require("./_lib/meta");

async function breakdown(igId, by){
  const j = await graph(`/${igId}/insights`, {
    metric: "follower_demographics", period: "lifetime", metric_type: "total_value", breakdown: by,
  });
  const rows = j.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
  return rows.map(r => [r.dimension_values?.[0], r.value]).filter(r => r[0] != null);
}

module.exports = async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "No autorizado: falta ?secret= o es incorrecto" });
  if (!process.env.META_TOKEN) return res.status(500).json({ ok: false, error: "Falta la variable META_TOKEN en Vercel" });
  const dry = req.query.dry === "1";
  try {
    const { byBrand, missing } = await brandPages();
    const out = {}, sinDatos = {};
    for (const b of ORDEN){
      const p = byBrand[b];
      if (!p){ sinDatos[b] = "No se encontró su página de Facebook"; continue; }
      if (!p.igId){ sinDatos[b] = `La página "${p.page}" no tiene Instagram de Empresa/Creador vinculado`; continue; }
      if ((p.ig || 0) < 100){ sinDatos[b] = "Menos de 100 seguidores en Instagram"; continue; }
      try {
        const [cities, ages, gender] = await Promise.all([breakdown(p.igId, "city"), breakdown(p.igId, "age"), breakdown(p.igId, "gender")]);
        out[b] = {
          handle: p.handle, foll: p.ig,
          cities: cities.sort((x, y) => y[1] - x[1]).slice(0, 15),
          ages: Object.fromEntries(ages),
          gender: Object.fromEntries(gender),
        };
      } catch (e){
        sinDatos[b] = e.message;
      }
    }
    // Arriba queda lo último; además se guarda por mes ("2026-10": {...}) para que cada mes conserve su foto al cierre.
    const { month, at } = today();
    const payload = { updated: at, ...out, [month]: out };
    if (!dry && Object.keys(out).length) await save("s:META_DEMO", payload);
    return res.status(200).json({ ok: true, dry, saved: !dry && Object.keys(out).length > 0, brands: out, sinDatos, missingBrands: missing });
  } catch (e){
    return res.status(500).json({ ok: false, error: e.message, hint: tokenHint(e) });
  }
};
