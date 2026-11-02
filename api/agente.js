// v326 · Oficina de Agentes: SofIA (informe diario de Marketing), MatIAs (pautas de Meta Ads) y ClaudIA (copys).
// La app manda la conversación, lo que cada agente aprendió (entrenamiento, skills y correcciones) y los datos del momento;
// acá se le pregunta a Claude con la clave del servidor (ANTHROPIC_API_KEY en Vercel: nunca llega al navegador).
//   POST { agent:"sofia"|"matias"|"claudia", messages:[{role,content}], context:"…", train:"…", skills:["…"], lessons:["…"], liked:["…"] }
//   (sesión de Admin total o Admin)  →  { ok:true, text:"…" }  o  { ok:false, error:"…", code? }
const Anthropic = require("@anthropic-ai/sdk").default;

const MODEL = "claude-opus-5-5";
const MAX = { context:40000, train:6000, skill:1500, skills:12, lesson:600, lessons:25, liked:3, likedLen:1200, msg:4000, msgs:14 };

const COMMON = `Trabajás en el equipo de Marketing de Retail S.A., en Paraguay: los supermercados Superseis, Stock y Delimarket.
Le hablás al equipo (Admin total y Admin) en español de Paraguay, con voseo ("vos", "tenés", "fijate").
Usá solo los datos que vienen entre <datos> y </datos> y lo que te cuenten en la conversación. Si algo no está en los datos, decilo; nunca inventes números, nombres ni fechas.
Respondé corto y claro: primero lo importante, después el detalle. Usá listas cortas con "- " y **negrita** para lo clave. Nada de tablas grandes ni de títulos con #.`;

const AGENTS = {
  sofia: `Sos SofIA, la agente del informe diario de Marketing.
Tu trabajo: contar en pocas líneas cómo está el día del equipo: qué se publica hoy y mañana, qué está atrasado y de quién, qué pedidos esperan aprobación, cómo le fue a lo publicado ayer en Instagram y quién está más cargado.
Cuando te pidan "el informe de hoy", armalo así: 1) En una frase, cómo viene el día. 2) Lo urgente (atrasados y lo que vence hoy). 3) Lo publicado ayer y su alcance. 4) Carga del equipo. 5) Tres acciones concretas para hoy.`,
  matias: `Sos MatIAs, el analista de pautas de Meta Ads.
Tu trabajo: leer los anuncios y campañas del mes (gasto, alcance, resultados, costo por resultado), compararlos con el presupuesto de cada marca y decir qué funciona, qué no y qué conviene hacer.
Sé concreto: nombrá el anuncio o la campaña, el número que lo respalda y la sugerencia (subir, bajar, pausar, probar otro formato, pautar una publicación que ya funcionó sola). Las monedas: guaraníes (Gs.) para el presupuesto y la moneda que diga cada campaña para el gasto.`,
  claudia: `Sos ClaudIA, la redactora de copys de las redes de las marcas.
Tu trabajo: escribir el texto (copy) de cada publicación según la marca, el formato (post, carrusel, reel, historia o Canal de WhatsApp) y lo que pide el pedido.
Tono por marca, salvo que el entrenamiento diga otra cosa: Superseis, cercano, familiar y de calidad; Stock, ahorro y precio, directo y con energía; Delimarket, gourmet, cálido y de experiencia.
Escribí el copy listo para publicar, sin explicar cómo lo hiciste. Si faltan datos clave (precio, fechas, sucursales, condiciones), dejá el lugar marcado [así] y avisá al final qué falta. Si te piden opciones, dá 2 o 3 distintas.`,
};

const clip = (s, n) => String(s == null ? "" : s).slice(0, n);
const list = (a, n, len) => (Array.isArray(a) ? a : []).map(x => clip(x, len).trim()).filter(Boolean).slice(-n);

// Solo Admin total y Admin (activos). Devuelve el id de la persona.
async function who(req){
  const tok = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const url = process.env.SUPABASE_URL, apikey = process.env.SUPABASE_KEY;
  if (!tok || !url || !apikey || tok === process.env.CRON_SECRET) return null;
  const u = await fetch(`${url}/auth/v1/user`, { headers: { apikey, Authorization: `Bearer ${tok}` } }).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!u?.id) return null;
  const rows = await fetch(`${url}/rest/v1/members?select=role,active,person_id&user_id=eq.${encodeURIComponent(u.id)}`, { headers: { apikey, Authorization: `Bearer ${tok}` } }).then(r => r.ok ? r.json() : []).catch(() => []);
  const m = Array.isArray(rows) && rows.find(x => x.active && ["Admin total", "Admin"].includes(x.role));
  return m ? { id: m.person_id || u.id, role: m.role } : null;
}

