// v428 · Influencers (Community Manager): las publicaciones de Instagram de los influencers que trabajan con las marcas.
// Se llama desde /api/referentes?set=influ (el plan gratis de Vercel permite solo 12 funciones en api/; esta carpeta no cuenta).
// Usa Business Discovery de Meta, igual que la Competencia: con nuestra cuenta de Instagram de empresa se leen las
// publicaciones públicas (feed, carrusel y reel) de otras cuentas de empresa o creador, con sus me gusta y comentarios.
// Las historias de otras cuentas no se pueden leer así (llegan solo como mención por el webhook, en s:META_DM).
//
// Lee de la base (read_meta): la lista de influencers que se carga en la app (s:INFLU_PLAN: [{ id, name, ig:[usuarios], brands }]),
// los links que se cargaron a mano (s:INFLU_MARKS) y lo que ya se guardó (s:META_INFLU). Si no puede leer la lista, usa DEFAULT.
// Guarda en s:META_INFLU (la base junta por arriba, así que cada mes es una clave aparte y no se pisa):
//   { updated, error, accounts: { <usuario>: { u, name, fol, n, pic, err, at } },
//     "m2026-11": { <id>: { id, u, ts, type, link, cap, likes, comments, img, br:[marcas], ln } } }
// Se guarda solo lo que nombra a una marca (Superseis, Delimarket, Bianca…: su @ o su nombre en el texto) o lo que alguien
// ya cargó a mano con su link (ln: true), del mes actual y del anterior. Los meses de hace más de 14 meses se borran.

