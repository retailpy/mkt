// Retail MKT Hub · biblioteca de stickers en Google Drive (carpeta "Stickers Retail MKT").
// Se instala UNA vez con la cuenta dueña de la carpeta (ver docs/STICKERS.md). Corre como esa cuenta:
// guarda los stickers en la carpeta y los deja visibles con el link (para que se vean en el chat).
// Solo responde a quien manda la clave KEY (la tiene guardada Vercel, nunca el navegador).
const FOLDER_ID = "1EwWLkJ3XCl927Yi0ryCvFC807Vdp0iFk";
const MAX_BYTES = 400 * 1024;                                   // 400 KB por sticker
const TYPES = ["image/png", "image/webp", "image/gif", "image/jpeg"];

const out = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
const okKey = k => k && k === PropertiesService.getScriptProperties().getProperty("KEY");

function doGet(e){
  if (!okKey(e.parameter.key)) return out({ ok: false, error: "no autorizado" });
  const files = DriveApp.getFolderById(FOLDER_ID).getFiles(), list = [];
  while (files.hasNext()){
    const f = files.next();
    if (!TYPES.includes(f.getMimeType())) continue;
    list.push({ id: f.getId(), name: f.getName(), by: f.getDescription() || "", ts: f.getDateCreated().toISOString() });
  }
  list.sort((a, b) => b.ts.localeCompare(a.ts));
  return out({ ok: true, stickers: list });
}

function doPost(e){
  let b; try { b = JSON.parse(e.postData.contents); } catch (err){ return out({ ok: false, error: "pedido inválido" }); }
  if (!okKey(b.key)) return out({ ok: false, error: "no autorizado" });
  if (!TYPES.includes(b.type)) return out({ ok: false, error: "tipo de imagen no permitido" });
  const bytes = Utilities.base64Decode(b.data || "");
  if (!bytes.length || bytes.length > MAX_BYTES) return out({ ok: false, error: "la imagen supera 400 KB" });
  const name = String(b.name || "sticker").replace(/[^\w\- áéíóúñÁÉÍÓÚÑ]/g, "").slice(0, 40) || "sticker";
  const f = DriveApp.getFolderById(FOLDER_ID).createFile(Utilities.newBlob(bytes, b.type, name));
  f.setDescription(String(b.by || "").slice(0, 40));
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return out({ ok: true, sticker: { id: f.getId(), name: f.getName(), by: f.getDescription(), ts: f.getDateCreated().toISOString() } });
}
