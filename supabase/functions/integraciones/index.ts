// Retail MKT Hub · integraciones del chat: búsqueda de GIFs (GIPHY) y biblioteca de stickers en Google Drive.
// Las claves quedan en la base (tabla integration_config, sin acceso desde la app); el navegador nunca las ve.
// Acciones (POST { action, ... }, con la sesión de la persona):
//   status · set_giphy {key} · script · set_sticker_url {url}       → solo Admin total
//   gifs {q} · stickers · sticker_upload {name,type,data}           → cualquier persona del equipo
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
    }
    return json({ ok: false, error: "Acción desconocida" }, 400);
  } catch (e: any){
    console.error("[integraciones]", b.action, e?.message);
    return json({ ok: false, error: e?.message || "No se pudo completar" });
  }
});