const DEFAULT = [
  { name: "Tania Domaniczky", ig: ["taniadoma"], brands: ["Superseis", "Delimarket"] },
  { name: "Carlos Ortellado", ig: ["carlitosortellado"], brands: ["Superseis", "Delimarket"] },
  { name: "Pedro Rüger", ig: ["enelhornoconpeta"], brands: ["Superseis", "Bianca"] },
  { name: "Ale Vargas", ig: ["alevargasasiain"], brands: ["Superseis", "Delimarket"] },
  { name: "Edu Vargas", ig: ["dhudux"], brands: ["Superseis", "Delimarket"] },
  { name: "Silvia Romero", ig: ["silromeroo"], brands: ["Superseis", "Delimarket"] },
  { name: "Tito Torres y Stephanie Ríos", ig: ["ivan_torres11", "stephaniertg"], brands: ["Superseis", "Delimarket"] },
];
// Palabras que cuentan como la marca aunque no la arroben (sin mayúsculas ni acentos). Stock es muy común como palabra:
// cuenta solo su @. Bianca solo si el influencer trabaja con Bianca (también es un nombre).
const PALABRAS = { Superseis: ["superseis", "super seis", "super6"], Delimarket: ["delimarket", "deli market"], Bianca: ["bianca"] };
const MEDIA = 36;          // últimas publicaciones que se piden por cuenta
const FIELDS = [
  (u) => `business_discovery.username(${u}){username,name,followers_count,media_count,profile_picture_url,media.limit(${MEDIA}){id,media_type,media_product_type,media_url,thumbnail_url,permalink,caption,timestamp,like_count,comments_count}}`,
  (u) => `business_discovery.username(${u}){username,name,followers_count,media_count,media.limit(${MEDIA}){id,media_type,media_product_type,media_url,thumbnail_url,permalink,caption,timestamp,like_count,comments_count}}`,
  (u) => `business_discovery.username(${u}){username,name,followers_count,media.limit(${MEDIA}){media_type,media_product_type,media_url,permalink,caption,timestamp,like_count,comments_count}}`,
];

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const user = (u) => String(u || "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").toLowerCase();
const okUser = (u) => /^[a-z0-9._]{1,30}$/.test(u);
// El código de la publicación en su link (instagram.com/p/CODIGO, /reel/CODIGO…): así se reconoce un link cargado a mano.
const code = (link) => (String(link || "").match(/instagram\.com\/(?:[A-Za-z0-9._]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/i) || [])[1] || null;
const TYPE = (m) => m.media_product_type === "REELS" ? "Reel" : m.media_type === "CAROUSEL_ALBUM" ? "Carrusel" : m.media_type === "VIDEO" ? "Video" : "Post";
const num = (v) => (Number.isFinite(v) ? v : null);
const short = (s, n) => Array.from(String(s || "")).slice(0, n).join("");
const conTiempo = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("Instagram tardó demasiado")), ms))]);
// Mes en Paraguay (AAAA-MM) de una fecha, y el mes anterior.
const pyMonth = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion" }).format(new Date(t)).slice(0, 7);
const prevMonth = (m) => { const [y, mm] = m.split("-").map(Number); return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, "0")}`; };
const monthsBack = (m, k) => { let x = m; for (let i = 0; i < k; i++) x = prevMonth(x); return x; };

// ¿Qué marcas nombra el texto? Su @ (sin que siga otra letra de usuario) o su nombre.
function brandsIn(cap, handles, allowed){
  const t = fold(cap), out = [];
  for (const [b, h] of Object.entries(handles)){
    const at = h && new RegExp(`@${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9_]|\\.[a-z0-9_])`).test(t);
    const word = (PALABRAS[b] || []).some((w) => (b !== "Bianca" || allowed.has("Bianca")) && t.includes(w));
    if (at || word) out.push(b);
  }
  for (const b of Object.keys(PALABRAS)) if (!out.includes(b) && !handles[b] && (b !== "Bianca" || allowed.has("Bianca")) && PALABRAS[b].some((w) => t.includes(w))) out.push(b);
  return out;
}

async function influencers({ me, byBrand, graph, save, readMeta, dry }){
  const [plan, marks, prev] = await Promise.all(["s:INFLU_PLAN", "s:INFLU_MARKS", "s:META_INFLU"].map((k) => readMeta(k).catch(() => null)));
  const list = Array.isArray(plan) && plan.some((x) => x && Array.isArray(x.ig) && x.ig.length) ? plan.filter((x) => x && !x.off) : DEFAULT;
  const users = new Map(); // usuario → marcas con las que trabaja
  list.forEach((x) => (x.ig || []).map(user).filter(okUser).forEach((u) => users.set(u, new Set([...(users.get(u) || []), ...(x.brands || [])]))));
  const linked = new Set((Array.isArray(marks) ? marks : []).map((m) => code(m && m.link)).filter(Boolean));
  const handles = {};
  Object.entries(byBrand || {}).forEach(([b, p]) => { const h = String(p?.handle || "").replace(/^@/, "").toLowerCase(); if (h) handles[b] = h; });
  const cur = pyMonth(Date.now()), months = [prevMonth(cur), cur], fresh = Object.fromEntries(months.map((m) => [m, {}]));
  const accounts = {}, summary = {};
  const una = async (u) => {
    let err = null;
    for (const f of FIELDS){
      try {
        const bd = (await conTiempo(graph(`/${me}`, { fields: f(u) }), 9000)).business_discovery || {};
        let n = 0;
        (bd.media?.data || []).forEach((m) => {
          if (!m || !m.timestamp || m.media_product_type === "STORY") return;
          const mo = pyMonth(m.timestamp); if (!fresh[mo]) return;
          const br = brandsIn(m.caption, handles, users.get(u) || new Set()), c = code(m.permalink), ln = !!(c && linked.has(c));
          if (!br.length && !ln) return;
          const id = String(m.id || c || m.permalink || m.timestamp);
          const img = /^https:\/\//.test(m.thumbnail_url || "") ? m.thumbnail_url : /^https:\/\//.test(m.media_url || "") && m.media_type !== "VIDEO" ? m.media_url : "";
          fresh[mo][id] = { id, u, ts: m.timestamp, type: TYPE(m), link: m.permalink || null, cap: short(m.caption, 300), likes: num(m.like_count), comments: num(m.comments_count), img, br, ...(ln && !br.length ? { ln: true } : {}) };
          n++;
        });
        accounts[u] = { u: bd.username || u, name: bd.name || null, fol: num(bd.followers_count), n: num(bd.media_count), pic: /^https:\/\//.test(bd.profile_picture_url || "") ? bd.profile_picture_url : null, err: null, at: new Date().toISOString() };
        summary[u] = n; return;
      } catch (e){
        err = e.message;
        if (e.code !== 100) break; // 100: Meta no conoce algún campo → se prueba con menos; otro error (cuenta personal, no existe): se corta
      }
    }
    const old = prev?.accounts?.[u];
    accounts[u] = { ...(old || {}), u, err: err || "No se encontró la cuenta", at: new Date().toISOString() };
    summary[u] = "error";
  };
  const q = [...users.keys()];
  await Promise.all(Array.from({ length: Math.min(4, q.length) }, async () => { while (q.length) await una(q.shift()); }));
  const payload = { updated: new Date().toISOString(), error: null, accounts };
  months.forEach((m) => { const old = prev && prev["m" + m] && typeof prev["m" + m] === "object" ? prev["m" + m] : {}; payload["m" + m] = { ...old, ...fresh[m] }; });
  const cutoff = monthsBack(cur, 14);
  Object.keys(prev || {}).forEach((k) => { if (/^m\d{4}-\d{2}$/.test(k) && k.slice(1) < cutoff) payload[k] = null; }); // la base borra las claves en null
  if (!dry) await save("s:META_INFLU", payload);
  return { summary, posts: months.map((m) => Object.keys(fresh[m]).length), plan: list === DEFAULT ? "lista de arranque" : "lista de la app" };
}

module.exports = { influencers, brandsIn, code, user, DEFAULT };
