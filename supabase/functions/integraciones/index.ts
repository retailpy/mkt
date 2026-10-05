// Retail MKT Hub · integraciones del chat: búsqueda de GIFs (GIPHY) y biblioteca de stickers en Google Drive.
// Las claves quedan en la base (tabla integration_config, sin acceso desde la app); el navegador nunca las ve.
// Acciones (POST { action, ... }, con la sesión de la persona):
//   status · set_giphy {key} · script · set_sticker_url {url}       → solo Admin total
//   gifs {q} · stickers · sticker_upload {name,type,data}           → cualquier persona del equipo
//   tendencias {area:"dg"|"cm"|"ideas", force?}                      → campañas, piezas y contenidos con foto, en español (force: solo Admin total)
import { createClient } from "npm:@supabase/supabase-js@2";
import { armar } from "./tendencias.ts";

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

// ---------- Tendencias: campañas, packaging, punto de venta y redes (tendencias.ts arma los grupos) ----------
// Se guarda en app_state (cache:trends:<área>) y se renueva cada 3 horas. Las traducciones y fotos ya buscadas se reutilizan.
async function tendencias(area: string, force: boolean){
  const key = `cache:trends:${area}`;
  const { data: rows } = await db.from("app_state").select("key, data").in("key", ["cache:trends:dg", "cache:trends:cm", "cache:trends:ideas"]);
  const row = (rows || []).find((r: any) => r.key === key), prev = row?.data;
  if (prev?.groups && prev.v === 2 && !force && Date.now() - (prev.at || 0) < 3 * 3600e3) return prev.groups;
  const known = new Map<string, any>();
  (rows || []).forEach((r: any) => (r.data?.groups || []).forEach((g: any) => (g.items || []).forEach((i: any) => known.set(i.u, i))));
  const { groups } = await armar(area, known);
  if (groups.some((g) => g.items.length)){
    const data = { v: 2, at: Date.now(), groups };
    if (row) await db.from("app_state").update({ data, updated_at: new Date().toISOString() }).eq("key", key);
    else await db.from("app_state").insert({ key, data });
    return groups;
  }
  return prev?.v === 2 ? prev.groups : [];
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
        const area = b.area === "cm" ? "cm" : b.area === "ideas" ? "ideas" : "dg";
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
