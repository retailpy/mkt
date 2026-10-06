// Código compartido por api/seguidores.js y api/demograficos.js.
// Las carpetas que empiezan con "_" no se publican como funciones en Vercel.

const GRAPH = "https://graph.facebook.com/v21.0";

// Qué texto buscar (sin mayúsculas ni acentos) en el nombre de cada página de Facebook para reconocer la marca.
// Si una marca tiene varias páginas que coinciden (por ejemplo "Superseis Villarrica"), se usa la de más seguidores.
const NOMBRES = {
  "Superseis": ["superseis"],
  "Stock": ["stock"],
  "Delimarket": ["delimarket"],
  "Bianca": ["bianca"],
  "Clasipar": ["clasipar"],
  "Dayo": ["dayo"],
  "PediWOW": ["pediwow", "pedi wow"],
};

// En qué orden salen las marcas.
const ORDEN = ["Superseis", "Stock", "Delimarket", "Bianca", "Clasipar", "Dayo", "PediWOW"];

const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function brandOf(pageName){
  const n = norm(pageName);
  for (const b of ORDEN) if (NOMBRES[b].some(t => n.includes(t))) return b;
  return null;
}

// Autorización: el cron de Vercel manda "Authorization: Bearer CRON_SECRET"; a mano se usa ?secret=.
function authorized(req){
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const h = req.headers.authorization || "";
  const q = (req.query && req.query.secret) || "";
  return h === `Bearer ${secret}` || q === secret;
}

// Desde la app (botón “Actualizar”): la sesión de la persona. Solo Admin total, Admin y CM pueden pedir que se actualice.
async function allowedUser(req){
  const h = req.headers.authorization || "", tok = h.replace(/^Bearer\s+/i, "");
  const url = process.env.SUPABASE_URL, apikey = process.env.SUPABASE_KEY;
  if (!tok || !url || !apikey || tok === process.env.CRON_SECRET) return false;
  const u = await fetch(`${url}/auth/v1/user`, { headers: { apikey, Authorization: `Bearer ${tok}` } }).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!u?.id) return false;
  const rows = await fetch(`${url}/rest/v1/members?select=role,active&user_id=eq.${encodeURIComponent(u.id)}`, { headers: { apikey, Authorization: `Bearer ${tok}` } }).then(r => r.ok ? r.json() : []).catch(() => []);
  return Array.isArray(rows) && rows.some(m => m.active && ["Admin total", "Admin", "CM"].includes(m.role));
}
// Cualquier persona activa del equipo (para cosas livianas como la vista previa de links del chat).
async function memberUser(req){
  const h = req.headers.authorization || "", tok = h.replace(/^Bearer\s+/i, "");
  const url = process.env.SUPABASE_URL, apikey = process.env.SUPABASE_KEY;
  if (!tok || !url || !apikey) return false;
  const u = await fetch(`${url}/auth/v1/user`, { headers: { apikey, Authorization: `Bearer ${tok}` } }).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!u?.id) return false;
  const rows = await fetch(`${url}/rest/v1/members?select=active&user_id=eq.${encodeURIComponent(u.id)}`, { headers: { apikey, Authorization: `Bearer ${tok}` } }).then(r => r.ok ? r.json() : []).catch(() => []);
  return Array.isArray(rows) && rows.some(m => m.active);
}
// El cron (CRON_SECRET) o una persona con permiso desde la app.
async function cronOrUser(req){ return authorized(req) ? "cron" : (await allowedUser(req)) ? "user" : null; }

async function graph(path, params = {}){
  const url = new URL(GRAPH + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", process.env.META_TOKEN || "");
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error){
    const e = j.error || {};
    const err = new Error(e.message || `HTTP ${r.status}`);
    err.code = e.code; err.subcode = e.error_subcode;
    throw err;
  }
  return j;
}

// Todas las páginas a las que tiene acceso el token (con su Instagram vinculado), agrupadas por marca.
async function brandPages(){
  const fields = "id,name,fan_count,followers_count,instagram_business_account{id,username,followers_count}";
  let out = [], next = null, j = await graph("/me/accounts", { fields, limit: "100" });
  for (;;){
    out.push(...(j.data || []));
    next = j.paging && j.paging.next;
    if (!next) break;
    const r = await fetch(next); j = await r.json();
    if (j.error) throw new Error(j.error.message);
  }
  const byBrand = {}, unmatched = [];
  for (const p of out){
    const b = brandOf(p.name);
    if (!b){ unmatched.push(p.name); continue; }
    const fb = p.followers_count ?? p.fan_count ?? 0;
    if (!byBrand[b] || fb > byBrand[b].fb) byBrand[b] = {
      page: p.name, pageId: p.id, fb,
      igId: p.instagram_business_account?.id || null,
      handle: p.instagram_business_account?.username ? "@" + p.instagram_business_account.username : null,
      ig: p.instagram_business_account?.followers_count ?? null,
    };
  }
  const missing = ORDEN.filter(b => !byBrand[b]);
  return { byBrand, unmatched, missing, total: out.length };
}

const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g; // mitades de emoji sueltas
async function save(key, data){
  const url = process.env.SUPABASE_URL, apikey = process.env.SUPABASE_KEY, secret = process.env.INGEST_KEY;
  if (!url || !apikey || !secret) throw new Error("Faltan variables SUPABASE_URL, SUPABASE_KEY o INGEST_KEY en Vercel");
  const r = await fetch(`${url}/rest/v1/rpc/ingest_meta`, {
    method: "POST",
    headers: { apikey, Authorization: `Bearer ${apikey}`, "Content-Type": "application/json" },
    // Sin emojis cortados por la mitad (un texto cortado en 300 letras puede partir un emoji y Supabase rechaza todo).
    body: JSON.stringify({ p_key: key, p_secret: secret, p_data: data }, (k, v) => typeof v === "string" ? v.replace(LONE, "") : v),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`Supabase: ${t}`);
  return t;
}

// Leer lo que ya se guardó (solo s:META_POSTS), con la misma clave que para guardar.
async function readMeta(key){
  const url = process.env.SUPABASE_URL, apikey = process.env.SUPABASE_KEY, secret = process.env.INGEST_KEY;
  if (!url || !apikey || !secret) throw new Error("Faltan variables SUPABASE_URL, SUPABASE_KEY o INGEST_KEY en Vercel");
  const r = await fetch(`${url}/rest/v1/rpc/read_meta`, {
    method: "POST",
    headers: { apikey, Authorization: `Bearer ${apikey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_key: key, p_secret: secret }),
  });
  if (!r.ok) throw new Error(`Supabase: ${await r.text()}`);
  return r.json();
}

// Fecha y mes de hoy en Paraguay.
function today(){
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion" }).format(new Date());
  return { date: d, month: d.slice(0, 7), at: new Date().toISOString() };
}

function tokenHint(e){
  if (/API access deactivated|developer registration/i.test(e.message || "")) return "Meta desactivó la cuenta de desarrollador dueña de la app: entrá a developers.facebook.com con esa cuenta y completá el registro (verificar el teléfono). El token no hace falta cambiarlo.";
  if (e.code === 190) return "El META_TOKEN venció o es inválido: generá uno nuevo (pasos 2 y 3 de la guía) y redesplegá.";
  if (e.code === 10 || e.code === 200) return "Al token le falta un permiso o la página no fue seleccionada al generarlo.";
  return null;
}

module.exports = { NOMBRES, ORDEN, authorized, allowedUser, memberUser, cronOrUser, graph, brandPages, save, readMeta, today, tokenHint };
