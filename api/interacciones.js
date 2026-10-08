// Los comentarios que arroban a la marca (@cuenta) en sus publicaciones de los últimos 30 días → s:META_IG_ACT (lo arma
// la RPC ingest_ig_act: suma por id y no borra lo que llegó por el webhook, que además trae los comentarios con @marca
// en publicaciones de otras cuentas: campo mentions). Solo esos: los demás comentarios no se guardan.
//   { "Superseis": { handle, pulled, err, diag:{ posts, revisados, arrobas }, posts:{ <id>: { link, cap, img } }, items:[ … ] }, updated }
//   comentario: { id:"c<id>", kind:"comment", who:"@usuario", t, ts, likes, parent?, answered, m:<id de la publicación> }
// "answered": la marca le contestó en la misma conversación (después del comentario).
// Con acceso estándar Meta no da el usuario de quien comenta (username): la respuesta de la marca se reconoce por "user"
// (Meta solo lo manda en los comentarios de la propia cuenta) o por from.id.
// La llaman: el cron de Vercel (dos veces por día) y el botón “Actualizar” de Mensajes → Menciones (Admin o CM).
// Permisos del META_TOKEN: instagram_basic, instagram_manage_comments y pages_read_engagement.
// Probar sin guardar:  /api/interacciones?dry=1&secret=EL_CRON_SECRET
const { ORDEN, cronOrUser, graph, brandPages, igAct, arroba, tokenHint } = require("./_lib/meta");

const DAYS = 30;     // publicaciones de los últimos 30 días
const POSTS = 15;    // tope de publicaciones con comentarios por marca
const PER = 50;      // comentarios por publicación
const REQ_MS = 12000, STOP = 45000;
const short = (s, n = 300) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const iso = t => { const d = new Date(t); return isNaN(d) ? new Date().toISOString() : d.toISOString(); };
const fresh = m => Date.now() - new Date(m.timestamp).getTime() <= DAYS * 864e5;
const postOf = m => ({ link: m.permalink || null, cap: short(m.caption, 90) || null, img: m.thumbnail_url || m.media_url || null });
const noPerm = e => e.code === 10 || e.code === 200;
const permErr = e => noPerm(e) ? " (falta el permiso instagram_manage_comments en el token)" : "";
// Campos de los comentarios: si Meta no conoce alguno en esta versión (error 100), se pide con menos.
const CFIELDS = ["id,text,timestamp,username,from,user,like_count,replies{id,text,timestamp,username,from,user}",
  "id,text,timestamp,username,user,like_count,replies{id,text,timestamp,username,user}",
  "id,text,timestamp,username,like_count,replies{id,text,timestamp,username}"];
async function pool(list, n, fn){ const q = [...list]; await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length) await fn(q.shift()); })); }

// Una conversación (comentario y sus respuestas) → los comentarios de la gente que arroban a la marca, con "answered" si
// la marca contestó después.
function threadItems(c, mId, me, igId){
  const all = [{ ...c, parent: null }, ...((c.replies && c.replies.data) || []).map(r => ({ ...r, parent: c.id }))];
  const name = x => x.username || x.from?.username || "";
  const isMe = x => !!x.user || (!!igId && String(x.from?.id || "") === String(igId)) || (!!me && name(x).toLowerCase() === me);
  const mine = all.filter(isMe).map(x => iso(x.timestamp));
  return [...all.filter(x => !isMe(x) && arroba(x.text, me)).map(x => ({
    id: "c" + x.id, kind: "comment", who: name(x) ? "@" + name(x) : null, t: short(x.text), ts: iso(x.timestamp),
    likes: x.like_count ?? null, parent: x.parent ? "c" + x.parent : null, answered: mine.some(ts => ts > iso(x.timestamp)), m: String(mId),
  })),
  // Los de la marca no son ítems; si alguno quedó guardado como de una persona (antes no se reconocían), se marca "mine".
  ...all.filter(isMe).map(x => ({ id: "c" + x.id, mine: true, upd: true }))];
}

async function brandAct(g, p){
  const me = String(p.handle || "").replace(/^@/, "").toLowerCase(), items = [], errs = [], posts = {}, diag = { posts: 0, revisados: 0, arrobas: 0 };
  try {
    const j = await g(`/${p.igId}/media`, { fields: "id,caption,permalink,timestamp,media_type,thumbnail_url,media_url,comments_count", limit: "30" });
    const list = (j.data || []).filter(m => fresh(m) && (m.comments_count || 0) > 0).slice(0, POSTS);
    diag.posts = list.length;
    let fi = 0;
    await pool(list, 5, async m => {
      try {
        let c;
        for (;;){ const f = fi; try { c = await g(`/${m.id}/comments`, { fields: CFIELDS[f], limit: String(PER) }); break; }
          catch (e){ if (e.code === 100 && f < CFIELDS.length - 1){ fi = Math.max(fi, f + 1); continue; } throw e; } }
        (c.data || []).forEach(x => { diag.revisados += 1 + ((x.replies && x.replies.data) || []).length; });
        const got = (c.data || []).flatMap(x => threadItems(x, m.id, me, p.igId));
        if (got.some(x => !x.upd)) posts[m.id] = postOf(m);
        items.push(...got);
      } catch (e){ if (!errs.some(x => x.startsWith("Comentarios"))) errs.push(`Comentarios: ${e.message}${permErr(e)}`); }
    });
  } catch (e){ errs.push(`Publicaciones: ${e.message}${permErr(e)}`); }
  const marks = items.filter(x => x.upd).slice(0, 200), people = items.filter(x => !x.upd).sort((a, c) => c.ts.localeCompare(a.ts));
  const keep = [...people.slice(0, 250), ...marks], used = new Set(keep.map(x => x.m).filter(Boolean));
  diag.arrobas = people.length;
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
