// Comercial · las ofertas de Superseis, Stock y Delimarket (los Excel de las carpetas de ofertas en Drive).
// Lee el Excel tal cual (hojas, páginas del folleto, códigos y precios) y arma una lista liviana para la app.
import * as XLSX from "npm:xlsx@0.18.5";

export const PARSE_V = 4; // si cambia la forma de leer, se vuelven a leer todos los archivos (2: sin “INTERNAS”, bloque “Adicional”, Excel de fin de semana e Imbatibles · 3: “DESCRIPCION FOLLETO” y “NOVEDAD”) · 4: precio normal con texto (“solo destacar”) tal cual

const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const key = (v: unknown) => norm(v).toUpperCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^A-Z%]/g, "");
// Encabezados del Excel → nombre corto en la app
const HEAD: Record<string, string> = {
  SECTOR: "sector", CODIGO: "cod", MATERIAL: "mat", DESCRIPCION: "desc", PVP: "pvp", OFERTA: "of", TEMATICA: "tem",
  "%DESC": "pct", RECONOCIMIENTO: "rec", OFERTASNEGOCIADAS: "neg", PROVEEDOR: "prov", NPROV: "nprov", SUBCATEGORIA: "sub",
};
// Otros nombres de columna (Excel de fin de semana, Express, Imbatibles…): solo se usan si falta el nombre de arriba.
const HEAD2: Record<string, string> = {
  PRODUCTO: "desc", ARTICULO: "desc", DESCRIPCIONDELPRODUCTO: "desc", DESCRIPCIONARTICULO: "desc", NOMBRE: "desc",
  PRECIOOFERTA: "of", PRECIODEOFERTA: "of", PRECIOPROMO: "of", PRECIOPROMOCION: "of", PRECIOPROMOCIONAL: "of", PROMO: "of", OFERTAGS: "of",
  PVPOFERTA: "of", PVPOFERTAS: "of", PRECIOOFERTAS: "of", CODIGOARTICULO: "cod", MATERIALSAP: "mat", OFERTANEGOCIADA: "neg", NPROVEEDOR: "nprov", "VAR%PRECIO": "pct",
  PRECIONORMAL: "pvp", PRECIOREGULAR: "pvp", PRECIOACTUAL: "pvp", PRECIO: "pvp", PRECIOANTES: "pvp", PVPACTUAL: "pvp",
  "%": "pct", "%DESCUENTO": "pct", DESCUENTO: "pct", DESC: "pct", COD: "cod", CODIGOSAP: "cod", SKU: "cod", EAN: "cod", SECCION: "sector", CATEGORIA: "sector",
  // Excel “FINAL” (Stock): el texto del folleto es el nombre del producto y la novedad dice si es nuevo o se mantiene de la quincena anterior.
  DESCRIPCIONFOLLETO: "dfol", DESCFOLLETO: "dfol", DESCRIPCIONDEFOLLETO: "dfol", DESCRIPCIONPARAFOLLETO: "dfol", TEXTOFOLLETO: "dfol", NOMBREFOLLETO: "dfol",
  NOVEDAD: "nov", NOVEDADES: "nov",
};
const esDesc = (k: string) => HEAD[k] === "desc" || HEAD2[k] === "desc", esOferta = (k: string) => HEAD[k] === "of" || HEAD2[k] === "of";
const num = (v: unknown) => typeof v === "number" ? v : null;
// Precio normal: el número, o el texto tal cual si el Excel puso otra cosa (“solo destacar”); vacío → null.
const pvpDe = (v: unknown) => typeof v === "number" ? v : clean(v) || null;
const clean = (v: unknown) => { const s = norm(v); return /^\W?#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?)$/i.test(s) ? "" : s; }; // celdas con error de Excel
// Novedad: “NUEVO” → “Nuevo”, “SE MANTIENE” → “Se mantiene”.
const novedad = (v: unknown) => { const k = key(v); if (!k) return ""; if (/^NUEV/.test(k)) return "Nuevo"; if (/MANTIEN/.test(k)) return "Se mantiene"; const s = norm(v).toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };
const txtNum = (v: unknown) => typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(Math.round(v))) : norm(v);
// % de descuento: 0.06 → "6%", "-35%" → "35%", "2 X 14.000" queda como está
function pct(v: unknown){
  if (typeof v === "number") return v ? `${Math.round(Math.abs(v <= 1 && v >= -1 ? v * 100 : v))}%` : "";
  const s = norm(v); const m = s.match(/^-?\s*(\d+(?:[.,]\d+)?)\s*%$/); return m ? `${Math.round(+m[1].replace(",", "."))}%` : s;
}
// Marca de la fila (primera columna): tapa, destacar, zócalo de redes, publicada, confirmado…
function flag(v: unknown){
  const s = norm(v), k = key(s); if (!s || /SENALARPRODUCTOS/.test(k) || /PRODUCTOSDESTACADOSENTAPA/.test(k)) return null;
  if (/TAPA/.test(k)) return { t: "Tapa", x: s };
  if (/DESTAC/.test(k)) return { t: "Destacar", x: s };
  if (/[SZ]OCALO/.test(k)) return { t: "Zócalo redes", x: s };
  if (/PUBLICAD/.test(k)) return { t: "Publicada", x: s.replace(/^PUBLICADA\s*/i, "") };
  if (/CONFIRMAD/.test(k)) return { t: "Confirmado", x: s };
  return { t: s.slice(0, 40), x: s };
}

