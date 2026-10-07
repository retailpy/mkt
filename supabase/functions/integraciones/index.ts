// Retail MKT Hub · integraciones del chat: búsqueda de GIFs (GIPHY), biblioteca de stickers y fotos del chat en Google Drive.
// Las claves quedan en la base (tabla integration_config, sin acceso desde la app); el navegador nunca las ve.
// Acciones (POST { action, ... }, con la sesión de la persona):
//   status · set_giphy {key} · script · set_sticker_url {url}       → solo Admin total
//   gifs {q} · stickers · sticker_upload {name,type,data}           → cualquier persona del equipo
//   chat_image {type,data} · chat_image_delete {id}                  → fotos del chat (carpeta "Fotos Retail MKT", una carpeta por mes)
//   boceto_upload {job,name,type,data} · boceto_delete {id}          → bocetos de los pedidos (carpeta de Bocetos, una carpeta por mes)
//   tendencias {area:"dg"|"cm"|"ideas", force?}                      → campañas, piezas y contenidos con foto, en español (force: solo Admin total)
//   noticias {force?}                                                → lo que sale en los medios de Paraguay sobre Retail S.A. y sus marcas (3 meses)
import { createClient } from "npm:@supabase/supabase-js@2";
import { parseOfertas, periodo, marcaDe, PARSE_V } from "./comercial.ts";
import { armar } from "./tendencias.ts";
import { buscarNoticias, juntarNoticias } from "./noticias.ts";

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
const CHAT_FOLDER_ID = "13L9Y3QcGbymgMStbaCHmR7F2MZaoBxVw"; // carpeta "Fotos Retail MKT" (adentro, una carpeta por mes)
const BOCETO_FOLDER_ID = "11CTrI4SXqPnHj6an0xwcFnDy7lbU1XJK"; // carpeta de los bocetos de los pedidos (adentro, una carpeta por mes)
const COMERCIAL_FOLDER_ID = "1ciqZuhAtcIa-_OYYutd-8Zq8CTPZS-5N"; // ofertas de Comercial: los Excel "PUBLICADAS" de cada quincena (solo lectura)
const VIDEO_FOLDER_ID = "1OZxiVg0RQlJL2PUDLUXkct5NAFIGw09o"; // videos editados de CM (adentro, una carpeta por mes con el año)
const MAX_BYTES = 400 * 1024;
const CHAT_MAX = 4 * 1024 * 1024; // la app achica las fotos antes de subirlas (suelen quedar en 200-600 KB)
const BOCETO_MAX = 10 * 1024 * 1024; // boceto liviano para ver cómo va (el original va en los links del pedido)
const TYPES = ["image/png", "image/webp", "image/gif", "image/jpeg"];
const SCRIPT_V = 4; // versión del script de Drive que necesita la app (2: fotos del chat por mes · 3: bocetos · 4: Comercial y videos de CM)
const SCRIPT_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]{20,}\/exec$/;
const thumb = (id: string) => `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w320`;

const cfg = async () => (await db.from("integration_config").select("*").eq("id", 1).single()).data;

