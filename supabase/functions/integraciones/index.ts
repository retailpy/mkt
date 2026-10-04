// Retail MKT Hub · integraciones del chat: búsqueda de GIFs (GIPHY) y biblioteca de stickers en Google Drive.
// Las claves quedan en la base (tabla integration_config, sin acceso desde la app); el navegador nunca las ve.
// Acciones (POST { action, ... }, con la sesión de la persona):
//   status · set_giphy {key} · script · set_sticker_url {url}       → solo Admin total
//   gifs {q} · stickers · sticker_upload {name,type,data}           → cualquier persona del equipo
//   tendencias {area:"dg"|"cm", force?}                              → las 10 novedades más llamativas (medios especializados)
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

// ---------- Tendencias: novedades de medios especializados (RSS), filtradas y ordenadas para Diseño o para CM ----------
const FEEDS: Record<string, { u: string; src: string; lang: string; need?: RegExp }[]> = {
  dg: [
    { u: "https://thedieline.com/feed", src: "The Dieline", lang: "en" },
    { u: "https://packagingoftheworld.com/feed", src: "Packaging of the World", lang: "en" },
    { u: "https://retaildesignblog.net/feed/", src: "Retail Design Blog", lang: "en" },
    { u: "https://www.packagingdive.com/feeds/news/", src: "Packaging Dive", lang: "en" },
    { u: "https://www.grocerydive.com/feeds/news/", src: "Grocery Dive", lang: "en", need: /brand|design|packag|private label|store format|remodel|new look|logo/i },
    { u: "https://www.marketingdirecto.com/feed", src: "Marketing Directo", lang: "es", need: /diseño|packaging|envase|logo|identidad|imagen de marca|rebranding|tienda/i },
  ],
  cm: [
    { u: "https://www.marketingdirecto.com/feed", src: "Marketing Directo", lang: "es" },
    { u: "https://roastbrief.com.mx/feed/", src: "Roastbrief", lang: "es" },
    { u: "https://www.socialmediatoday.com/feeds/news/", src: "Social Media Today", lang: "en" },
    { u: "https://www.marketingdive.com/feeds/news/", src: "Marketing Dive", lang: "en" },
    { u: "https://www.grocerydive.com/feeds/news/", src: "Grocery Dive", lang: "en", need: /social|tiktok|instagram|campaign|ad |ads|marketing|influencer|creator|viral/i },
  ],
};
const RETAIL = /supermarket|supermercado|s[uú]per\b|hipermercado|grocery|grocer|retail|minorista|walmart|tesco|aldi|lidl|carrefour|mercadona|whole foods|trader joe|kroger|costco|albert heijn|coles|woolworths|jumbo|sainsbury|waitrose|m&s|marks & spencer|target|instacart|oxxo|[ée]xito|d[ií]a\b|eroski|consum|alcampo|food|alimento|snack|bebida|beverage|cerveza|caf[eé]|coffee/i;
const AREA_RE: Record<string, RegExp> = {
  dg: /packag|design|diseño|brand|marca|identity|identidad|logo|label|etiqueta|store|tienda|rebrand|illustrat|typograph|tipograf/i,
  cm: /tiktok|instagram|social|redes|viral|influencer|creator|creador|campaign|campaña|reel|video|meme|ad\b|anuncio|spot|community/i,
};
const trendCache: Record<string, { at: number; items: any[] }> = {};
const decode = (t: string) => t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&#8230;/g, "…").replace(/&#8217;|&rsquo;/g, "’").replace(/&#8216;|&lsquo;/g, "‘").replace(/&#822[01];|&[lr]dquo;/g, "\"")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const strip = (h: string) => decode(h).replace(/<[^>]+>/g, " ").replace(/La entrada .*? se publicó primero en .*$/s, "").replace(/\s+/g, " ").trim();
const tag = (x: string, n: string) => { const m = x.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`)); return m ? m[1] : ""; };
async function readFeed(f: { u: string; src: string; lang: string; need?: RegExp }){
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(f.u, { headers: { "User-Agent": "Mozilla/5.0 (RetailMKTHub; tendencias)" }, signal: ctl.signal });
    if (!r.ok) return [];
    const xml = await r.text();
    return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)].slice(0, 40).map(([it]) => {
      const desc = tag(it, "description"), body = tag(it, "content:encoded");
      const img = (it.match(/<media:(?:content|thumbnail)[^>]+url="([^"]+)"/) || it.match(/<enclosure[^>]+url="([^"]+)"[^>]+image/) || decode(desc + body).match(/<img[^>]+src="([^"]+)"/) || [])[1] || "";
      const t = strip(tag(it, "title")), u = decode(tag(it, "link")).trim(), x = strip(desc).slice(0, 220);
      return { t, u, x, img: /^https:\/\//.test(img) ? decode(img) : "", d: (() => { const t = Date.parse(decode(tag(it, "pubDate") || tag(it, "dc:date")).trim()); return isNaN(t) ? "" : new Date(t).toISOString(); })(), src: f.src, lang: f.lang, need: f.need };
    }).filter((i) => i.t && /^https?:\/\//.test(i.u) && (!i.need || i.need.test(i.t + " " + i.x)));
  } catch { return []; } finally { clearTimeout(tm); }
}
async function tendencias(area: string, force: boolean){
  const c = trendCache[area];
  if (c && !force && Date.now() - c.at < 3 * 3600e3) return c.items;
  const all = (await Promise.all(FEEDS[area].map(readFeed))).flat();
  const now = Date.now(), seen = new Set<string>();
  const scored = all.filter((i) => { const k = i.t.toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return now - Date.parse(i.d) < 60 * 864e5; })
    .map((i) => { const txt = i.t + " " + i.x, age = (now - Date.parse(i.d)) / 864e5;
      return { ...i, s: (RETAIL.test(txt) ? 3 : 0) + (AREA_RE[area].test(txt) ? 2 : 0) + (i.img ? 1 : 0) + (i.lang === "es" ? 0.5 : 0) - age / 7 }; })
    .sort((a, b) => b.s - a.s);
  const per: Record<string, number> = {}, out: any[] = [];
  for (const i of scored){ if ((per[i.src] = (per[i.src] || 0) + 1) > 3) continue; out.push({ t: i.t, u: i.u, x: i.x, img: i.img, d: i.d, src: i.src, lang: i.lang }); if (out.length === 10) break; }
  if (out.length) trendCache[area] = { at: Date.now(), items: out };
  return out;
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
        const items = await tendencias(area, !!b.force);
        return items.length ? json({ ok: true, items }) : json({ ok: false, error: "No se pudieron traer las novedades" });
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