export function parseOfertas(bytes: Uint8Array){
  const wb = XLSX.read(bytes, { type: "array" });
  const sheets: any[] = []; let title = "", folleto = "";
  for (const name of wb.SheetNames){
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: "" });
    // interna: filas debajo de “INTERNAS” (no se publican: no van) · blk: bloque “Adicional… solo para destacar en redes”
    let col: Record<string, number> | null = null, sec = "", label = "", flagCol = -1, interna = false, blk = "";
    const items: any[] = [];
    for (const r of rows){
      const ks = r.map(key);
      // Encabezado (puede repetirse más abajo, con otro título arriba)
      if (ks.some(esDesc) && ks.some(esOferta)){
        col = {}; ks.forEach((k, i) => { if (HEAD[k] && col![HEAD[k]] === undefined) col![HEAD[k]] = i; });
        ks.forEach((k, i) => { if (HEAD2[k] && col![HEAD2[k]] === undefined && !Object.values(col!).includes(i)) col![HEAD2[k]] = i; });
        const usada = (i: number) => Object.values(col!).includes(i); // la columna de la marca (Tapa, Destacar…) no es una de las de arriba
        flagCol = ks.findIndex((k, i) => i < (col!.sector ?? 1) && !HEAD[k] && !usada(i)); if (flagCol < 0) flagCol = usada(0) ? -1 : 0;
        sec = ""; interna = false; continue;
      }
      const line = norm(r.find((x) => norm(x)) ?? "");
      if (!col){ // arriba del encabezado: título de la hoja ("OFERTAS QUINCENAL … FOLLETO 19", "HALLOWEEN OKTOBER FEST")
        const t = r.map(norm).find((x) => /OFERTA|FOLLETO|[A-Z]{4,}/.test(x) && !/^VIGENCIA$|^PUBLICADAS$/i.test(x));
        if (t && !label) label = t;
        continue;
      }
      const g = (k: string) => col![k] === undefined ? "" : r[col![k]];
      const desc = norm(g("desc"));
      if (!desc){
        // Fila de sección: "Pag. 5 Almacén", "TAPA PRODUCTO 1", "CARNES/FYV"… (o un título nuevo arriba de otro encabezado)
        const s = norm(g("sector")) || (/OFERTA|FOLLETO/i.test(line) ? "" : line);
        if (/OFERTAS QUINCENAL|FOLLETO/i.test(line)){ if (!label) label = line; continue; }
        if (/^ADICIONAL\b/i.test(s || line)){ blk = "Adicional"; sec = ""; interna = false; continue; }
        if (/^INTERNAS?$/i.test(line)){ interna = true; continue; }
        if (s && !/^SE.ALAR PRODUCTOS/i.test(s)){ sec = s.replace(/\s*\/\s*/g, " / "); interna = false; }
        continue;
      }
      if (interna || /^VIGENCIA\b/i.test(desc)) continue; // ofertas internas y la fila “VIGENCIA DESDE / HASTA” repetida
      const of = g("of"), ofv = typeof of === "number" ? of : norm(of), dfol = clean(g("dfol"));
      let f = flagCol >= 0 ? flag(r[flagCol]) : null, sector = norm(g("sector"));
      if (!f && /^DESTAC/i.test(sector)){ f = { t: "Destacar", x: sector }; sector = ""; } // Delimarket marca “DESTACAR” en la columna del sector
      // Con “DESCRIPCION FOLLETO”: las filas sin ese texto son variantes del producto de arriba (mismo cuadro del folleto:
      // “Salamín RANCHO 250 gr. Con/sin picante”). Van juntas en un solo producto, con sus códigos y precios.
      const prev = items[items.length - 1], s0 = blk ? (sec ? `${blk} · ${sec}` : blk) : sec;
      if (col!.dfol !== undefined && !dfol && prev?.fol && prev.sec === s0 && prev.sector === sector){
        (prev.vars ||= []).push({ d: desc, cod: txtNum(g("cod")), mat: txtNum(g("mat")), pvp: pvpDe(g("pvp")), of: ofv, pct: pct(g("pct")) });
        if (f && !prev.flag) Object.assign(prev, { flag: f.t, fx: f.x });
        continue;
      }
      const nov = novedad(g("nov"));
      items.push({
        sec: s0, sector, cod: txtNum(g("cod")), mat: txtNum(g("mat")), desc: dfol || desc, ...(dfol ? { fol: 1, dsis: desc } : {}), ...(nov ? { nov } : {}),
        pvp: pvpDe(g("pvp")), of: ofv, tem: norm(g("tem")), pct: pct(g("pct")),
        rec: typeof g("rec") === "number" ? g("rec") : norm(g("rec")), neg: norm(g("neg")), prov: norm(g("prov")),
        nprov: txtNum(g("nprov")), sub: typeof g("sub") === "string" ? clean(g("sub")) : "", ...(f ? { flag: f.t, fx: f.x } : {}),
      });
    }
    if (!items.length) continue;
    if (!title && /OFERTA/i.test(label)) title = label;
    const fm = label.match(/FOLLETO\s*(\d+)/i); if (fm && !folleto) folleto = fm[1];
    sheets.push({ name, label: label.replace(/\s+/g, " ").trim(), items });
  }
  return { title, folleto, sheets, count: sheets.reduce((n, s) => n + s.items.length, 0) };
}

