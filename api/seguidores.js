// Seguidores de Instagram y Facebook por marca. Guarda en app_state → s:META_FOLLOWERS:
//   { "updated": "...", "2026-09": { "Superseis": { "ig": 268900, "fb": 412300, "handle": "@superseis" }, ... }, ... }
// Cada mes queda con el último dato del mes, así la app puede comparar contra el mes anterior.
//
// Probar sin guardar:  /api/seguidores?dry=1&secret=EL_CRON_SECRET
const { ORDEN, authorized, brandPages, save, today, tokenHint } = require("./_lib/meta");

module.exports = async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "No autorizado: falta ?secret= o es incorrecto" });
  if (!process.env.META_TOKEN) return res.status(500).json({ ok: false, error: "Falta la variable META_TOKEN en Vercel" });
  const dry = req.query.dry === "1";
  try {
    const { byBrand, unmatched, missing, total } = await brandPages();
    const { month, at } = today();
    const monthData = {};
    for (const b of ORDEN){
      const p = byBrand[b];
      if (p) monthData[b] = { ig: p.ig, fb: p.fb, handle: p.handle, page: p.page };
    }
    const payload = { updated: at, [month]: monthData };
    if (!dry) await save("s:META_FOLLOWERS", payload);
    return res.status(200).json({
      ok: true, dry, saved: !dry, month, pagesSeen: total,
      brands: monthData,
      missingBrands: missing,        // marcas sin página encontrada
      pagesNotMatched: unmatched,    // páginas que no coinciden con ninguna marca
    });
  } catch (e){
    return res.status(500).json({ ok: false, error: e.message, hint: tokenHint(e) });
  }
};
