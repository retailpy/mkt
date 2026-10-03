// Búsqueda de GIFs para el Chat Retail MKT. La clave queda en Vercel (nunca llega al navegador).
// Usa GIPHY_KEY (giphy.com/developers) o TENOR_KEY (Google Tenor). Sin clave responde 503 y la app lo explica.
//   /api/gifs?q=gracias      → { ok, gifs: [{ id, url, preview, w, h, title }] }
//   /api/gifs                → los más populares
module.exports = async (req, res) => {
  const q = String((req.query && req.query.q) || "").trim().slice(0, 60);
  const giphy = process.env.GIPHY_KEY, tenor = process.env.TENOR_KEY;
  if (!giphy && !tenor) return res.status(503).json({ ok: false, error: "Falta configurar la clave de GIFs (GIPHY_KEY o TENOR_KEY) en Vercel" });
  try {
    let gifs = [];
    if (giphy){
      const u = new URL(`https://api.giphy.com/v1/gifs/${q ? "search" : "trending"}`);
      u.searchParams.set("api_key", giphy); u.searchParams.set("limit", "24"); u.searchParams.set("rating", "g"); u.searchParams.set("lang", "es");
      if (q) u.searchParams.set("q", q);
      const j = await (await fetch(u)).json();
      gifs = (j.data || []).map(g => ({ id: g.id, title: g.title || "", url: g.images?.downsized_medium?.url || g.images?.original?.url, preview: g.images?.fixed_width_small?.url || g.images?.fixed_width?.url, w: +(g.images?.fixed_width?.width || 0), h: +(g.images?.fixed_width?.height || 0) }));
    } else {
      const u = new URL(`https://tenor.googleapis.com/v2/${q ? "search" : "featured"}`);
      u.searchParams.set("key", tenor); u.searchParams.set("limit", "24"); u.searchParams.set("contentfilter", "high"); u.searchParams.set("locale", "es_PY"); u.searchParams.set("media_filter", "gif,tinygif");
      if (q) u.searchParams.set("q", q);
      const j = await (await fetch(u)).json();
      gifs = (j.results || []).map(g => ({ id: g.id, title: g.content_description || "", url: g.media_formats?.gif?.url, preview: g.media_formats?.tinygif?.url || g.media_formats?.gif?.url, w: g.media_formats?.tinygif?.dims?.[0] || 0, h: g.media_formats?.tinygif?.dims?.[1] || 0 }));
    }
    res.setHeader("Cache-Control", "s-maxage=600");
    return res.status(200).json({ ok: true, gifs: gifs.filter(g => g.url && g.preview) });
  } catch (e){
    console.error(`[gifs] ERROR: ${e.message}`);
    return res.status(502).json({ ok: false, error: "No se pudieron buscar GIFs" });
  }
};