// "OF. QUINCENAL PUBLICADAS S6 12 AL 25-10.xlsx" → del 12/10 al 25/10 · "26-10 AL 08-11" → del 26/10 al 08/11
// También "17 AL 19 DE OCTUBRE", "30 DE OCTUBRE AL 2 DE NOVIEMBRE" y solo el mes ("IMBATIBLES S6 OCTUBRE" → todo el mes).
const MES_RE = "ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE";
const mesN = (t: string) => { const i = MES_RE.split("|").indexOf(t.toUpperCase()); return i < 0 ? 0 : i < 9 ? i + 1 : i; }; // SETIEMBRE = SEPTIEMBRE
export function periodo(name: string, ref: Date){
  const up = name.toUpperCase().normalize("NFD").replace(/\p{M}/gu, "");
  // También con guion bajo y año: "02_10_2026 AL 04_10_2026", "16_10_26 al 18_10_26".
  let m: any = up.match(/(\d{1,2})(?:[-\/._](\d{1,2})(?:[-\/._](\d{4}|\d{2})(?!\d))?)?\s*AL\s*(\d{1,2})[-\/._](\d{1,2})(?:[-\/._](\d{4}|\d{2})(?!\d))?/);
  const anio = (t?: string) => t ? (t.length === 2 ? 2000 + +t : +t) : 0;
  if (m){ const ya = anio(m[3]), yb = anio(m[6]); m = [m[0], m[1], m[2] || "", m[4], m[5], ya, yb]; }
  if (!m){ const t = up.match(new RegExp(`(\\d{1,2})(?:\\s*DE\\s*(${MES_RE}))?\\s*AL\\s*(\\d{1,2})\\s*(?:DE\\s*)?(${MES_RE})`)); if (t) m = [t[0], t[1], t[2] ? String(mesN(t[2])) : "", t[3], String(mesN(t[4])), 0, 0]; }
  if (!m){ const t = up.match(new RegExp(`(?:^|[^A-Z])(${MES_RE})(?:[^A-Z]|$)`)); if (!t) return {};
    const mm = mesN(t[1]); let y = ref.getUTCFullYear(); if (mm - (ref.getUTCMonth() + 1) < -6) y++;
    const p = (n: number) => String(n).padStart(2, "0"); return { from: `${y}-${p(mm)}-01`, to: `${y}-${p(mm)}-${p(new Date(Date.UTC(y, mm, 0)).getUTCDate())}` }; }
  const d1 = +m[1], d2 = +m[3], m2 = +m[4], m1 = m[2] ? +m[2] : (d1 <= d2 ? m2 : (m2 === 1 ? 12 : m2 - 1));
  let y1 = ref.getUTCFullYear(); if (m1 - (ref.getUTCMonth() + 1) < -6) y1++; // archivo de diciembre para enero
  let y2 = m2 < m1 ? y1 + 1 : y1; const p = (n: number) => String(n).padStart(2, "0");
  if (m[6]){ y2 = m[6]; y1 = m[5] || (m2 < m1 ? y2 - 1 : y2); } else if (m[5]){ y1 = m[5]; y2 = m2 < m1 ? y1 + 1 : y1; } // el año escrito en el nombre manda
  return { from: `${y1}-${p(m1)}-${p(d1)}`, to: `${y2}-${p(m2)}-${p(d2)}` };
}
export const marcaDe = (name: string) => /\bS6\b|SUPERSEIS/i.test(name) ? "Superseis" : /STOCK/i.test(name) ? "Stock" : /DELI/i.test(name) ? "Delimarket" : "";

