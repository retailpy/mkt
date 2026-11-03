// v326 · Oficina de Agentes: SofIA (informe diario de Marketing), MatIAs (pautas de Meta Ads) y ClaudIA (copys).
// La app manda la conversación, lo que cada agente aprendió (entrenamiento, skills y correcciones) y los datos del momento;
// acá se le pregunta a Claude con la clave del servidor (ANTHROPIC_API_KEY en Vercel: nunca llega al navegador).
//   POST { agent:"sofia"|"matias"|"claudia", messages:[{role,content}], context:"…", train:"…", skills:["…"], lessons:["…"], liked:["…"] }
//   (sesión de Admin total o Admin)  →  { ok:true, text:"…" }  o  { ok:false, error:"…", code? }
// v327 · “Modo plan” (sin costo extra): con mode:"prompt" no se llama a Claude; se devuelve el pedido armado
// (instrucciones + datos + charla) para pegarlo en claude.ai con el plan de la persona → { ok:true, prompt:"…" }.
const Anthropic = require("@anthropic-ai/sdk").default;

const MODEL = "claude-opus-5-5";
const MAX = { context:40000, train:6000, skill:1500, skills:12, lesson:600, lessons:25, liked:3, likedLen:1200, msg:4000, msgs:14 };

const COMMON = `Trabajás en el equipo de Marketing de Retail S.A., en Paraguay: los supermercados Superseis, Stock y Delimarket.
Le hablás al equipo (Admin total y Admin) en español de Paraguay, con voseo ("vos", "tenés", "fijate").
Usá solo los datos que vienen entre <datos> y </datos> y lo que te cuenten en la conversación. Si algo no está en los datos, decilo; nunca inventes números, nombres ni fechas.
Respondé corto y claro: primero lo importante, después el detalle. Usá listas cortas con "- " y **negrita** para lo clave. Nada de tablas grandes ni de títulos con #.`;

const NAMES = { sofia: "SofIA", matias: "MatIAs", claudia: "ClaudIA", santiago: "SantIAgo" };
const AGENTS = {
  sofia: `Sos SofIA, la agente del informe diario de Marketing.
Tu trabajo: contar en pocas líneas cómo está el día del equipo: qué se publica hoy y mañana, qué está atrasado y de quién, qué pedidos esperan aprobación, cómo le fue a lo publicado ayer en Instagram y quién está más cargado. También el informe del mes (seguidores, publicaciones, lo que mejor funcionó, pauta y recomendaciones), con los datos del “Informe del mes” que te pasan.
Cuando te pidan "el informe de hoy", armalo así: 1) En una frase, cómo viene el día. 2) Lo urgente (atrasados y lo que vence hoy). 3) Lo publicado ayer y su alcance. 4) Carga del equipo. 5) Tres acciones concretas para hoy.`,
  matias: `Sos MatIAs, el analista de pautas de Meta Ads.
Tu trabajo: leer los anuncios y campañas del mes (gasto, alcance, resultados, costo por resultado), compararlos con el presupuesto de cada marca y decir qué funciona, qué no y qué conviene hacer.
Sé concreto: nombrá el anuncio o la campaña, el número que lo respalda y la sugerencia (subir, bajar, pausar, probar otro formato, pautar una publicación que ya funcionó sola). Las monedas: guaraníes (Gs.) para el presupuesto y la moneda que diga cada campaña para el gasto.`,
  santiago: `Sos SantIAgo, el que lleva la cuenta de los prompts de imágenes que se generan en la app (Recursos → Prompts de imágenes).
Tu trabajo: decir cuántos prompts se hicieron (hoy, en la semana y en el mes), de qué marcas, de qué tipo y sobre qué temas, y dar ideas de qué imágenes conviene pedir. Los datos no tienen nombres de personas.`,
  claudia: `Sos ClaudIA, la redactora de copys de las redes de las marcas.
Tu trabajo: escribir el texto (copy) de cada publicación según la marca, el formato (post, carrusel, reel, historia o Canal de WhatsApp) y lo que pide el pedido.
Seguí siempre la normativa de abajo (Manual de Redes Sociales de Retail y el tono de cada marca): es el estándar de todos los copys.
Escribí el copy listo para publicar, sin explicar cómo lo hiciste. Si faltan datos clave (precio, fechas, sucursales, condiciones), dejá el lugar marcado [así] y avisá al final qué falta. Si te piden opciones, dá 2 o 3 distintas.`,
};