// El script que se pega en script.google.com (lleva la clave secreta adentro: no compartirlo).
const scriptText = (secret: string) => `// Retail MKT Hub · stickers, fotos del chat, bocetos, ofertas de Comercial y videos de CM en Google Drive.
//   Stickers → carpeta "Stickers Retail MKT".
//   Fotos del chat → carpeta "Fotos Retail MKT", con una carpeta por mes adentro (ej.: "2026-10 Octubre").
//   Bocetos de los pedidos → su carpeta, también con una carpeta por mes.
//   Comercial → lee (sin cambiar nada) los Excel "PUBLICADAS" de la carpeta de ofertas.
//   Videos editados de CM → su carpeta, con una carpeta por mes y año; el video se sube directo a Drive.
// Pegalo en script.google.com y publicalo como Aplicación web (Ejecutar como: Yo · Acceso: Cualquier usuario).
// Si ya estaba publicado: Implementar → Administrar implementaciones → lápiz → Versión: Nueva versión → Implementar
// (así queda la misma URL). Tiene una clave secreta adentro: no lo compartas.
const VERSION = ${SCRIPT_V};
const SECRET = "${secret}";
const FOLDER_ID = "${FOLDER_ID}";
const CHAT_FOLDER_ID = "${CHAT_FOLDER_ID}";
const BOCETO_FOLDER_ID = "${BOCETO_FOLDER_ID}";
const COMERCIAL_FOLDER_ID = "${COMERCIAL_FOLDER_ID}";
const VIDEO_FOLDER_ID = "${VIDEO_FOLDER_ID}";
const MAX_BYTES = ${MAX_BYTES};
const CHAT_MAX = ${CHAT_MAX};
const BOCETO_MAX = ${BOCETO_MAX};
const TYPES = ${JSON.stringify(TYPES)};
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const out = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

function doGet(e){
  if (e.parameter.k !== SECRET) return out({ ok: false, error: "no autorizado" });
  if (e.parameter.v) return out({ ok: true, version: VERSION });
  const files = DriveApp.getFolderById(FOLDER_ID).getFiles(), list = [];
  while (files.hasNext()){
    const f = files.next();
    if (TYPES.indexOf(f.getMimeType()) < 0) continue;
    list.push({ id: f.getId(), name: f.getName(), by: f.getDescription() || "", ts: f.getDateCreated().toISOString() });
  }
  list.sort((a, b) => b.ts.localeCompare(a.ts));
  return out({ ok: true, stickers: list });
}

// La carpeta del mes dentro de una carpeta (Fotos o Bocetos); si todavía no existe, se crea.
function monthFolder(rootId){
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const root = DriveApp.getFolderById(rootId), ym = Utilities.formatDate(new Date(), "America/Asuncion", "yyyy-MM");
    const name = ym + " " + MESES[Number(ym.slice(5)) - 1], it = root.getFoldersByName(name);
    return it.hasNext() ? it.next() : root.createFolder(name);
  } finally { lock.releaseLock(); }
}

function doPost(e){
  let b; try { b = JSON.parse(e.postData.contents); } catch (err){ return out({ ok: false, error: "pedido inválido" }); }
  if (b.k !== SECRET) return out({ ok: false, error: "no autorizado" });
  if (b.kind === "trash") return trash(b);
  if (b.kind === "boceto") return boceto(b);
  if (b.kind === "comercial_list") return comercialList();
  if (b.kind === "comercial_file") return comercialFile(b);
  if (b.kind === "video_folder") return out({ ok: true, folder: monthFolder(VIDEO_FOLDER_ID).getUrl() });
  if (b.kind === "video_session") return videoSession(b);
  if (b.kind === "video_done") return videoDone(b);
  if (TYPES.indexOf(b.type) < 0) return out({ ok: false, error: "tipo de imagen no permitido" });
  const chat = b.kind === "chat", bytes = Utilities.base64Decode(b.data || "");
  if (!bytes.length || bytes.length > (chat ? CHAT_MAX : MAX_BYTES)) return out({ ok: false, error: chat ? "la foto supera 4 MB" : "la imagen supera 400 KB" });
  const folder = chat ? monthFolder(CHAT_FOLDER_ID) : DriveApp.getFolderById(FOLDER_ID);
  const f = folder.createFile(Utilities.newBlob(bytes, b.type, String(b.name || (chat ? "foto" : "sticker")).slice(0, 60)));
  f.setDescription(String(b.by || "").slice(0, 40));
  try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err){}
  if (chat) return out({ ok: true, file: { id: f.getId(), name: f.getName() } });
  return out({ ok: true, sticker: { id: f.getId(), name: f.getName(), by: f.getDescription(), ts: f.getDateCreated().toISOString() } });
}

// Boceto de un pedido (imagen, PDF, logo… liviano): a la carpeta del mes dentro de la carpeta de Bocetos.
function boceto(b){
  const bytes = Utilities.base64Decode(b.data || "");
  if (!bytes.length || bytes.length > BOCETO_MAX) return out({ ok: false, error: "el boceto supera 10 MB" });
  const f = monthFolder(BOCETO_FOLDER_ID).createFile(Utilities.newBlob(bytes, String(b.type || "application/octet-stream"), String(b.name || "boceto").slice(0, 120)));
  f.setDescription(String(b.by || "").slice(0, 40));
  try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err){}
  return out({ ok: true, file: { id: f.getId(), name: f.getName(), mime: f.getMimeType(), size: f.getSize() } });
}

// Comercial: los archivos de la carpeta de ofertas (solo se leen; no se cambia nada).
function comercialList(){
  const files = DriveApp.getFolderById(COMERCIAL_FOLDER_ID).getFiles(), list = [];
  while (files.hasNext()){ const f = files.next(); list.push({ id: f.getId(), name: f.getName(), modified: f.getLastUpdated().toISOString(), created: f.getDateCreated().toISOString(), size: f.getSize() }); }
  return out({ ok: true, files: list });
}
function comercialFile(b){
  let f; try { f = DriveApp.getFileById(String(b.id || "")); } catch (err){ return out({ ok: false, error: "no existe" }); }
  let inFolder = false; for (const ps = f.getParents(); ps.hasNext();) if (ps.next().getId() === COMERCIAL_FOLDER_ID) inFolder = true;
  if (!inFolder) return out({ ok: false, error: "no es de la carpeta de ofertas" });
  if (f.getSize() > 15 * 1024 * 1024) return out({ ok: false, error: "archivo muy grande" });
  return out({ ok: true, name: f.getName(), modified: f.getLastUpdated().toISOString(), b64: Utilities.base64Encode(f.getBlob().getBytes()) });
}

// Video editado de CM: se abre una subida directa a Drive (carpeta del mes) y el navegador manda el video ahí.
function videoSession(b){
  const folder = monthFolder(VIDEO_FOLDER_ID), size = Number(b.size) || 0;
  if (!size || size > 5 * 1024 * 1024 * 1024) return out({ ok: false, error: "tamaño inválido" });
  const res = UrlFetchApp.fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink", {
    method: "post", contentType: "application/json; charset=UTF-8", muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken(), "X-Upload-Content-Type": String(b.type || "video/mp4"), "X-Upload-Content-Length": String(size), Origin: String(b.origin || "") },
    payload: JSON.stringify({ name: String(b.name || "video").slice(0, 140), parents: [folder.getId()], description: String(b.by || "").slice(0, 40) }),
  });
  const url = res.getHeaders()["Location"] || res.getHeaders()["location"];
  if (res.getResponseCode() >= 300 || !url) return out({ ok: false, error: "Drive no abrió la subida (" + res.getResponseCode() + ")" });
  return out({ ok: true, url: url, folder: folder.getUrl() });
}
function videoDone(b){
  let f; try { f = DriveApp.getFileById(String(b.id || "")); } catch (err){ return out({ ok: false, error: "no existe" }); }
  let ok = false; for (const ps = f.getParents(); ps.hasNext();){ const p = ps.next(); for (const pp = p.getParents(); pp.hasNext();) if (pp.next().getId() === VIDEO_FOLDER_ID) ok = true; }
  if (!ok) return out({ ok: false, error: "no es de la carpeta de videos" });
  try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err){}
  return out({ ok: true, link: f.getUrl(), name: f.getName() });
}

// Borrar una foto del chat o un boceto (va a la papelera de Drive): solo si está en esas carpetas y lo subió esa persona
// (Admin total puede borrar cualquier boceto).
function trash(b){
  let f; try { f = DriveApp.getFileById(String(b.id || "")); } catch (err){ return out({ ok: false, error: "no existe" }); }
  if (!b.admin && (!b.by || f.getDescription() !== String(b.by))) return out({ ok: false, error: "no es tuya" });
  const roots = [CHAT_FOLDER_ID, BOCETO_FOLDER_ID]; let inChat = false;
  for (const ps = f.getParents(); ps.hasNext();){
    const p = ps.next(); if (roots.indexOf(p.getId()) >= 0) inChat = true;
    for (const pp = p.getParents(); pp.hasNext();) if (roots.indexOf(pp.next().getId()) >= 0) inChat = true;
  }
  if (!inChat) return out({ ok: false, error: "no es una foto del chat ni un boceto" });
  f.setTrashed(true);
  return out({ ok: true });
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
// Qué versión del script de Drive está publicada (la 1 no tiene fotos del chat). Se recuerda un rato.
let scriptV: { url: string; v: number; at: number } | null = null;
async function scriptVersion(url: string, secret: string){
  if (scriptV && scriptV.url === url && Date.now() - scriptV.at < (scriptV.v >= SCRIPT_V ? 30 * 60e3 : 30e3)) return scriptV.v;
  let v = 1;
  try { const j = JSON.parse(await (await fetch(`${url}?k=${encodeURIComponent(secret)}&v=1`, { redirect: "follow" })).text()); v = Number(j.version) || 1; } catch { /* sin respuesta: se toma como la 1 */ }
  scriptV = { url, v, at: Date.now() };
  return v;
}
async function scriptPost(c: any, body: Record<string, unknown>){
  const r = await fetch(c.sticker_url, { method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ k: c.sticker_secret, ...body }) });
  const t = await r.text(); try { return JSON.parse(t); } catch { throw new Error("El script de Drive no respondió bien"); }
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
  const { data: rows } = await db.from("app_state").select("key, data").in("key", ["cache:trends:dg", "cache:trends:cm", "cache:trends:ideas", "s:APP_FLAGS"]);
  const row = (rows || []).find((r: any) => r.key === key), prev = row?.data;
  // Tableros de Pinterest de la galería: los que eligió Admin total (APP_FLAGS.pinboards) o los de referencia.
  const flags = (rows || []).find((r: any) => r.key === "s:APP_FLAGS")?.data || {};
  const boards = (Array.isArray(flags.pinboards) ? flags.pinboards : []).filter((b: any) => typeof b === "string" && /^[^/\s]{1,60}\/[^/\s]{1,100}$/.test(b)).slice(0, 8);
  if (prev?.groups && prev.v === 6 && !force && Date.now() - (prev.at || 0) < 3 * 3600e3) return prev.groups;
  const known = new Map<string, any>();
  (rows || []).filter((r: any) => r.key.startsWith("cache:")).forEach((r: any) => (r.data?.groups || []).forEach((g: any) => (g.items || []).forEach((i: any) => known.set(i.u, i))));
  // CM y Diseño ven cosas distintas: no se repite lo que ya muestra la otra área.
  const other = area === "dg" ? "cache:trends:cm" : area === "cm" ? "cache:trends:dg" : "";
  const exclude = ((rows || []).find((r: any) => r.key === other)?.data?.groups || []).flatMap((g: any) => (g.items || []).map((i: any) => i.u));
  const { groups } = await armar(area, known, { exclude, ...(boards.length ? { boards } : {}) });
  if (groups.some((g) => g.items.length)){
    const data = { v: 6, at: Date.now(), groups };
    if (row) await db.from("app_state").update({ data, updated_at: new Date().toISOString() }).eq("key", key);
    else await db.from("app_state").insert({ key, data });
    return groups;
  }
  return prev?.v >= 2 ? prev.groups : [];
}

// ---------- Noticias: se guardan en app_state (cache:news) y se renuevan cada 3 horas; lo encontrado se va juntando ----------
async function noticias(force: boolean){
  const { data: row } = await db.from("app_state").select("data").eq("key", "cache:news").maybeSingle();
  const prev = row?.data?.v === 1 ? row.data : null;
  if (prev?.items && !force && Date.now() - (prev.at || 0) < 3 * 3600e3) return prev;
  const nuevas = await buscarNoticias();
  const data = { v: 1, at: Date.now(), items: juntarNoticias(prev?.items || [], nuevas) };
  if (row) await db.from("app_state").update({ data, updated_at: new Date().toISOString() }).eq("key", "cache:news");
  else await db.from("app_state").insert({ key: "cache:news", data });
  return data;
}

// ---------- Comercial: las ofertas publicadas de cada quincena (Excel "PUBLICADAS" de la carpeta de ofertas) ----------
// Se guarda en app_state (s:COMERCIAL), una entrada por archivo. Los que después se borran de Drive quedan en la app
// (memoria del mes); de las quincenas de hace más de 4 meses quedan solo los productos destacados.
async function comercialSync(c: any, minAge: number){
  if (!c?.sticker_url) return { ok: false, nokey: true, error: "Falta conectar Google Drive (Configuración → Integraciones)." };
  if (await scriptVersion(c.sticker_url, c.sticker_secret) < 4) return { ok: false, old: true, error: "Falta actualizar el script de Google Drive para leer las ofertas: Admin total lo hace en Configuración → Integraciones." };
  for (let intento = 0; intento < 2; intento++){
    const { data: row } = await db.from("app_state").select("data, version").eq("key", "s:COMERCIAL").maybeSingle();
    const prev = row?.data || {};
    if (prev.syncedAt && Date.now() - Date.parse(prev.syncedAt) < minAge) return { ok: true, skipped: true };
    const l = await scriptPost(c, { kind: "comercial_list" });
    if (!l.ok) throw new Error(l.error || "No se pudo leer la carpeta de ofertas");
    const list = (l.files || []).filter((f: any) => /PUBLICAD/i.test(f.name) && /\.xlsx?$/i.test(f.name));
    const files: Record<string, any> = { ...(prev.files || {}) }; let nuevos = 0, errores = 0;
    for (const f of list){
      const o = files[f.id];
      if (o && o.modified === f.modified && o.v === PARSE_V){ o.inDrive = true; continue; }
      const j = await scriptPost(c, { kind: "comercial_file", id: f.id });
      if (!j.ok || !j.b64){ errores++; continue; }
      const bin = atob(j.b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      let p; try { p = parseOfertas(bytes); } catch { errores++; continue; }
      files[f.id] = { id: f.id, name: f.name, brand: marcaDe(f.name), ...periodo(f.name, new Date(f.created || f.modified)), folleto: p.folleto, title: p.title,
        modified: f.modified, v: PARSE_V, inDrive: true, n: p.count, at: new Date().toISOString(), sheets: p.sheets };
      nuevos++;
    }
    const ids = new Set(list.map((f: any) => f.id));
    for (const id of Object.keys(files)) if (!ids.has(id)) files[id].inDrive = false;
    const lim = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
    for (const x of Object.values(files) as any[]) if (x.to && x.to < lim && !x.light){ x.sheets = (x.sheets || []).map((s: any) => ({ ...s, items: s.items.filter((i: any) => i.flag) })); x.light = true; }
    const now = new Date().toISOString(), data = { v: 1, updated: nuevos || !prev.updated ? now : prev.updated, syncedAt: now, files };
    if (!row){ const { error } = await db.from("app_state").insert({ key: "s:COMERCIAL", data }); if (!error) return { ok: true, nuevos, errores, n: list.length }; continue; }
    const { data: up } = await db.from("app_state").update({ data, version: row.version + 1, updated_at: now }).eq("key", "s:COMERCIAL").eq("version", row.version).select("version");
    if (up && up.length) return { ok: true, nuevos, errores, n: list.length };
  }
  return { ok: false, error: "Se estaba actualizando al mismo tiempo: probá de nuevo." };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  let b: any; try { b = await req.json(); } catch { return json({ ok: false, error: "Pedido inválido" }, 400); }
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(token);
  const { data: m } = u?.user ? await db.from("members").select("person_id, role, active").eq("user_id", u.user.id).maybeSingle() : { data: null };
  // Comercial sin sesión: lo usa la rutina diaria. Solo actualiza (no devuelve ofertas) y como mucho cada 20 minutos.
  if (b?.action === "comercial_sync" && !m?.active){
    try { return json(await comercialSync(await cfg(), 20 * 60e3)); } catch (e: any){ return json({ ok: false, error: e.message || "No se pudo leer" }); }
  }
  if (!u?.user) return json({ ok: false, error: "Iniciá sesión en la app" }, 401);
  if (!m || !m.active) return json({ ok: false, error: "Sin acceso" }, 403);
  const admin = m.role === "Admin total";
  const c = await cfg();
  try {
    switch (b.action){
      case "status":
        if (!admin) return json({ ok: false, error: "Solo Admin total" }, 403);
        return json({ ok: true, giphy: !!c.giphy_key, stickers: !!c.sticker_url, scriptV: c.sticker_url ? await scriptVersion(c.sticker_url, c.sticker_secret) : 0, scriptNeed: SCRIPT_V });
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
        return json({ ok: true, script: scriptText(c.sticker_secret), v: SCRIPT_V });
      case "set_sticker_url": {
        if (!admin) return json({ ok: false, error: "Solo Admin total" }, 403);
        const url = String(b.url || "").trim();
        if (!url){ await db.from("integration_config").update({ sticker_url: null, updated_at: new Date().toISOString() }).eq("id", 1); return json({ ok: true }); }
        if (!SCRIPT_RE.test(url)) return json({ ok: false, error: "La URL tiene que ser la de la Aplicación web: https://script.google.com/macros/s/…/exec" });
        const list = await scriptList(url, c.sticker_secret);
        await db.from("integration_config").update({ sticker_url: url, updated_at: new Date().toISOString() }).eq("id", 1);
        scriptV = null;
        return json({ ok: true, count: list.length, scriptV: await scriptVersion(url, c.sticker_secret) });
      }
      case "gifs":
        if (!c.giphy_key) return json({ ok: false, nokey: true, error: "La búsqueda de GIFs no está conectada" });
        return json({ ok: true, gifs: await giphy(c.giphy_key, String(b.q || "").trim().slice(0, 60)) });
      case "tendencias": {
        const area = b.area === "cm" ? "cm" : b.area === "ideas" ? "ideas" : "dg";
        const groups = await tendencias(area, !!b.force && admin);
        return groups.some((g: any) => g.items.length) ? json({ ok: true, groups }) : json({ ok: false, error: "No se pudieron traer las novedades" });
      }
      case "noticias": {
        const n = await noticias(!!b.force && admin);
        return json({ ok: true, at: n.at, items: n.items });
      }
      case "stickers":
        if (!c.sticker_url) return json({ ok: false, nokey: true, error: "La biblioteca de stickers no está conectada" });
        return json({ ok: true, stickers: (await scriptList(c.sticker_url, c.sticker_secret)).map((s: any) => ({ ...s, url: thumb(s.id) })) });
      case "sticker_upload": {
        if (!c.sticker_url) return json({ ok: false, nokey: true, error: "La biblioteca de stickers no está conectada" });
        if (!TYPES.includes(b.type)) return json({ ok: false, error: "La imagen tiene que ser PNG, WEBP, GIF o JPG" });
        const size = Math.floor(String(b.data || "").length * 3 / 4);
        if (!size || size > MAX_BYTES) return json({ ok: false, error: "El sticker supera 400 KB" });
        const j = await scriptPost(c, { name: b.name, type: b.type, data: b.data, by: m.person_id });
        if (!j.ok) return json({ ok: false, error: j.error || "No se pudo guardar" });
        return json({ ok: true, sticker: { ...j.sticker, url: thumb(j.sticker.id) } });
      }
      // Fotos del chat: se guardan en Google Drive ("Fotos Retail MKT" → carpeta del mes), no en la base.
      case "chat_image": {
        if (!c.sticker_url) return json({ ok: false, nokey: true, error: "Las fotos del chat todavía no están conectadas: Admin total conecta el script de Google Drive en Configuración → Integraciones." });
        if (!TYPES.includes(b.type)) return json({ ok: false, error: "La foto tiene que ser JPG, PNG, WEBP o GIF" });
        const size = Math.floor(String(b.data || "").length * 3 / 4);
        if (!size || size > CHAT_MAX) return json({ ok: false, error: "La foto supera 4 MB" });
        if (await scriptVersion(c.sticker_url, c.sticker_secret) < 2) return json({ ok: false, old: true, error: "Falta actualizar el script de Google Drive para las fotos: Admin total lo hace en Configuración → Integraciones." });
        const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[b.type];
        const name = `${m.person_id}-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}.${ext}`;
        const j = await scriptPost(c, { kind: "chat", name, type: b.type, data: b.data, by: m.person_id });
        if (!j.ok || !j.file?.id) return json({ ok: false, error: j.error || "No se pudo guardar la foto" });
        return json({ ok: true, id: j.file.id });
      }
      // Al eliminar un mensaje con foto, la foto va a la papelera de Drive (solo la puede borrar quien la subió).
      case "chat_image_delete": {
        const id = String(b.id || "");
        if (!c.sticker_url || !/^[\w-]{10,100}$/.test(id)) return json({ ok: false, error: "Foto inválida" });
        const j = await scriptPost(c, { kind: "trash", id, by: m.person_id });
        return json({ ok: !!j.ok, ...(j.ok ? {} : { error: j.error || "No se pudo borrar" }) });
      }
      // Bocetos de los pedidos: se guardan en Google Drive (carpeta de Bocetos → carpeta del mes), no en la base.
      case "boceto_upload": {
        if (!c.sticker_url) return json({ ok: false, nokey: true, error: "Google Drive todavía no está conectado: Admin total lo conecta en Configuración → Integraciones." });
        const size = Math.floor(String(b.data || "").length * 3 / 4);
        if (!size || size > BOCETO_MAX) return json({ ok: false, error: "El boceto supera 10 MB: subí una versión más liviana" });
        if (await scriptVersion(c.sticker_url, c.sticker_secret) < 3) return json({ ok: false, old: true, error: "Falta actualizar el script de Google Drive para los bocetos: Admin total lo hace en Configuración → Integraciones." });
        const type = /^[\w.+-]+\/[\w.+-]+$/.test(String(b.type || "")) ? String(b.type) : "application/octet-stream";
        const base = String(b.name || "boceto").replace(/[\\/:*?"<>|#%]+/g, "_").replace(/\s+/g, " ").trim().slice(-80) || "boceto";
        const job = String(b.job || "").replace(/[^\w-]+/g, "").slice(0, 20);
        const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).replace(", ", " ").replace(":", "");
        const name = `${job ? job + " · " : ""}${stamp} · ${base}`; // ej.: D-117 · 2026-10-06 1530 · lookbook.jpg (hora de Paraguay)
        const j = await scriptPost(c, { kind: "boceto", name, type, data: b.data, by: m.person_id });
        if (!j.ok || !j.file?.id) return json({ ok: false, error: j.error || "No se pudo guardar el boceto" });
        return json({ ok: true, id: j.file.id, name: j.file.name, mime: j.file.mime, size: j.file.size });
      }
      // Comercial: "Actualizar" (cualquiera del equipo) o al abrir la página si hace rato que no se revisa.
      case "comercial_sync":
        return json(await comercialSync(c, b.force ? 15e3 : 30 * 60e3));
      // Videos editados de CM: carpeta del mes en Drive, subida directa y link para compartir.
      case "video_folder": case "video_session": case "video_done": {
        if (!admin && m.role !== "CM") return json({ ok: false, error: "Solo CM o Admin total" }, 403);
        if (!c.sticker_url) return json({ ok: false, nokey: true, error: "Falta conectar Google Drive (Configuración → Integraciones)." });
        if (await scriptVersion(c.sticker_url, c.sticker_secret) < 4) return json({ ok: false, old: true, error: "Falta actualizar el script de Google Drive para subir videos: Admin total lo hace en Configuración → Integraciones." });
        if (b.action === "video_folder") return json(await scriptPost(c, { kind: "video_folder" }));
        if (b.action === "video_done"){
          if (!/^[\w-]{10,100}$/.test(String(b.id || ""))) return json({ ok: false, error: "Video inválido" });
          return json(await scriptPost(c, { kind: "video_done", id: String(b.id) }));
        }
        const size = Number(b.size) || 0, type = String(b.type || "");
        if (!/^video\//.test(type)) return json({ ok: false, error: "Elegí un archivo de video" });
        if (!size || size > 5 * 1024 ** 3) return json({ ok: false, error: "El video supera 5 GB" });
        const name = String(b.name || "video").replace(/[\\/:*?"<>|#%]+/g, "_").slice(-140);
        return json(await scriptPost(c, { kind: "video_session", name, type, size, origin: req.headers.get("origin") || "", by: m.person_id }));
      }
      case "boceto_delete": {
        const id = String(b.id || "");
        if (!c.sticker_url || !/^[\w-]{10,100}$/.test(id)) return json({ ok: false, error: "Boceto inválido" });
        const j = await scriptPost(c, { kind: "trash", id, by: m.person_id, admin });
        return json({ ok: !!j.ok, ...(j.ok ? {} : { error: j.error || "No se pudo borrar" }) });
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
