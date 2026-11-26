// Publicaciones de Instagram de los supermercados de referencia (afiches, posteos y carruseles; sin reels).
// Usa Business Discovery de Meta: con nuestra cuenta de Instagram de empresa se leen las publicaciones públicas
// de otras cuentas de empresa. Guarda en app_state → s:META_REFS:
//   { "updated": "...", "accounts": { "paodeacucar": { name, cc, err, posts: [ { img, link, ts, type, cap } ] }, ... } }
// Lo usa Tendencias (Diseño y CM) → “Visuales de campañas”. Pão de Açúcar va siempre primero.
// Las imágenes de Instagram vencen a los pocos días: por eso corre todos los días.
//
// La llaman: el cron diario de Vercel y el botón “Actualizar” de Tendencias (con la sesión de Admin total, Admin o CM).
// Con ?set=local trae la competencia nacional (Resumen ejecutivo; ver LOCALES).
// Con ?set=influ (v428) trae las publicaciones de los influencers de las marcas → s:META_INFLU (ver _lib/influencers.js).
// Probar sin guardar:  /api/referentes?dry=1&secret=EL_CRON_SECRET
const { ORDEN, cronOrUser, graph, brandPages, save, readMeta, tokenHint } = require("./_lib/meta");
const { influencers } = require("./_lib/influencers");

// Cuenta de Instagram → nombre de la cadena y país (para la banderita). Si un usuario no existe, queda el error y sigue.
// Solo supermercados de afuera: la idea es inspirarse con gráficas internacionales (nada de Paraguay).
const CUENTAS = {
  paodeacucar: ["Pão de Açúcar", "BR"], carrefourbrasil: ["Carrefour Brasil", "BR"], stmarche: ["St. Marche", "BR"],
  citymarketmx: ["City Market", "MX"],
  ametllerorigen: ["Ametller Origen", "ES"], mercadona: ["Mercadona", "ES"], elcorteingles: ["El Corte Inglés", "ES"],
  wholefoods: ["Whole Foods", "US"], traderjoes: ["Trader Joe's", "US"], target: ["Target", "US"], wegmans: ["Wegmans", "US"],
  waitrose: ["Waitrose", "GB"], marksandspencer: ["M&S Food", "GB"], tesco: ["Tesco", "GB"], sainsburys: ["Sainsbury's", "GB"],
  monoprix: ["Monoprix", "FR"], albertheijn: ["Albert Heijn", "NL"], lidlespana: ["Lidl", "DE"], jumbochile: ["Jumbo", "CL"],
};
// v401 · Competencia nacional (Paraguay), para el Resumen ejecutivo (reunión con el CEO): qué publican Casa Rica, Real,
// Luisito, Pueblo, Areté, Los Jardines, Fortis, SuperMás, Kingo y Plub. Se lee aparte (?set=local, con su propio horario) para no
// pasar el límite de tiempo de Vercel, y se guarda en s:META_REFS.local (la base junta por arriba: no pisa los de afuera; si falla todo, queda lo anterior y el motivo en localError,
// y Tendencias sigue mostrando solo los de afuera). Cada cadena tiene sus usuarios de Instagram posibles: vale el primero
// que Instagram encuentra (si ninguno, queda el error y la pantalla lo dice).
const LOCALES = [
  ["casarica", "Casa Rica", ["casaricapy"]],
  ["real", "Real", ["cadenareal"]], // v408: confirmado por Admin total
  ["luisito", "Luisito", ["hipermercadosluisitopy", "hipermercados_luisito"]],
  ["pueblo", "Pueblo", ["hiperpueblo"]], // v404: Hiper Pueblo (Grupo Pueblo) · v408: confirmado
  ["arete", "Areté", ["aretesupermercados", "aretepy"]],
  ["losjardines", "Los Jardines", ["losjardinespy"]],
  ["fortis", "Fortis", ["fortispy", "fortisparaguay"]],
  ["supermas", "SuperMás", ["supermas.py"]],
  ["kingo", "Kingo", ["kingosupermercados"]],
  ["plub", "Plub", ["somos_plub"]], // v408: confirmado por Admin total
];
const L_POSTS = 30, L_DIAS = 40; // lo de los últimos 40 días (para ver la semana y el mes), hasta 30 por cadena
const L_FIELDS = (u) => `business_discovery.username(${u}){username,name,followers_count,media_count,media.limit(30){media_type,media_product_type,media_url,thumbnail_url,permalink,caption,timestamp,like_count,comments_count}}`;
const L_TYPE = (m) => m.media_product_type === "REELS" ? "Reel" : m.media_type === "CAROUSEL_ALBUM" ? "Carrusel" : m.media_type === "VIDEO" ? "Video" : "Post";
const conTiempo = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("Instagram tardó demasiado")), ms))]);
async function competenciaLocal(me){
  const desde = Date.now() - L_DIAS * 86400000, accounts = {}, summary = {};
  await Promise.all(LOCALES.map(async ([k, name, users]) => {
    let err = null;
    for (const u of users){
      try {
        const j = await conTiempo(graph(`/${me}`, { fields: L_FIELDS(u) }), 8000), bd = j.business_discovery || {};
        const posts = (bd.media?.data || [])
          .filter((m) => m.media_product_type !== "STORY" && new Date(m.timestamp).getTime() >= desde)
          .map((m) => ({ img: /^https:\/\//.test(m.thumbnail_url || "") ? m.thumbnail_url : /^https:\/\//.test(m.media_url || "") && m.media_type !== "VIDEO" ? m.media_url : "",
            link: m.permalink, ts: m.timestamp, type: L_TYPE(m), cap: Array.from(String(m.caption || "")).slice(0, 400).join(""),
            likes: Number.isFinite(m.like_count) ? m.like_count : null, comments: Number.isFinite(m.comments_count) ? m.comments_count : null }))
          .slice(0, L_POSTS);
        accounts[k] = { name, u: bd.username || u, fol: Number.isFinite(bd.followers_count) ? bd.followers_count : null, err: null, posts };
        summary[k] = posts.length; return;
      } catch (e){ err = e.message; }
    }
    accounts[k] = { name, u: users[0], fol: null, err: err || "No se encontró la cuenta", posts: [] };
    summary[k] = "error";
  }));
  return { accounts, summary };
}

