// Retail MKT Hub · integraciones del chat: búsqueda de GIFs (GIPHY) y biblioteca de stickers en Google Drive.
// Las claves quedan en la base (tabla integration_config, sin acceso desde la app); el navegador nunca las ve.
// Acciones (POST { action, ... }, con la sesión de la persona):
//   status · set_giphy {key} · script · set_sticker_url {url}       → solo Admin total
//   gifs {q} · stickers · sticker_upload {name,type,data}           → cualquier persona del equipo
//   tendencias {area:"dg"|"cm", force?}                              → novedades en español, en 2 grupos de 8 (force: solo Admin total)
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const FOLDER_ID = "1EwWLkJ3XCl927Yi0ryCvFC807Vdp0iFk"; // carpeta "Stickers Retail MKT"
const MAX_BYTES = 400 * 1024;
const TYPES = ["image/png", "image/webp", "image/gif", "image/jpeg"];
const SCRIPT_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]{20,}\/exec$/;
const thumb = (id: string) => `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w320`;

const cfg = async () => (await db.from("integration_config").select("*").eq("id", 1).single()).data;

// El script que se pega en script.google.com (lleva la clave secreta adentro: no compartirlo).
const scriptText = (secret: string) => `// Retail MKT Hub · stickers del chat en la carpeta "Stickers Retail MKT" de Google Drive.
// Pegalo en script.google.com y publicalo como Aplicación web (Ejecutar como: Yo · Acceso: Cualquier usuario).
// Tiene una clave secreta adentro: no lo compartas.
const SECRET = "${secret}";
const FOLDER_ID = "${FOLDER_ID}";
const MAX_BYTES = ${MAX_BYTES};
const TYPES = ${JSON.stringify(TYPES)};
const out = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

function doGet(e){
  if (e.parameter.k !== SECRET) return out({ ok: false, error: "no autorizado" });
  const files = DriveApp.getFolderById(FOLDER_ID).getFiles(), list = [];
  while (files.hasNext()){
    const f = files.next();
    if (TYPES.indexOf(f.getMimeType()) < 0) continue;
    list.push({ id: f.getId(), name: f.getName(), by: f.getDescription() || "", ts: f.getDateCreated().toISOString() });
  }
  list.sort((a, b) => b.ts.localeCompare(a.ts));
  return out({ ok: true, stickers: list });
}

function doPost(e){
  let b; try { b = JSON.parse(e.postData.contents); } catch (err){ return out({ ok: false, error: "pedido inválido" }); }
  if (b.k !== SECRET) return out({ ok: false, error: "no autorizado" });
  if (TYPES.indexOf(b.type) < 0) return out({ ok: false, error: "tipo de imagen no permitido" });
  const bytes = Utilities.base64Decode(b.data || "");
  if (!bytes.length || bytes.length > MAX_BYTES) return out({ ok: false, error: "la imagen supera 400 KB" });
  const f = DriveApp.getFolderById(FOLDER_ID).createFile(Utilities.newBlob(bytes, b.type, String(b.name || "sticker").slice(0, 40)));
  f.setDescription(String(b.by || "").slice(0, 40));
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return out({ ok: true, sticker: { id: f.getId(), name: f.getName(), by: f.getDescription(), ts: f.getDateCreated().toISOString() } });
}
`;

async function giphy(key: string, q: string){
  const u = new URL(`https://api.giphy.com/v1/gifs/${q ? "search" : "trending"}`);
  u.searchParams.set("api_key", key); u.searchParams.set("limit", "24"); u.searchParams.set("rating", "g"); u.searchParams.set("lang", "es");
  if (q) u.searchParams.set("q", q);
  const r = await fetch(u);
  if (!r.ok) throw Object.assign(new Error(`GIPHY ${r.status}`), { status: r.status });
  const j = await r.json();
  return (j.data || []).map((g: any) => ({ id: g.id, title: g.title || "", url: g.images?.downsized_medium?.url || g.images?.original?.url, preview: g.images?.fixed_width_small?.url || g.images?.fixed_width?.url }))
    .filter((g: any) => g.url && g.preview);
}
async function scriptList(url: string, secret: string){
  const r = await fetch(`${url}?k=${encodeURIComponent(secret)}`, { redirect: "follow" });
  const t = await r.text(); let j: any; try { j = JSON.parse(t); } catch { throw new Error("El script no respondió bien: revisá que esté publicado como Aplicación web con acceso para Cualquier usuario"); }
  if (!j.ok) throw new Error(j.error === "no autorizado" ? "El script tiene otra clave: copiá de nuevo el script desde la app y volvé a publicarlo" : (j.error || "sin respuesta"));
  return j.stickers;
}