// ---------- De qué carpeta sale cada categoría y cómo se reconoce cada archivo por su nombre ----------
// Carpetas de Drive (solo lectura). Express e Imbatibles son compartidas entre Superseis y Stock: la marca sale del nombre.
export const FOLLETOS_ID = "1-xZ--Tb9rvCYDpmh2zrsYQz-jy-AfDBf";
// Carpetas de antes de las quincenales («OFERTA QUINCENAL S6» y «OFERTA QUINCENAL STOCK»): ya NO se leen (v252). Quedan para lo guardado.
export const VIEJA_S6_ID = "1ciqZuhAtcIa-_OYYutd-8Zq8CTPZS-5N", VIEJA_STOCK_ID = "1RIqkeQ7iR22JX_j3k5JqZXdMsPl0x7eP";
export const FUENTES: { id: string; cat: string; brand?: string }[] = [
  { id: "16e3im1-9kYWZ7rZixRtRPUelHyDSoxxy", cat: "fds", brand: "Superseis" },        // "FDS SG"
  { id: "1iHSUvW6WbZO2WDSZ0o3VtS345p48aAdR", cat: "fds", brand: "Stock" },            // "FDS Stock"
  { id: "1NnZGuw3iWQaWNqz5axsE4zWlUAW-sXhA", cat: "fds", brand: "Delimarket" },       // "FDS Deli"
  { id: "14b8mp9dItU2SmoJUbiaCNc9g3vBI3xal", cat: "express" },                        // "S6 Express Publicadas" y "Stock Express (publicadas)"
  { id: "1wnr3i0WNIUOuOEILUg5z_LWdmHd1A79W", cat: "imbatibles" },                     // "Imbatibles S6" e "Imbatibles Stock"
  // «MKT - FOLLETOS»: la ÚNICA carpeta de las quincenales de Superseis y Stock (compartida: la marca sale del nombre).
  // Solo se usan los Excel que dicen FINAL (la corrección final de Comercial).
  { id: FOLLETOS_ID, cat: "quincenal" },
];
// Nombre del archivo en mayúsculas, sin acentos y con espacios alrededor de cada palabra: " FDS SG 17 AL 19 10 XLSX ".
const palabras = (name: string) => ` ${name.toUpperCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\.XLSX?$|\.XLSM$/, "").replace(/[^A-Z0-9%]+/g, " ").trim()} `;
const MARCA_RE: Record<string, RegExp> = { Superseis: / S6 | SUPERSEIS | SUPER SEIS | SG /, Stock: / STOCK /, Delimarket: / DELI | DELIMARKET /, };
// Quincenal: solo la versión “FINAL” de la carpeta «MKT - FOLLETOS» (un PUBLICADAS ahí queda pendiente de revisión).
const CAT_RE: Record<string, RegExp> = { quincenal: / PUBLICAD| FINAL /, fds: / FDS | FIN DE SEMANA /, express: / EXPRESS /, imbatibles: / IMBATIBLE/ };
// Qué es un archivo de una carpeta: { brand, cat } si se reconoce · { pending: motivo } si parece de la categoría pero no se puede
// asegurar (queda “pendiente de revisión”) · null si no es de la categoría (otra dinámica, versión interna…: no se usa).
export function clasificar(name: string, fu: { cat: string; brand?: string }): { brand: string; cat: string; final?: boolean } | { pending: string } | null {
  const w = palabras(name);
  if (!CAT_RE[fu.cat].test(w)) return null;
  if (/ INTERN/.test(w)) return null; // versiones internas: nunca (sobre todo en Express)
  if (fu.cat === "express" && !/ PUBLICAD/.test(w)) return { pending: "No dice “publicada” en el nombre: Express usa solo las versiones publicadas." };
  const marcas = Object.keys(MARCA_RE).filter((b) => MARCA_RE[b].test(w));
  if (fu.brand){ // carpeta de una sola marca: si el nombre dice otra marca, no se mezcla
    if (marcas.length && !marcas.includes(fu.brand)) return { pending: `El nombre dice ${marcas.join(" y ")}, pero está en la carpeta de ${fu.brand}.` };
    return { brand: fu.brand, cat: fu.cat, ...(fu.cat === "quincenal" && / FINAL /.test(w) ? { final: true } : {}) };
  }
  if (fu.cat === "quincenal" && !/ FINAL /.test(w)) return { pending: "No dice FINAL en el nombre: las quincenales de Superseis y Stock usan solo el Excel FINAL." };
  const b = marcas.filter((x) => x !== "Delimarket"); // carpeta compartida: Superseis o Stock, según el nombre
  if (b.length !== 1) return { pending: b.length ? "El nombre dice Superseis y Stock a la vez." : "El nombre no dice si es de Superseis (S6) o de Stock." };
  return { brand: b[0], cat: fu.cat, ...(fu.cat === "quincenal" && / FINAL /.test(w) ? { final: true } : {}) };
}

