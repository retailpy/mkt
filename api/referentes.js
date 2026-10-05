// Publicaciones de Instagram de los supermercados de referencia (afiches, posteos y carruseles; sin reels).
// Usa Business Discovery de Meta: con nuestra cuenta de Instagram de empresa se leen las publicaciones públicas
// de otras cuentas de empresa. Guarda en app_state → s:META_REFS:
//   { "updated": "...", "accounts": { "paodeacucar": { name, cc, err, posts: [ { img, link, ts, type, cap } ] }, ... } }
// Lo usa Tendencias (Diseño y CM) → “Visuales de campañas”. Pão de Açúcar va siempre primero.
// Las imágenes de Instagram vencen a los pocos días: por eso corre todos los días.
//
// La llaman: el cron diario de Vercel y el botón “Actualizar” de Tendencias (con la sesión de Admin total, Admin o CM).
// Probar sin guardar:  /api/referentes?dry=1&secret=EL_CRON_SECRET
const { ORDEN, cronOrUser, graph, brandPages, save, tokenHint } = require("./_lib/meta");

// Cuenta de Instagram → nombre de la cadena y país (para la banderita). Si un usuario no existe, queda el error y sigue.
const CUENTAS = {
  salemma_super: ["Salemma", "PY"], realsupermercados: ["Real", "PY"],
  paodeacucar: ["Pão de Açúcar", "BR"], carrefourbrasil: ["Carrefour Brasil", "BR"], stmarche: ["St. Marche", "BR"],
  citymarketmx: ["City Market", "MX"],
  ametllerorigen: ["Ametller Origen", "ES"], mercadona: ["Mercadona", "ES"], elcorteingles: ["El Corte Inglés", "ES"],
  wholefoods: ["Whole Foods", "US"], traderjoes: ["Trader Joe's", "US"], target: ["Target", "US"], wegmans: ["Wegmans", "US"],
  waitrose: ["Waitrose", "GB"], marksandspencer: ["M&S Food", "GB"], tesco: ["Tesco", "GB"], sainsburys: ["Sainsbury's", "GB"],
  monoprix: ["Monoprix", "FR"], albertheijn: ["Albert Heijn", "NL"], lidlespana: ["Lidl", "DE"], jumbochile: ["Jumbo", "CL"],
};
const POR_CUENTA = 8;   // publicaciones guardadas por cuenta
const DIAS = 45;        // solo lo reciente (lo de la temporada)
const FIELDS = (u) => `business_discovery.username(${u}){username,name,media.limit(18){media_type,media_product_type,media_url,permalink,caption,timestamp}}`;

module.exports = async (req, res) => {
  const who = await cronOrUser(req);
  if (!who) return res.status(401).json({ ok: false, error: "No autorizado" });
  if (!process.env.META_TOKEN) return res.status(500).json({ ok: false, error: "Falta la variable META_TOKEN en Vercel" });
  const dry = req.query.dry === "1" && who === "cron";
  try {
    const { byBrand } = await brandPages();
    const me = ORDEN.map(b => byBrand[b]?.igId).find(Boolean); // cualquier Instagram de empresa nuestro sirve para consultar
    if (!me) throw new Error("No hay ninguna cuenta de Instagram de empresa vinculada a las páginas");
    const desde = Date.now() - DIAS * 86400000, accounts = {}, summary = {};
    // De a 5 cuentas a la vez (Vercel corta las funciones lentas), cada consulta con su propio límite de tiempo.
    const una = async ([u, [name, cc]]) => {
      try {
        const j = await Promise.race([graph(`/${me}`, { fields: FIELDS(u) }), new Promise((_, no) => setTimeout(() => no(new Error("Instagram tardó demasiado")), 9000))]);
        const media = j.business_discovery?.media?.data || [];
        const posts = media
          .filter(m => m.media_product_type !== "REELS" && m.media_product_type !== "STORY" && (m.media_type === "IMAGE" || m.media_type === "CAROUSEL_ALBUM"))
          .filter(m => m.media_url && /^https:\/\//.test(m.media_url) && new Date(m.timestamp).getTime() >= desde)
          .slice(0, POR_CUENTA)
          .map(m => ({ img: m.media_url, link: m.permalink, ts: m.timestamp, type: m.media_type === "CAROUSEL_ALBUM" ? "Carrusel" : "Post", cap: String(m.caption || "").slice(0, 160) }));
        accounts[u] = { name, cc, err: null, posts };
        summary[u] = posts.length;
      } catch (e){
        accounts[u] = { name, cc, err: e.message, posts: [] };
        summary[u] = "error";
      }
    };
    const lista = Object.entries(CUENTAS);
    for (let i = 0; i < lista.length; i += 5) await Promise.all(lista.slice(i, i + 5).map(una));
    const payload = { updated: new Date().toISOString(), accounts, error: null };
    if (!dry) await save("s:META_REFS", payload);
    console.log(`[referentes] ${JSON.stringify(summary)}${dry ? " (prueba, sin guardar)" : " guardadas"}`);
    return res.status(200).json({ ok: true, dry, saved: !dry, summary });
  } catch (e){
    console.error(`[${req.url}] ERROR: ${e.message}${e.code ? ` (código ${e.code})` : ""}`);
    if (!dry) await save("s:META_REFS", { error: `${e.message}${tokenHint(e) ? " — " + tokenHint(e) : ""}`, errorAt: new Date().toISOString() }).catch(() => {}); // la app muestra el motivo
    return res.status(500).json({ ok: false, error: e.message, hint: tokenHint(e) });
  }
};