// ---------- Tendencias: novedades de medios especializados (RSS), en español, en 2 grupos de 8 por área ----------
// (el grupo del medio, “Campañas de temporada”, lo arma la app con el calendario de fechas de Latinoamérica).
type Feed = { u: string; src: string; lang: string; need?: RegExp; gn?: boolean };
const F = {
  brandemia: { u: "https://www.brandemia.org/feed", src: "Brandemia", lang: "es" },
  graffica: { u: "https://graffica.info/feed/", src: "Gràffica", lang: "es" },
  creativos: { u: "https://www.creativosonline.org/feed", src: "Creativos Online", lang: "es" },
  dieline: { u: "https://thedieline.com/feed", src: "The Dieline", lang: "en" },
  potw: { u: "https://packagingoftheworld.com/feed", src: "Packaging of the World", lang: "en" },
  rdb: { u: "https://retaildesignblog.net/feed/", src: "Retail Design Blog", lang: "en" },
  mdirecto: { u: "https://www.marketingdirecto.com/feed", src: "Marketing Directo", lang: "es" },
  roast: { u: "https://roastbrief.com.mx/feed/", src: "Roastbrief", lang: "es" },
  latam: { u: "https://www.latamclick.com/feed/", src: "LatamClick", lang: "es" },
  smt: { u: "https://www.socialmediatoday.com/feeds/news/", src: "Social Media Today", lang: "en" },
  grocery: { u: "https://www.grocerydive.com/feeds/news/", src: "Grocery Dive", lang: "en" },
};
// Noticias de las cadenas que el equipo toma como referencia (Google Noticias), separadas para Diseño y para CM.
const gn = (q: string, es: boolean) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${es ? "hl=es-419&gl=US&ceid=US:es-419" : "hl=en-US&gl=US&ceid=US:en"}`;
const GN = {
  dgEs: { u: gn('("Ametller Origen" OR "Pão de Açúcar" OR "St Marche" OR "City Market" OR OXXO OR Monoprix OR Waitrose OR "M&S Food" OR "Whole Foods" OR "Trader Joe\'s" OR "Albert Heijn" OR Freshippo OR Jumbo OR Mercadona) (campaña OR packaging OR branding OR diseño OR "nueva imagen" OR cartelería OR tienda) when:45d', true), src: "Google Noticias", lang: "es", gn: true },
  dgEn: { u: gn('("Ametller Origen" OR "Pao de Acucar" OR Monoprix OR Waitrose OR "M&S Food" OR "Whole Foods" OR "Trader Joe\'s" OR "Albert Heijn" OR Freshippo OR Hema OR Wegmans) (campaign OR packaging OR rebrand OR "store design" OR advertising OR "visual merchandising") when:45d', false), src: "Google News", lang: "en", gn: true },
  cmEs: { u: gn('(OXXO OR Walmart OR Mercadona OR Lidl OR Aldi OR Carrefour OR Jumbo OR Chedraui OR Tottus OR Soriana OR "Pão de Açúcar" OR Coto) (TikTok OR Instagram OR "redes sociales" OR viral OR influencer OR campaña) when:30d', true), src: "Google Noticias", lang: "es", gn: true },
  cmEn: { u: gn('("Trader Joe\'s" OR "Whole Foods" OR Walmart OR Aldi OR Lidl OR Tesco OR Waitrose OR "M&S Food" OR Carrefour) (TikTok OR Instagram OR "social media" OR viral OR influencer OR "ad campaign") when:30d', false), src: "Google News", lang: "en", gn: true },
};
// Cadenas de referencia → país (para la banderita) y nombre.
const CHAINS: [RegExp, string, string][] = [
  [/p[aã]o de a[cç][uú]car/i, "BR", "Pão de Açúcar"], [/\bst\.? ?marche\b/i, "BR", "St. Marche"], [/zona sul/i, "BR", "Zona Sul"],
  [/\boxxo\b/i, "MX", "OXXO"], [/city market/i, "MX", "City Market"], [/\bla comer\b/i, "MX", "La Comer"], [/chedraui/i, "MX", "Chedraui"], [/soriana/i, "MX", "Soriana"],
  [/ametller/i, "ES", "Ametller Origen"], [/corte ingl[eé]s/i, "ES", "El Corte Inglés"], [/hipercor/i, "ES", "Hipercor"], [/mercadona/i, "ES", "Mercadona"], [/bonpreu|esclat/i, "ES", "Bonpreu"],
  [/whole foods/i, "US", "Whole Foods"], [/trader joe/i, "US", "Trader Joe's"], [/wegmans/i, "US", "Wegmans"], [/sprouts farmers/i, "US", "Sprouts"], [/\bwalmart\b/i, "US", "Walmart"], [/costco/i, "US", "Costco"], [/kroger/i, "US", "Kroger"],
  [/waitrose/i, "GB", "Waitrose"], [/\bm&s\b|marks (&|and) spencer/i, "GB", "M&S Food"], [/\btesco\b/i, "GB", "Tesco"], [/sainsbury/i, "GB", "Sainsbury's"],
  [/monoprix/i, "FR", "Monoprix"], [/carrefour/i, "FR", "Carrefour"], [/albert heijn/i, "NL", "Albert Heijn"], [/\blidl\b/i, "DE", "Lidl"], [/\baldi\b/i, "DE", "Aldi"],
  [/\bjumbo\b/i, "CL", "Jumbo"], [/tottus/i, "CL", "Tottus"], [/unimarc/i, "CL", "Unimarc"], [/\bcoto\b/i, "AR", "Coto"],
  [/freshippo|\bhema\b/i, "CN", "Freshippo / Hema"], [/\baeon\b/i, "JP", "AEON"], [/\be-?mart\b/i, "KR", "Emart"],
];
const SRC_CC: Record<string, string> = { "Brandemia": "ES", "Gràffica": "ES", "Creativos Online": "ES", "Marketing Directo": "ES", "Roastbrief": "MX", "LatamClick": "LA",
  "The Dieline": "US", "Packaging of the World": "WW", "Retail Design Blog": "WW", "Grocery Dive": "US", "Social Media Today": "US" };
const chainOf = (t: string) => { for (const [re, cc, n] of CHAINS) if (re.test(t)) return { cc, n }; return null; };
const RETAIL = /supermarket|supermercado|s[uú]per\b|hipermercado|grocery|grocer|retail|minorista|walmart|tesco|aldi|lidl|carrefour|mercadona|whole foods|trader joe|kroger|costco|albert heijn|coles|woolworths|jumbo|sainsbury|waitrose|marks & spencer|oxxo|[ée]xito|eroski|alcampo|dia\b|food|alimento|comida|snack|bebida|beverage|cerveza|caf[eé]|coffee|helado|chocolate|galleta|marca blanca|private label/i;
const DESIGN = /packag|envase|etiqueta|label|design|diseño|brand|marca|identity|identidad|logo|tipograf|typograph|ilustra|illustrat|cartel|afiche|póster|poster|store|tienda|rebrand|visual/i;
const SOCIAL = /tiktok|instagram|facebook|whatsapp|threads|youtube|social|redes|viral|influencer|creator|creador|reel|video|meme|contenido|community|algoritmo|algorithm|hashtag/i;
const CAMPAIGN = /campa|campaign|anuncio|spot|publicidad|advertis|\bad\b|ads\b|activaci|promo/i;
const GROUPS: Record<string, { k: string; feeds: Feed[]; score: (txt: string) => number; need?: (txt: string) => boolean }[]> = {
  dg: [
    { k: "super", feeds: [F.brandemia, F.dieline, F.potw, F.rdb, F.grocery, F.mdirecto, F.graffica, GN.dgEs, GN.dgEn],
      need: (t) => (RETAIL.test(t) || !!chainOf(t)) && DESIGN.test(t), score: (t) => (chainOf(t) ? 3 : 0) + (RETAIL.test(t) ? 2 : 0) + (DESIGN.test(t) ? 2 : 0) },
    { k: "insp", feeds: [F.brandemia, F.graffica, F.creativos, F.dieline, F.potw],
      score: (t) => (DESIGN.test(t) ? 2 : 0) + (RETAIL.test(t) ? 1 : 0) },
  ],
  cm: [
    { k: "super", feeds: [F.mdirecto, F.roast, F.latam, F.grocery, F.smt, GN.cmEs, GN.cmEn],
      need: (t) => (RETAIL.test(t) || !!chainOf(t)) && (SOCIAL.test(t) || CAMPAIGN.test(t)), score: (t) => (chainOf(t) ? 3 : 0) + (RETAIL.test(t) ? 2 : 0) + (SOCIAL.test(t) ? 2 : 0) + (CAMPAIGN.test(t) ? 1 : 0) },
    { k: "redes", feeds: [F.smt, F.mdirecto, F.latam, F.roast],
      need: (t) => SOCIAL.test(t), score: (t) => (SOCIAL.test(t) ? 3 : 0) + (RETAIL.test(t) ? 1 : 0) },
  ],
};
const decode = (t: string) => t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&#8230;/g, "…").replace(/&#8217;|&rsquo;/g, "’").replace(/&#8216;|&lsquo;/g, "‘").replace(/&#822[01];|&[lr]dquo;/g, "\"")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const strip = (h: string) => decode(h).replace(/<[^>]+>/g, " ").replace(/La entrada .*? se publicó primero en .*$/s, "").replace(/The post .*? appeared first on .*$/s, "").replace(/\s+/g, " ").trim();
const tag = (x: string, n: string) => { const m = x.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`)); return m ? m[1] : ""; };
const feedMemo = new Map<string, { at: number; items: any[] }>();
async function readFeed(f: Feed){
  const m = feedMemo.get(f.u); if (m && Date.now() - m.at < 20 * 60e3) return m.items;
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(f.u, { headers: { "User-Agent": "Mozilla/5.0 (RetailMKTHub; tendencias)" }, signal: ctl.signal });
    if (!r.ok) return [];
    const xml = (await r.text()).slice(0, 1_500_000);
    const items = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)].slice(0, 40).map(([it]) => {
      const desc = tag(it, "description"), body = tag(it, "content:encoded");
      const img = (it.match(/<media:(?:content|thumbnail)[^>]+url="([^"]+)"/) || it.match(/<enclosure[^>]+url="([^"]+)"[^>]+image/) || decode(desc + body).match(/<img[^>]+src="([^"]+)"/) || [])[1] || "";
      let t = strip(tag(it, "title")); const u = decode(tag(it, "link")).trim(); let x = strip(desc).slice(0, 220), src = f.src;
      if (f.gn){ const so = strip(tag(it, "source")); if (so){ src = so; t = t.replace(new RegExp("\\s+-\\s+" + so.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"), ""); } x = ""; } // Google Noticias: el medio va aparte y no trae resumen
      const pd = Date.parse(decode(tag(it, "pubDate") || tag(it, "dc:date")).trim());
      const ch = chainOf(t + " " + x);
      return { t, u, x, img: /^https:\/\//.test(img) ? decode(img) : "", d: isNaN(pd) ? "" : new Date(pd).toISOString(), src, lang: f.lang, gn: !!f.gn,
        chain: ch?.n || "", cc: ch?.cc || SRC_CC[src] || (f.lang === "es" ? "LA" : "US") };
    }).filter((i) => i.t && i.d && /^https?:\/\//.test(i.u));
    feedMemo.set(f.u, { at: Date.now(), items });
    return items;
  } catch { return []; } finally { clearTimeout(tm); }
}
// Traducción al español de lo que viene en inglés (MyMemory, gratis). Lo ya traducido se reutiliza del caché.
async function toEs(text: string){
  if (!text) return "";
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 480))}&langpair=en|es`, { signal: ctl.signal });
    const j = await r.json();
    const out = String(j?.responseData?.translatedText || "");
    return j?.responseStatus === 200 && out && !/MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(out) ? decode(out) : "";
  } catch { return ""; } finally { clearTimeout(tm); }
}
async function tendencias(area: string, force: boolean){
  const key = `cache:trends:${area}`;
  const { data: row } = await db.from("app_state").select("data").eq("key", key).maybeSingle();
  const prev = row?.data;
  if (prev?.groups && !force && Date.now() - (prev.at || 0) < 3 * 3600e3) return prev.groups;
  const known = new Map<string, any>(); (prev?.groups || []).forEach((g: any) => (g.items || []).forEach((i: any) => known.set(i.u, i)));
  const now = Date.now(), used = new Set<string>(), groups: any[] = [];
  for (const g of GROUPS[area]){
    const all = (await Promise.all(g.feeds.map(readFeed))).flat();
    const seen = new Set<string>();
    const scored = all.filter((i) => { const k = i.t.toLowerCase().slice(0, 60); if ((i.gn && !i.chain) || seen.has(k) || used.has(i.u)) return false; seen.add(k); return now - Date.parse(i.d) < 60 * 864e5; })
      .map((i) => { const txt = i.t + " " + i.x, age = (now - Date.parse(i.d)) / 864e5;
        return { ...i, ok: !g.need || g.need(txt), s: g.score(txt) + (i.img ? 1 : 0) + (i.lang === "es" ? 2 : 0) - age / 6 }; })
      .sort((a, b) => (Number(b.ok) - Number(a.ok)) || b.s - a.s);
    const per: Record<string, number> = {}, out: any[] = [];
    for (const i of scored){ if ((per[i.src] = (per[i.src] || 0) + 1) > 3) continue; out.push(i); used.add(i.u); if (out.length === 8) break; }
    const items = await Promise.all(out.map(async (i) => {
      const base = { t: i.t, u: i.u, x: i.x, img: i.img, d: i.d, src: i.src, lang: i.lang, chain: i.chain, cc: i.cc };
      if (i.lang === "es") return base;
      const k = known.get(i.u); if (k?.tr) return { ...base, t: k.t, x: k.x, tr: true };
      const [t, x] = await Promise.all([toEs(i.t), toEs(i.x.slice(0, 200))]);
      return t ? { ...base, t, x: x || "", tr: true } : base;
    }));
    groups.push({ k: g.k, items });
  }
  if (groups.some((g) => g.items.length)){
    const data = { at: Date.now(), groups };
    if (row) await db.from("app_state").update({ data, updated_at: new Date().toISOString() }).eq("key", key);
    else await db.from("app_state").insert({ key, data });
    return groups;
  }
  return prev?.groups || [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return json({ ok: false, error: "Iniciá sesión en la app" }, 401);
  const { data: m } = await db.from("members").select("person_id, role, active").eq("user_id", u.user.id).maybeSingle();
  if (!m || !m.active) return json({ ok: false, error: "Sin acceso" }, 403);
  const admin = m.role === "Admin total";
  let b: any; try { b = await req.json(); } catch { return json({ ok: false, error: "Pedido inválido" }, 400); }
  const c = await cfg();
  try {
    switch (b.action){
      case "status":
        if (!admin) return json({ ok: false, error: "Solo Admin total" }, 403);
        return json({ ok: true, giphy: !!c.giphy_key, stickers: !!c.sticker_url });
      case "set_giphy": {
        if (!admin) return json({ ok: false, error: "Solo Admin total" }, 403);
        const key = String(b.key || "").trim();
        if (!key){ await db.from("integration_config").update({ giphy_key: null, updated_at: new Date().toISOString() }).eq("id", 1); return json({ ok: true }); }
        if (!/^[A-Za-z0-9]{20,64}$/.test(key)) return json({ ok: false, error: "Esa no parece una clave de GIPHY (son 32 letras y números)" });
        try { await giphy(key, ""); } catch (e: any){ return json({ ok: false, error: "GIPHY no aceptó esa clave. Revisá que la copiaste completa." }); }
        await db.from("integration_config").update({ giphy_key: key, updated_at: new Date().toISOString() }).eq("id", 1);
        return json({ ok: true });
      }
      case "script":
        if (!admin) return json({ ok: false, error: "Solo Admin total" }, 403);
        return json({ ok: true, script: scriptText(c.sticker_secret) });
      case "set_sticker_url": {
        if (!admin) return json({ ok: false, error: "Solo Admin total" }, 403);
        const url = String(b.url || "").trim();
        if (!url){ await db.from("integration_config").update({ sticker_url: null, updated_at: new Date().toISOString() }).eq("id", 1); return json({ ok: true }); }
        if (!SCRIPT_RE.test(url)) return json({ ok: false, error: "La URL tiene que ser la de la Aplicación web: https://script.google.com/macros/s/…/exec" });
        const list = await scriptList(url, c.sticker_secret);
        await db.from("integration_config").update({ sticker_url: url, updated_at: new Date().toISOString() }).eq("id", 1);
        return json({ ok: true, count: list.length });
      }
      case "gifs":
        if (!c.giphy_key) return json({ ok: false, nokey: true, error: "La búsqueda de GIFs no está conectada" });
        return json({ ok: true, gifs: await giphy(c.giphy_key, String(b.q || "").trim().slice(0, 60)) });
      case "tendencias": {
        const area = b.area === "cm" ? "cm" : "dg";
        const groups = await tendencias(area, !!b.force && admin);
        return groups.some((g: any) => g.items.length) ? json({ ok: true, groups }) : json({ ok: false, error: "No se pudieron traer las novedades" });
      }
      case "stickers":
        if (!c.sticker_url) return json({ ok: false, nokey: true, error: "La biblioteca de stickers no está conectada" });
        return json({ ok: true, stickers: (await scriptList(c.sticker_url, c.sticker_secret)).map((s: any) => ({ ...s, url: thumb(s.id) })) });
      case "sticker_upload": {
        if (!c.sticker_url) return json({ ok: false, nokey: true, error: "La biblioteca de stickers no está conectada" });
        if (!TYPES.includes(b.type)) return json({ ok: false, error: "La imagen tiene que ser PNG, WEBP, GIF o JPG" });
        const size = Math.floor(String(b.data || "").length * 3 / 4);
        if (!size || size > MAX_BYTES) return json({ ok: false, error: "El sticker supera 400 KB" });
        const r = await fetch(c.sticker_url, { method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({ k: c.sticker_secret, name: b.name, type: b.type, data: b.data, by: m.person_id }) });
        const t = await r.text(); let j: any; try { j = JSON.parse(t); } catch { throw new Error("El script de Drive no respondió bien"); }
        if (!j.ok) return json({ ok: false, error: j.error || "No se pudo guardar" });
        return json({ ok: true, sticker: { ...j.sticker, url: thumb(j.sticker.id) } });
      }
      // TEMPORAL (para probar el chat): Admin total, en "ver como", envía un mensaje en nombre de otra persona.
      // Queda marcado con via = quién lo envió de verdad, y la app lo muestra como prueba.
      case "preview_send": {
        if (!admin) return json({ ok: false, error: "Solo Admin total" }, 403);
        const as = String(b.as || ""), to = String(b.to || ""), msg = b.msg || {};
        const people: any[] = (await db.from("app_state").select("data").eq("key", "s:PEOPLE").maybeSingle()).data?.data || [];
        const asP = people.find((p) => p.id === as && p.active !== false);
        if (!asP || as === m.person_id) return json({ ok: false, error: "Persona inválida" });
        const text = String(msg.text || "").slice(0, 4000), gif = /^https:\/\//.test(msg.gif || "") ? msg.gif : undefined, stk = typeof msg.stk === "string" ? msg.stk.slice(0, 120) : undefined;
        if (!text && !gif && !stk) return json({ ok: false, error: "Mensaje vacío" });
        const now = new Date();
        const nm = { id: "pv" + now.getTime().toString(36), from: as, text, ...(gif ? { gif } : {}), ...(stk ? { stk } : {}), ts: now.toISOString(),
          date: now.toISOString().slice(0, 10), time: new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", hour: "2-digit", minute: "2-digit", hour12: false }).format(now), read: false, re: {}, via: m.person_id };
        let key: string, init: any;
        if (to.startsWith("p:")){
          const other = to.slice(2); if (!people.some((p) => p.id === other) || other === as) return json({ ok: false, error: "Destino inválido" });
          const [x, y] = [as, other].sort(); key = `thread:dm-${x}-${y}`; init = { id: `dm-${x}-${y}`, dm: true, topic: "Chat", prio: "Normal", a: as, b: other, msgs: [] };
        } else if (to.startsWith("g:")){
          const gid = to.slice(2), groups: any[] = (await db.from("app_state").select("data").eq("key", "s:CHAT_GROUPS").maybeSingle()).data?.data || [];
          const g = groups.find((x) => x.id === gid);
          if (!g || g.archived || !(g.all || (g.members || []).includes(as) || (g.roles || []).includes(asP.role))) return json({ ok: false, error: "Esa persona no está en el grupo" });
          key = `chat:${gid}`; init = { id: gid, msgs: [], seen: {} };
        } else return json({ ok: false, error: "Destino inválido" });
        for (let i = 0; i < 4; i++){
          const { data: row } = await db.from("app_state").select("data, version").eq("key", key).maybeSingle();
          if (!row){ const { error } = await db.from("app_state").insert({ key, data: { ...init, msgs: [nm] } }); if (!error) return json({ ok: true, msg: nm }); continue; }
          const data = { ...row.data, msgs: [...(row.data.msgs || []), nm] };
          const { data: up } = await db.from("app_state").update({ data, version: row.version + 1, updated_at: new Date().toISOString() }).eq("key", key).eq("version", row.version).select("version");
          if (up && up.length) return json({ ok: true, msg: nm });
        }
        return json({ ok: false, error: "No se pudo guardar, probá de nuevo" });
      }
    }
    return json({ ok: false, error: "Acción desconocida" }, 400);
  } catch (e: any){
    console.error("[integraciones]", b.action, e?.message);
    return json({ ok: false, error: e?.message || "No se pudo completar" });
  }
});
