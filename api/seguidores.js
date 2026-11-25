// Seguidores de Instagram y Facebook por marca. Guarda en app_state → s:META_FOLLOWERS:
//   { "updated": "...", "2026-09": { "Superseis": { "ig": 268900, "fb": 412300, "handle": "@superseis" }, ... }, ... }
// Cada mes queda con el último dato del mes (corre a la mañana y a las 23 h de Paraguay), así la app compara contra el mes anterior.
// v400: y una foto por día de las tres marcas ("d:AAAA-MM-DD", 70 días) para el crecimiento semanal del Resumen ejecutivo.
//
// Probar sin guardar:  /api/seguidores?dry=1&secret=EL_CRON_SECRET
const { ORDEN, cronOrUser, brandPages, save, today, tokenHint } = require("./_lib/meta");
const historias = require("./_lib/historias"); // v362: /api/seguidores?que=historias (Vercel gratis: hasta 12 funciones)

module.exports = async (req, res) => {
  if (req.query?.que === "historias") return historias(req, res);
  const who = await cronOrUser(req); // el cron o el botón “Actualizar” de la app (Admin total, Admin o CM)
  if (!who) return res.status(401).json({ ok: false, error: "No autorizado: falta ?secret= o es incorrecto" });
  if (!process.env.META_TOKEN){ console.error("ERROR: falta la variable META_TOKEN en Vercel"); return res.status(500).json({ ok: false, error: "Falta la variable META_TOKEN en Vercel" }); }
  const dry = req.query.dry === "1" && who === "cron";
  try {
    const { byBrand, unmatched, missing, total } = await brandPages();
    const { month, at, date } = today();
    const monthData = {};
    for (const b of ORDEN){
      const p = byBrand[b];
      if (p) monthData[b] = { ig: p.ig, fb: p.fb, handle: p.handle, page: p.page };
    }
    // v400 · Además, la foto del día (Superseis, Stock y Delimarket) para comparar semana contra semana en el Resumen
    // ejecutivo: "d:AAAA-MM-DD" → { Marca: { ig, fb } }. Se guardan 70 días (la de hace 70 días se borra con null).
    const day = {};
    for (const b of ["Superseis", "Stock", "Delimarket"]) if (monthData[b]) day[b] = { ig: monthData[b].ig, fb: monthData[b].fb };
    const old = new Date(Date.parse(date + "T12:00:00Z") - 70 * 864e5).toISOString().slice(0, 10);
    const payload = { updated: at, [month]: monthData, ...(Object.keys(day).length ? { ["d:" + date]: day } : {}), ["d:" + old]: null };
    if (!dry) await save("s:META_FOLLOWERS", payload);
    console.log(`[seguidores] ${month}: ${Object.keys(monthData).length} marcas${dry ? " (prueba, sin guardar)" : " guardadas"}. Sin página: ${missing.join(", ") || "ninguna"}`);
    return res.status(200).json({
      ok: true, dry, saved: !dry, month, pagesSeen: total,
      brands: monthData,
      missingBrands: missing,        // marcas sin página encontrada
      pagesNotMatched: unmatched,    // páginas que no coinciden con ninguna marca
    });
  } catch (e){
    // Queda en los logs de Vercel, así se ve el motivo cuando corre el cron.
    console.error(`[${req.url}] ERROR: ${e.message}${e.code ? ` (código ${e.code})` : ""}${tokenHint(e) ? " → " + tokenHint(e) : ""}`);
    return res.status(500).json({ ok: false, error: e.message, hint: tokenHint(e) });
  }
};
