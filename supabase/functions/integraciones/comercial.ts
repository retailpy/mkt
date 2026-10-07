// Comercial · las ofertas publicadas de cada quincena (los Excel "PUBLICADAS" de la carpeta de ofertas en Drive).
// Lee el Excel tal cual (hojas, páginas del folleto, códigos y precios) y arma una lista liviana para la app.
import * as XLSX from "npm:xlsx@0.18.5";

export const PARSE_V = 1; // si cambia la forma de leer, se vuelven a leer todos los archivos

const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const key = (v: unknown) => norm(v).toUpperCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^A-Z%]/g, "");
// Encabezados del Excel → nombre corto en la app
const HEAD: Record<string, string> = {
  SECTOR: "sector", CODIGO: "cod", MATERIAL: "mat", DESCRIPCION: "desc", PVP: "pvp", OFERTA: "of", TEMATICA: "tem",
  "%DESC": "pct", RECONOCIMIENTO: "rec", OFERTASNEGOCIADAS: "neg", PROVEEDOR: "prov", NPROV: "nprov", SUBCATEGORIA: "sub",
};
const num = (v: unknown) => typeof v === "number" ? v : null;
const clean = (v: unknown) => { const s = norm(v); return /^\W?#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?)$/i.test(s) ? "" : s; }; // celdas con error de Excel
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
    let col: Record<string, number> | null = null, sec = "", label = "", flagCol = -1;
    const items: any[] = [];
    for (const r of rows){
      const ks = r.map(key);
      // Encabezado (puede repetirse más abajo, con otro título arriba)
      if (ks.includes("DESCRIPCION") && ks.includes("OFERTA")){
        col = {}; ks.forEach((k, i) => { if (HEAD[k] && col![HEAD[k]] === undefined) col![HEAD[k]] = i; });
        flagCol = ks.findIndex((k, i) => i < (col!.sector ?? 1) && !HEAD[k]); if (flagCol < 0) flagCol = 0;
        sec = ""; continue;
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
        if (s && !/^SE.ALAR PRODUCTOS/i.test(s)) sec = s.replace(/\s*\/\s*/g, " / ");
        continue;
      }
      const of = g("of"), f = flagCol >= 0 ? flag(r[flagCol]) : null;
      items.push({
        sec, sector: norm(g("sector")), cod: txtNum(g("cod")), mat: txtNum(g("mat")), desc,
        pvp: num(g("pvp")), of: typeof of === "number" ? of : norm(of), tem: norm(g("tem")), pct: pct(g("pct")),
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
export function periodo(name: string, ref: Date){
  const m = name.match(/(\d{1,2})(?:[-\/.](\d{1,2}))?\s*AL\s*(\d{1,2})[-\/.](\d{1,2})/i); if (!m) return {};
  const d1 = +m[1], d2 = +m[3], m2 = +m[4], m1 = m[2] ? +m[2] : (d1 <= d2 ? m2 : (m2 === 1 ? 12 : m2 - 1));
  let y1 = ref.getUTCFullYear(); if (m1 - (ref.getUTCMonth() + 1) < -6) y1++; // archivo de diciembre para enero
  const y2 = m2 < m1 ? y1 + 1 : y1, p = (n: number) => String(n).padStart(2, "0");
  return { from: `${y1}-${p(m1)}-${p(d1)}`, to: `${y2}-${p(m2)}-${p(d2)}` };
}
export const marcaDe = (name: string) => /\bS6\b|SUPERSEIS/i.test(name) ? "Superseis" : /STOCK/i.test(name) ? "Stock" : /DELI/i.test(name) ? "Delimarket" : "";
