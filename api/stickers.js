// Stickers del chat guardados en Google Drive (carpeta "Stickers Retail MKT"), a través de un Apps Script de la cuenta dueña.
//   GET  /api/stickers → { ok, stickers:[{ id, name, by, ts, url }] }
//   POST /api/stickers  { name, type, data(base64) } → { ok, sticker }
// Solo para personas con sesión iniciada (se verifica el token de Supabase). La clave del script queda en Vercel.
// Ver docs/STICKERS.md para conectarlo.
const MAX_BYTES = 400 * 1024;
const TYPES = ["image/png", "image/webp", "image/gif", "image/jpeg"];
const url = id => `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w320`;

async function user(req){
  const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!t || !process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) return null;
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${t}` } });
  return r.ok ? r.json() : null;
}

module.exports = async (req, res) => {
  const script = process.env.STICKERS_SCRIPT_URL, key = process.env.STICKERS_SCRIPT_KEY;
  if (!script || !key) return res.status(503).json({ ok: false, error: "Falta conectar la carpeta de stickers de Google Drive (ver docs/STICKERS.md)" });
  const u = await user(req).catch(() => null);
  if (!u) return res.status(401).json({ ok: false, error: "Iniciá sesión en la app" });
  try {
    if (req.method === "GET"){
      const j = await (await fetch(`${script}?key=${encodeURIComponent(key)}`, { redirect: "follow" })).json();
      if (!j.ok) throw new Error(j.error || "sin respuesta");
      res.setHeader("Cache-Control", "private, max-age=60");
      return res.status(200).json({ ok: true, stickers: j.stickers.map(s => ({ ...s, url: url(s.id) })) });
    }
    if (req.method === "POST"){
      const b = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      if (!TYPES.includes(b.type)) return res.status(400).json({ ok: false, error: "La imagen tiene que ser PNG, WEBP, GIF o JPG" });
      const size = Buffer.from(String(b.data || ""), "base64").length;
      if (!size || size > MAX_BYTES) return res.status(400).json({ ok: false, error: "El sticker supera 400 KB" });
      const by = u.user_metadata?.name || (u.email || "").split("@")[0];
      const r = await fetch(script, { method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ key, name: b.name, type: b.type, data: b.data, by }) });
      const j = await r.json();
      if (!j.ok) return res.status(400).json({ ok: false, error: j.error || "No se pudo guardar" });
      return res.status(200).json({ ok: true, sticker: { ...j.sticker, url: url(j.sticker.id) } });
    }
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  } catch (e){
    console.error(`[stickers] ERROR: ${e.message}`);
    return res.status(502).json({ ok: false, error: "No se pudo conectar con la carpeta de stickers" });
  }
};