// La conversación: empieza con el usuario, se alternan los turnos y termina en el usuario.
function cleanMessages(msgs){
  const out = [];
  (Array.isArray(msgs) ? msgs : []).slice(-MAX.msgs).forEach(m => {
    const role = m?.role === "assistant" ? "assistant" : m?.role === "user" ? "user" : null, content = clip(m?.content, MAX.msg).trim();
    if (!role || !content) return;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += "\n\n" + content;
    else out.push({ role, content });
  });
  while (out.length && out[0].role !== "user") out.shift();
  while (out.length && out[out.length - 1].role !== "user") out.pop();
  return out;
}

function systemFor(id, b){
  const train = clip(b.train, MAX.train).trim(), skills = list(b.skills, MAX.skills, MAX.skill), lessons = list(b.lessons, MAX.lessons, MAX.lesson), liked = list(b.liked, MAX.liked, MAX.likedLen);
  const parts = [COMMON, AGENTS[id]];
  if (train) parts.push(`Cómo tenés que trabajar (te lo enseñó el equipo; tiene prioridad sobre lo anterior):\n${train}`);
  if (skills.length) parts.push(`Tus skills (habilidades que te dio el equipo):\n${skills.map(s => "- " + s).join("\n")}`);
  if (lessons.length) parts.push(`Correcciones que te hizo el equipo (tenelas en cuenta siempre):\n${lessons.map(s => "- " + s).join("\n")}`);
  if (liked.length) parts.push(`Respuestas tuyas que al equipo le gustaron (seguí ese estilo):\n${liked.map(s => "«" + s + "»").join("\n\n")}`);
  return [
    { type: "text", text: parts.join("\n\n") },
    { type: "text", text: `<datos>\n${clip(b.context, MAX.context) || "(sin datos)"}\n</datos>` },
  ];
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Usá POST." });
  const me = await who(req);
  if (!me) return res.status(401).json({ ok: false, error: "Solo Admin total y Admin pueden hablar con los agentes." });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ ok: false, code: "nokey", error: "Falta conectar los agentes con Claude: hay que cargar la clave ANTHROPIC_API_KEY en Vercel." });
  const b = (typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch (e) { return {}; } })() : req.body) || {};
  const id = String(b.agent || "");
  if (!AGENTS[id]) return res.status(400).json({ ok: false, error: "Ese agente no existe." });
  const messages = cleanMessages(b.messages);
  if (!messages.length) return res.status(400).json({ ok: false, error: "Escribí algo para el agente." });

  const client = new Anthropic();
  try {
    const r = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: "medium" },
      // Si los filtros de seguridad frenan un pedido, se vuelve a intentar con el modelo que recomienda Anthropic.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: systemFor(id, b),
      messages,
    });
    if (r.stop_reason === "refusal") return res.status(200).json({ ok: true, refusal: true, text: "Eso prefiero no responderlo. Probá preguntarlo de otra forma." });
    const text = (r.content || []).filter(x => x.type === "text").map(x => x.text).join("\n").trim();
    return res.status(200).json({ ok: true, text: text || "(No me salió una respuesta. Probá de nuevo.)", cut: r.stop_reason === "max_tokens", model: r.model,
      usage: { in: r.usage?.input_tokens || 0, out: r.usage?.output_tokens || 0 } });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return res.status(503).json({ ok: false, code: "nokey", error: "La clave de Claude cargada en Vercel no es válida (o se dio de baja)." });
    if (e instanceof Anthropic.PermissionDeniedError) return res.status(503).json({ ok: false, code: "nokey", error: "La clave de Claude no tiene permiso para este modelo." });
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ ok: false, error: "Hay muchos pedidos a la vez: esperá unos segundos y probá de nuevo." });
    if (e instanceof Anthropic.BadRequestError) return res.status(400).json({ ok: false, error: "Claude no aceptó el pedido: " + clip(e.message, 200) });
    if (e instanceof Anthropic.APIError) return res.status(502).json({ ok: false, error: `Claude no respondió bien (${e.status || "sin código"}). Probá de nuevo en un rato.` });
    return res.status(500).json({ ok: false, error: "No se pudo hablar con Claude. Revisá la conexión y probá de nuevo." });
  }
};
module.exports.cleanMessages = cleanMessages;
module.exports.systemFor = systemFor;
