// Ofertas de Comercial: revisa los Excel "PUBLICADAS" de Drive y guarda el respaldo del día en la carpeta de Drive del mes.
// Lo hace la función "integraciones" de Supabase (acción comercial_sync, sin sesión: solo actualiza, como mucho cada 20 min).
// La llama el cron de Vercel: 00:15 (para que el respaldo quede el mismo día que empieza la oferta), 07:00 y 13:00 de Paraguay.
// Probar a mano:  /api/comercial?secret=EL_CRON_SECRET
const { authorized } = require("./_lib/meta");

module.exports = async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "No autorizado: falta ?secret= o es incorrecto" });
  const url = process.env.SUPABASE_URL, apikey = process.env.SUPABASE_KEY;
  if (!url || !apikey) return res.status(500).json({ ok: false, error: "Faltan las variables SUPABASE_URL o SUPABASE_KEY en Vercel" });
  try {
    const r = await fetch(`${url}/functions/v1/integraciones`, { method: "POST", headers: { apikey, "Content-Type": "application/json" }, body: JSON.stringify({ action: "comercial_sync" }) });
    const j = await r.json().catch(() => ({ ok: false, error: `respuesta ${r.status}` }));
    if (!j.ok) console.error("ERROR comercial:", j.error);
    return res.status(j.ok ? 200 : 500).json(j);
  } catch (e){
    console.error("ERROR comercial:", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