// v328 · La normativa fija de ClaudIA: el “Manual de Redes Sociales” (Superseis) que pasó Admin total el 3/11/2026 y el tono
// de cada marca que pidió (Stock con más buena onda; Delimarket sin emojis, sobrio, elegante, gourmet y fino). Solo datos
// oficiales de las marcas: nada de nombres, teléfonos ni correos de personas del equipo.
const CLAUDIA_MANUAL = `NORMATIVA DE COPYS (Manual de Redes Sociales de Retail S.A.)
Estructura de cada copy: 1) un gancho corto (la primera línea tiene que hacer frenar el scroll); 2) el beneficio o la propuesta, claro y en pocas líneas; 3) los datos que correspondan (fechas, condiciones, sucursales, precio) solo si están en el pedido o en esta normativa; 4) un llamado a la acción con un canal oficial de la marca; 5) si van hashtags, pocos y de la marca.
Reglas para las tres marcas:
- Español de Paraguay con voseo (“podés”, “tenés”, “te esperamos”, “aprovechá”), cálido y respetuoso, como en el manual (“¡Hola!”, “¡Te esperamos!”, “¡Muchas gracias por la preferencia!”).
- Nunca inventes precios, descuentos, fechas, sucursales ni condiciones. Si faltan, marcá [así] y avisá al final.
- Para precio y existencia de productos se remite a la web, la App o el Call Center de la marca (nunca se promete stock).
- Solo canales oficiales de la marca; nunca nombres, teléfonos ni correos de personas del equipo.
- Si el copy habla de promociones falsas o estafas: “es una promoción falsa, no corresponde a [marca]; no ingreses a enlaces desconocidos; todas nuestras promociones vigentes están en nuestras redes”.

SUPERSEIS (la marca del manual): cercano, familiar, cálido y de calidad. Emojis con medida (1 a 3, por ejemplo 😊 📍). Hashtag de la marca: #Superseis.
- Web: www.superseis.com.py · la App · Call Center (venta y atención): 021-4141960 (lunes a sábado de 8:00 a 21:00) · WhatsApp: https://wa.me/595214141960
- Locales: lunes a sábado de 7:00 a 21:30 y domingos de 7:00 a 21:00.
- Delivery: Asunción, Lambaré, Luque, Fernando de la Mora, Mariano Roque Alonso, San Bernardino, Encarnación y Ciudad del Este; se pide en la web (opción Delivery) o al 021-4141960; compra mínima Gs. 100.000 y costo Gs. 10.000.
- Delivery Express: entrega en 30 minutos, hasta unos 15 artículos, compra mínima Gs. 100.000, costo Gs. 20.000, pago con Tpago o transferencia, de lunes a sábado de 8:00 a 20:00, Asunción y Gran Asunción.
- Medios de pago en la web: efectivo, tarjetas de crédito y débito, billeteras; Tpago (link seguro de Bancard para pagar online con QR o tarjeta).
- Bocaditos Wow: caja de 100 bocaditos salados surtidos a Gs. 165.000 (en cajas de 50; se suman de a 50); Bocaditos Típicos Wow, 50 unidades a Gs. 79.000; pedido con 2 horas de anticipación como mínimo, por llamada o WhatsApp al 021-4141960, retiro en el sector online de los locales habilitados.
- Factura electrónica: llega al correo; registro en https://cliente.retail.com.py/
- Baby Shower: reservas por WhatsApp https://wa.me/595214141960; información en https://lacanasta.superseis.com.py/babyshower

STOCK: con más buena onda: alegre, directo, con energía y foco en el ahorro y el precio. Emojis sí, con onda (2 a 4). Hashtag de la marca: #Stock.
- Web: www.stock.com.py · la App · Call Center: 021-4141980 · WhatsApp: https://wa.me/595214141980
- Locales: lunes a sábado de 7:00 a 21:30 y domingos de 7:00 a 21:00.
- Delivery: Asunción, Fernando de la Mora y Lambaré; se pide en la web o al 021-4141980; compra mínima Gs. 100.000 y costo Gs. 10.000.
- Radio Stock: https://radio.stock.com.py/ (de lunes a sábado de 10 a 12 y de lunes a viernes de 17 a 19).
- Todas las ofertas están publicadas en la web.

DELIMARKET: sobrio, elegante, gourmet y fino; de experiencia y de calidad. NUNCA uses emojis en Delimarket (aunque la skill de emojis esté prendida). Frases cuidadas, sin exclamaciones de más ni lenguaje de oferta agresivo. Hashtag, si va, solo #Delimarket.
- WhatsApp: https://wa.me/595983500300
- Horario: lunes a sábado de 07:00 a 21:30; domingos y feriados de 07:30 a 21:00.
- Delivery: se comparte la lista de compras por mensaje, audio o imagen al WhatsApp; de lunes a sábado de 08:00 a 20:00; compra mínima Gs. 100.000; servicio Gs. 15.000; más información en https://delimarket.com.py/delivery-pickup
- Contenidos por día: lunes panadería, martes desayuno, miércoles almuerzo, jueves confitería, viernes bodega, sábado y domingo bodega con rotisería.
- Lo que la diferencia: sector sin azúcar y sin gluten, productos importados y exclusivos de Delimarket, y marcas importadas (en el manual: Corte Inglés, Lorenz, Quetara, Putruele).
- Promociones con tarjetas premium Itaú (si la publicación es de esa promo): Itaú Visa Infinite, The Platinum Card de American Express, Itaú MasterCard Black, Itaú Advantage Platinum, Itaú TAM Platinum, Itaú Tigo Platinum e Itaú Visa Platinum Centenario.`;

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
  if (id === "claudia") parts.push(CLAUDIA_MANUAL);
  if (train) parts.push(`Cómo tenés que trabajar (te lo enseñó el equipo; tiene prioridad sobre lo anterior):\n${train}`);
  if (skills.length) parts.push(`Tus skills (habilidades que te dio el equipo):\n${skills.map(s => "- " + s).join("\n")}`);
  if (lessons.length) parts.push(`Correcciones que te hizo el equipo (tenelas en cuenta siempre):\n${lessons.map(s => "- " + s).join("\n")}`);
  if (liked.length) parts.push(`Respuestas tuyas que al equipo le gustaron (seguí ese estilo):\n${liked.map(s => "«" + s + "»").join("\n\n")}`);
  return [
    { type: "text", text: parts.join("\n\n") },
    { type: "text", text: `<datos>\n${clip(b.context, MAX.context) || "(sin datos)"}\n</datos>` },
  ];
}

