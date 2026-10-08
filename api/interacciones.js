// Comentarios y etiquetas de Instagram de cada marca → s:META_IG_ACT (lo arma la RPC ingest_ig_act: suma por id y no
// borra lo que llegó por el webhook, que además trae los comentarios en vivo y las menciones con @).
//   { "Superseis": { handle, pulled, err, diag:{ posts, comentarios, etiquetas }, posts:{ <id>: { link, cap, img } }, items:[ … ] }, updated }
//   comentario: { id:"c<id>", kind:"comment", who:"@usuario", t, ts, likes, parent?, answered, m:<id de la publicación> }
//   etiqueta:   { id:"t<id>", kind:"tag", who, t:(texto de la publicación), ts, media:{ link, img } }
// "answered": la marca le contestó en la misma conversación (después del comentario).
// La llaman: el cron de Vercel (dos veces por día) y el botón “Actualizar” de Mensajes → Comentarios (Admin o CM).
// Permisos del META_TOKEN: instagram_basic, instagram_manage_comments y pages_read_engagement.
// Probar sin guardar:  /api/interacciones?dry=1&secret=EL_CRON_SECRET
const { ORDEN, cronOrUser, graph, brandPages, igAct, tokenHint } = require("./_lib/meta");

const DAYS = 30;     // publicaciones de los últimos 30 días
const POSTS = 15;    // tope de publicaciones con comentarios por marca
const PER = 50;      // comentarios por publicación
const REQ_MS = 12000, STOP = 45000;
const short = (s, n = 300) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const iso = t => { const d = new Date(t); return isNaN(d) ? new Date().toISOString() : d.toISOString(); };
const fresh = m => Date.now() - new Date(m.timestamp).getTime() <= DAYS * 864e5;
const postOf = m => ({ link: m.permalink || null, cap: short(m.caption, 90) || null, img: m.thumbnail_url || m.media_url || null });
const permErr = e => e.code === 10 || e.code === 200 ? " (falta el permiso instagram_manage_comments en el token)" : "";
async function pool(list, n, fn){ const q = [...list]; await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length) await fn(q.shift()); })); }

// Una conversación (comentario y sus respuestas) → ítems de la gente, con "answered" si la marca contestó después.
function threadItems(c, mId, me){
  const all = [{ ...c, parent: null }, ...((c.replies && c.replies.data) || []).map(r => ({ ...r, parent: c.id }))];
  const mine = all.filter(x => String(x.username || "").toLowerCase() === me).map(x => iso(x.timestamp));
  return all.filter(x => String(x.username || "").toLowerCase() !== me).map(x => ({
    id: "c" + x.id, kind: "comment", who: x.username ? "@" + x.username : null, t: short(x.text), ts: iso(x.timestamp),
    likes: x.like_count ?? null, parent: x.parent ? "c" + x.parent : null, answered: mine.some(ts => ts > iso(x.timestamp)), m: String(mId),
  }));
}

async function brandAct(g, p){
  const me = String(p.handle || "").replace(/^@/, "").toLowerCase(), items = [], errs = [], posts = {}, diag = { posts: 0, comentarios: 0, etiquetas: 0 };
  try {
    const j = await g(`/${p.igId}/media`, { fields: "id,caption,permalink,timestamp,media_type,thumbnail_url,media_url,comments_count", limit: "30" });
    const list = (j.data || []).filter(m => fresh(m) && (m.comments_count || 0) > 0).slice(0, POSTS);
    diag.posts = list.length;
    await pool(list, 5, async m => {
      try {
        const c = await g(`/${m.id}/comments`, { fields: "id,text,timestamp,username,like_count,replies{id,text,timestamp,username}", limit: String(PER) });
        const got = (c.data || []).flatMap(x => threadItems(x, m.id, me));
        if (got.length){ posts[m.id] = postOf(m); items.push(...got); }
      } catch (e){ if (!errs.some(x => x.startsWith("Comentarios"))) errs.push(`Comentarios: ${e.message}${permErr(e)}`); }
    });
    diag.comentarios = items.length;
  } catch (e){ errs.push(`Publicaciones: ${e.message}${permErr(e)}`); }
  try {
    const t = await g(`/${p.igId}/tags`, { fields: "id,caption,permalink,timestamp,username,media_type,thumbnail_url,media_url", limit: "25" });
    (t.data || []).filter(fresh).forEach(m => { const x = postOf(m);
      items.push({ id: "t" + m.id, kind: "tag", who: m.username ? "@" + m.username : null, t: short(m.caption), ts: iso(m.timestamp), media: { link: x.link, img: x.img } }); diag.etiquetas++; });
  } catch (e){ errs.push(`Etiquetas: ${e.message}${permErr(e)}`); }
  items.sort((a, c) => c.ts.localeCompare(a.ts));
  const keep = items.slice(0, 250), used = new Set(keep.map(x => x.m).filter(Boolean));
  return { items: keep, info: { handle: p.handle || null, pulled: new Date().toISOString(), err: errs.length ? errs.join(" · ") : null, diag,
    posts: Object.fromEntries(Object.entries(posts).filter(([id]) => used.has(id))) } };
}

module.exports = async (req, res) => {
  const t0 = Date.now();
  // Cada consulta a Meta espera como mucho REQ_MS; pasados STOP no se piden más (Vercel corta a los 60 s).
  const g = async (path, params) => {
    if (Date.now() - t0 > STOP) throw new Error("se terminó el tiempo");
    let timer;
    try { return await Promise.race([graph(path, params), new Promise((_, no) => { timer = setTimeout(() => no(new Error("Meta tardó demasiado en responder")), REQ_MS); })]); }
    finally { clearTimeout(timer); }
  };
  const who = await cronOrUser(req), cron = who === "cron";
  if (!who) return res.status(401).json({ ok: false, error: "No autorizado" });
  if (!process.env.META_TOKEN) return res.status(500).json({ ok: false, error: "Falta la variable META_TOKEN en Vercel" });
  const dry = req.query.dry === "1" && cron;
  try {
    const { byBrand } = await brandPages(), summary = {};
    await Promise.all(ORDEN.filter(b => byBrand[b]?.igId).map(async b => {
      const r = await brandAct(g, byBrand[b]);
      if (!dry) await igAct(b, r.items, r.info);
      summary[b] = { ...r.info.diag, err: r.info.err };
    }));
    console.log(`[interacciones] ${JSON.stringify(summary)}${dry ? " (prueba, sin guardar)" : " guardados"}`);
    return res.status(200).json({ ok: true, dry, saved: !dry, summary });
  } catch (e){
    console.error(`[${req.url}] ERROR: ${e.message}${e.code ? ` (código ${e.code})` : ""}`);
    return res.status(500).json({ ok: false, error: e.message, hint: tokenHint(e) });
  }
};
