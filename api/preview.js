// Vista previa de los links de redes que se pegan en el Chat: imagen chica, título y texto.
//   /api/preview?url=https://www.instagram.com/p/...   (con la sesión de la persona: cualquiera del equipo)
// Solo redes sociales conocidas (Instagram, Facebook, TikTok, YouTube); el resto se muestra como link simple en la app.
const { memberUser } = require("./_lib/meta");

const NETS = [
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)(facebook\.com|fb\.watch|fb\.com)$/, "Facebook"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
];
const netOf = host => (NETS.find(([re]) => re.test(host)) || [])[1] || null;
const dec = s => String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));
const cut = (s, n) => { const a = Array.from(dec(s).replace(/\s+/g, " ").trim()); return a.length > n ? a.slice(0, n - 1).join("") + "…" : a.join(""); };
const meta = (html, prop) => { const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i")); const c = m && m[0].match(/content=["']([^"']*)["']/i); return c ? c[1] : ""; };

async function getJson(u){ const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(6000) }); return r.ok ? r.json() : null; }

module.exports = async (req, res) => {
  if (!(await memberUser(req))) return res.status(401).json({ ok: false, error: "No autorizado" });
  let u; try { u = new URL(String(req.query.url || "")); } catch { return res.status(400).json({ ok: false, error: "Link inválido" }); }
  if (!/^https?:$/.test(u.protocol)) return res.status(400).json({ ok: false, error: "Link inválido" });
  const net = netOf(u.hostname.toLowerCase());
  if (!net) return res.status(200).json({ ok: true, net: null });
  try {
    let out = { net, title: "", text: "", img: "" };
    if (net === "TikTok" || net === "YouTube"){
      const j = await getJson(net === "TikTok" ? `https://www.tiktok.com/oembed?url=${encodeURIComponent(u.href)}` : `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u.href)}`);
      if (j) out = { net, title: cut(j.author_name ? `${j.author_name}` : "", 80), text: cut(j.title || "", 160), img: j.thumbnail_url || "" };
    } else {
      // Instagram y Facebook muestran sus datos públicos (og:) al lector de vistas previas.
      const r = await fetch(u.href, { headers: { "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "Accept-Language": "es" }, redirect: "follow", signal: AbortSignal.timeout(6000) });
      const html = r.ok ? (await r.text()).slice(0, 400000) : "";
      out = { net, title: cut(meta(html, "og:title"), 90), text: cut(meta(html, "og:description"), 170), img: dec(meta(html, "og:image")) };
    }
    if (!/^https:\/\//.test(out.img)) out.img = "";
    res.setHeader("Cache-Control", "private, max-age=86400");
    return res.status(200).json({ ok: true, ...out });
  } catch (e){
    return res.status(200).json({ ok: true, net, title: "", text: "", img: "" }); // sin vista previa: queda el link
  }
};