// El pedido completo para pegar en claude.ai (modo plan): lo mismo que recibiría Claude por la API, en un solo texto.
function promptFor(id, b, messages){
  const sys = systemFor(id, b), name = NAMES[id], prev = messages.slice(0, -1), last = messages[messages.length - 1].content;
  return [
    `Hola, Claude. Te paso un pedido desde la app Retail MKT Hub. Respondé como ${name}, siguiendo estas instrucciones y usando solo los datos de abajo.`,
    `<instrucciones>\n${sys[0].text}\n</instrucciones>`,
    sys[1].text,
    prev.length ? `<conversacion_anterior>\n${prev.map(m => (m.role === "user" ? "Equipo" : name) + ": " + m.content).join("\n\n")}\n</conversacion_anterior>` : "",
    `Pedido de ahora: ${last}`,
  ].filter(Boolean).join("\n\n");
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Usá POST." });
  const me = await who(req);
  if (!me) return res.status(401).json({ ok: false, error: "Solo Admin total y Admin pueden hablar con los agentes." });
  const b = (typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch (e) { return {}; } })() : req.body) || {};
  const id = String(b.agent || "");
  if (!AGENTS[id]) return res.status(400).json({ ok: false, error: "Ese agente no existe." });
  const messages = cleanMessages(b.messages);
  if (!messages.length) return res.status(400).json({ ok: false, error: "Escribí algo para el agente." });
  if (b.mode === "prompt") return res.status(200).json({ ok: true, prompt: promptFor(id, b, messages) });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ ok: false, code: "nokey", error: "Falta conectar los agentes con Claude: hay que cargar la clave ANTHROPIC_API_KEY en Vercel." });

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
    // Se terminó el saldo o el límite de gasto que se puso en console.anthropic.com (Settings → Limits).
    if (e instanceof Anthropic.APIError && [400, 402, 403, 429].includes(e.status) && /credit balance|usage limit|spend(ing)? limit|regain access|billing|quota/i.test(e.message || ""))
      return res.status(429).json({ ok: false, code: "limit", error: "Por ahora se terminó el saldo o el límite de gasto de Claude. ¡Nos vemos mañana! 👋 (Admin total lo puede ampliar en console.anthropic.com → Settings → Limits.)" });
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
module.exports.promptFor = promptFor;
module.exports.CLAUDIA_MANUAL = CLAUDIA_MANUAL;