const POR_CUENTA = 8;   // publicaciones guardadas por cuenta
const DIAS = 45;        // solo lo reciente (lo de la temporada)
// v405: también seguidores, me gusta y comentarios (Resumen ejecutivo → Internacional: lo que más les funcionó).
const FIELDS = (u) => `business_discovery.username(${u}){username,name,followers_count,media.limit(18){media_type,media_product_type,media_url,permalink,caption,timestamp,like_count,comments_count}}`;

module.exports = async (req, res) => {
  const who = await cronOrUser(req);
  if (!who) return res.status(401).json({ ok: false, error: "No autorizado" });
  if (!process.env.META_TOKEN) return res.status(500).json({ ok: false, error: "Falta la variable META_TOKEN en Vercel" });
  const dry = req.query.dry === "1" && who === "cron", local = req.query.set === "local", influ = req.query.set === "influ";
  try {
    const { byBrand } = await brandPages();
    const me = ORDEN.map(b => byBrand[b]?.igId).find(Boolean); // cualquier Instagram de empresa nuestro sirve para consultar
    if (!me) throw new Error("No hay ninguna cuenta de Instagram de empresa vinculada a las páginas");
    if (influ){ // v428: influencers → s:META_INFLU
      const r = await influencers({ me, byBrand, graph, save, readMeta, dry });
      console.log(`[referentes influ] ${JSON.stringify(r)}${dry ? " (prueba, sin guardar)" : " guardadas"}`);
      return res.status(200).json({ ok: true, dry, saved: !dry, ...r });
    }
    if (local){ // v401: competencia nacional → s:META_REFS.local
      const { accounts, summary } = await competenciaLocal(me);
      if (!dry) await save("s:META_REFS", { local: { updated: new Date().toISOString(), accounts }, localError: null });
      console.log(`[referentes local] ${JSON.stringify(summary)}${dry ? " (prueba, sin guardar)" : " guardadas"}`);
      return res.status(200).json({ ok: true, dry, saved: !dry, summary });
    }
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
          .map(m => ({ img: m.media_url, link: m.permalink, ts: m.timestamp, type: m.media_type === "CAROUSEL_ALBUM" ? "Carrusel" : "Post", cap: Array.from(String(m.caption || "")).slice(0, 160).join(""),
            likes: Number.isFinite(m.like_count) ? m.like_count : null, comments: Number.isFinite(m.comments_count) ? m.comments_count : null }));
        const fol = j.business_discovery?.followers_count;
        accounts[u] = { name, cc, err: null, fol: Number.isFinite(fol) ? fol : null, posts };
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
    const why = `${e.message}${tokenHint(e) ? " — " + tokenHint(e) : ""}`;
    if (!dry && influ) await save("s:META_INFLU", { error: why, errorAt: new Date().toISOString() }).catch(() => {});
    else if (!dry) await save("s:META_REFS", local ? { localError: why, localErrorAt: new Date().toISOString() } : { error: why, errorAt: new Date().toISOString() }).catch(() => {}); // la app muestra el motivo
    return res.status(500).json({ ok: false, error: e.message, hint: tokenHint(e) });
  }
};