// Nombre del respaldo: "Ofertas Superseis del 12 al 25 de octubre (Folleto 19)"
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export function nombreOfertas(f: any){
  const [a, b] = [f.from, f.to].map((d: string) => ({ d: +d.slice(8, 10), m: +d.slice(5, 7) - 1 }));
  const rango = a.m === b.m ? `${a.d} al ${b.d} de ${MESES[b.m]}` : `${a.d} de ${MESES[a.m]} al ${b.d} de ${MESES[b.m]}`;
  const cat = ({ fds: " fin de semana", express: " Express", imbatibles: " Imbatibles" } as Record<string, string>)[f.cat] || "";
  return `Ofertas${cat} ${f.brand || "Superseis"} del ${rango}${f.folleto ? ` (Folleto ${f.folleto})` : ""}`;
}
// Excel armado con lo guardado (cuando el original ya no está en Drive), en base64. Una hoja por hoja del original.
const COLS: [string, (i: any) => unknown][] = [["Página / sección", (i) => i.sec || i.sector], ["Descripción", (i) => i.desc], ["PVP", (i) => i.pvp ?? ""], ["Oferta", (i) => i.of ?? ""],
  ["% desc", (i) => i.pct], ["Marca", (i) => i.fx || i.flag || ""], ["Sector", (i) => i.sector], ["Código", (i) => i.cod], ["Material", (i) => i.mat], ["Temática", (i) => i.tem],
  ["Reconocimiento", (i) => i.rec ?? ""], ["Ofertas negociadas", (i) => i.neg], ["Proveedor", (i) => i.prov], ["N° prov", (i) => i.nprov], ["Subcategoría", (i) => i.sub]];
export function excelOfertas(f: any){
  const wb = XLSX.utils.book_new();
  (f.sheets || []).forEach((s: any, k: number) => {
    const ws = XLSX.utils.aoa_to_sheet([COLS.map((c) => c[0]), ...(s.items || []).map((i: any) => COLS.map((c) => c[1](i)))]);
    XLSX.utils.book_append_sheet(wb, ws, String(s.name || `Hoja ${k + 1}`).slice(0, 31));
  });
  return XLSX.write(wb, { type: "base64", bookType: "xlsx" }) as string;
}
