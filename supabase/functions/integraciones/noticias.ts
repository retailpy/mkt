// Noticias (Panel de CM): lo que sale en los medios de Paraguay sobre Retail S.A. y sus marcas, de los últimos 3 meses.
// Fuentes: la búsqueda de Google Noticias y de Bing Noticias por cada marca, y los feeds del día de ABC Color y La Nación.
// Solo medios de Paraguay (o notas que nombran a Paraguay). Lo usa index.ts (acción "noticias"), que va juntando lo que
// encuentra en cache:news, así la lista se completa aunque un buscador no traiga todo.
import { __rss } from "./tendencias.ts";
const { UA, decode, strip, tag, pickImg } = __rss;

export const NEWS_DAYS = 92;
// strict: el nombre es común (Bianca, Dayo) → la marca tiene que aparecer en el título o el resumen, con su contexto.
// uniq: el nombre solo existe acá (Superseis, Clasipar, PediWOW) → vale también de un medio de afuera si lo nombra.
// qs: búsquedas que traen ruido (el Grupo Vierci también es dueño de medios) → la nota tiene que nombrar la marca en el título o el resumen.
type B = { b: string; q: string[]; qs?: string[]; re: RegExp; strict?: boolean; uniq?: boolean };
export const NEWS_BRANDS: B[] = [
  { b: "Retail S.A.", q: ['"Retail S.A." Paraguay', '"Retail SA" supermercados'], qs: ['"Grupo Vierci" Paraguay'], re: /\bretail s\.?\s?a\b|grupo vierci/i },
  { b: "Superseis", q: ["Superseis", '"Super 6" supermercado'], re: /s[uú]perseis|s[uú]per ?6\b/i, uniq: true },
  { b: "Stock", q: ['"Supermercados Stock"', "Stock Superseis"], re: /supermercados? stock\b|\bstock\b[^.]{0,60}s[uú]perseis|s[uú]perseis[^.]{0,60}\bstock\b/i },
  { b: "Delimarket", q: ["Delimarket", '"Deli Market" Paraguay'], re: /deli ?market/i },
  { b: "Bianca", q: ['"Bianca" moda Paraguay', '"Bianca" tienda Asunción'], re: /\bbianca\b[^.]{0,80}\b(moda|ropa|colecci[oó]n|tienda|local|marca|outlet)|\b(moda|ropa|colecci[oó]n|tienda|marca|outlet)\b[^.]{0,80}\bbianca\b/i, strict: true },
  { b: "Dayo", q: ['"Dayo" comida Paraguay', '"DAYO" delivery Asunción'], re: /\bdayo\b[^.]{0,80}\b(comida|delivery|almuerzo|restaurante|men[uú]|pedido)|\b(comida|delivery|almuerzo|restaurante|men[uú]|pedido)\b[^.]{0,80}\bdayo\b/i, strict: true },
  { b: "PediWOW", q: ["PediWOW", '"Pedi WOW"'], re: /pedi ?wow/i, uniq: true },
  { b: "Clasipar", q: ["Clasipar"], re: /clasipar/i, uniq: true },
];
const FEEDS = [
  { u: "https://www.abc.com.py/arc/outboundfeeds/rss/?outputType=xml", src: "ABC Color" },
  { u: "https://www.lanacion.com.py/arc/outboundfeeds/rss/?outputType=xml", src: "La Nación" },
  { u: "https://www.elnacional.com.py/feed/", src: "El Nacional" },
  { u: "https://www.unicanal.com.py/feed/", src: "Unicanal" },
];
// Medios de Paraguay: dominio .py o estos (Última Hora usa .com); o una nota de afuera que habla de Paraguay.
const PY_HOSTS = new Set(["ultimahora.com", "elsurti.com"]);
const PY_TXT = /paraguay|asunci[oó]n|caacup[eé]|lambar[eé]|encarnaci[oó]n|ciudad del este|fernando de la mora|capiat[aá]|itaugu[aá]|mariano roque alonso|[ñn]emby|conacom|guaran[ií]es/i;
const isPY = (host: string, txt: string) => host.endsWith(".py") || PY_HOSTS.has(host) || PY_TXT.test(txt);
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

export type News = { t: string; u: string; x: string; img: string; d: string; src: string; host: string; brands: string[] };

async function getText(u: string){
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(u, { headers: { "User-Agent": UA, "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.5" }, signal: ctl.signal });
    if (!r.ok) return "";
    const buf = new Uint8Array(await r.arrayBuffer()), head = new TextDecoder("latin1").decode(buf.slice(0, 200));
    const cs = (r.headers.get("content-type")?.match(/charset=([\w-]+)/i)?.[1] || head.match(/encoding=["']([\w-]+)["']/i)?.[1] || "utf-8").toLowerCase();
    let txt: string; try { txt = new TextDecoder(cs).decode(buf); } catch { txt = new TextDecoder().decode(buf); }
    return txt.slice(0, 2_000_000);
  } catch { return ""; } finally { clearTimeout(tm); }
}
const itemsOf = (xml: string) => [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)].map((m) => m[0]).slice(0, 100);
const dateOf = (it: string) => { const t = Date.parse(decode(tag(it, "pubDate") || tag(it, "dc:date")).trim()); return isNaN(t) ? "" : new Date(t).toISOString(); };

// Google Noticias: el título trae " - Medio" al final; el medio y su sitio vienen en <source>. Sin foto ni resumen.
function fromGoogle(xml: string): News[] {
  return itemsOf(xml).map((it) => {
    const src = strip(tag(it, "source")), surl = decode((it.match(/<source[^>]+url="([^"]+)"/) || [])[1] || "");
    let t = strip(tag(it, "title")); if (src && t.endsWith(" - " + src)) t = t.slice(0, -(src.length + 3));
    return { t, u: decode(tag(it, "link")).trim(), x: "", img: "", d: dateOf(it), src, host: hostOf(surl), brands: [] };
  });
}
// Bing Noticias: el link real va en el parámetro url; el medio en News:Source y la foto en News:Image.
function fromBing(xml: string): News[] {
  return itemsOf(xml).map((it) => {
    const raw = decode(tag(it, "link")).trim(); let u = raw; try { u = new URL(raw).searchParams.get("url") || raw; } catch { /* queda el de Bing */ }
    const bi = decode(tag(it, "News:Image")).trim();
    return { t: strip(tag(it, "title")), u, x: strip(tag(it, "description")).slice(0, 280), img: bi ? bi.replace(/^http:/, "https:") + "&w=480&h=270&c=14" : "", d: dateOf(it), src: strip(tag(it, "News:Source")) || hostOf(u), host: hostOf(u), brands: [] };
  });
}
function fromFeed(xml: string, src: string): News[] {
  return itemsOf(xml).map((it) => {
    const u = decode(tag(it, "link")).trim(), desc = tag(it, "description");
    return { t: strip(tag(it, "title")), u, x: strip(desc).slice(0, 280), img: pickImg(it, decode(desc + tag(it, "content:encoded"))), d: dateOf(it), src, host: hostOf(u), brands: [] };
  });
}

const gn = (q: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:90d")}&hl=es-419&gl=PY&ceid=PY:es-419`; // solo lo de los últimos 3 meses
const bn = (q: string) => `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=es&qft=${encodeURIComponent('sortbydate="1"')}`;
const keyOf = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 70);
const fresh = (n: News, now: number) => { const t = Date.parse(n.d); return !isNaN(t) && now - t <= NEWS_DAYS * 864e5 && t <= now + 864e5; };

// Busca todo y devuelve las notas nuevas (de Paraguay, de los últimos 3 meses, con su marca).
export async function buscarNoticias(): Promise<News[]> {
  const now = Date.now(), out: News[] = [];
  const jobs: Promise<void>[] = [];
  for (const br of NEWS_BRANDS) for (const q of [...br.q, ...(br.qs || [])]) for (const [url, parse] of [[gn(q), fromGoogle], [bn(q), fromBing]] as const) {
    const strict = br.strict || !!br.qs?.includes(q);
    jobs.push(getText(url).then((xml) => {
      for (const n of parse(xml)){
        const txt = n.t + " " + n.x;
        if (!n.t || !/^https?:\/\//.test(n.u) || !fresh(n, now)) continue;
        if (!isPY(n.host, txt) && !(br.uniq && br.re.test(txt))) continue; // de afuera: solo si nombra una marca que existe solo acá
        if (strict && !br.re.test(txt)) continue; // nombre común (o búsqueda con ruido): tiene que estar en el título o el resumen
        // La búsqueda ya encontró la marca en la nota (aunque no esté en el título); las demás marcas, si se nombran.
        n.brands = [br.b, ...NEWS_BRANDS.filter((o) => o.b !== br.b && !o.strict && o.re.test(txt)).map((o) => o.b)];
        out.push(n);
      }
    }));
  }
  for (const f of FEEDS) jobs.push(getText(f.u).then((xml) => {
    for (const n of fromFeed(xml, f.src)){
      const txt = n.t + " " + n.x, brands = NEWS_BRANDS.filter((o) => o.re.test(txt)).map((o) => o.b);
      if (brands.length && n.t && fresh(n, now)){ n.brands = brands; out.push(n); }
    }
  }));
  await Promise.all(jobs);
  return out;
}

// Junta lo guardado con lo nuevo: una sola nota por título (con todas sus marcas; se prefiere la que tiene foto y link
// directo al medio), solo los últimos 3 meses, de la más nueva a la más vieja.
export function juntarNoticias(prev: News[], nuevas: News[]): News[] {
  const now = Date.now(), map = new Map<string, News>();
  for (const n of [...nuevas, ...prev]){
    if (!n?.t || !fresh(n, now)) continue;
    const k = keyOf(n.t), o = map.get(k);
    if (!o){ map.set(k, { ...n, brands: [...new Set(n.brands || [])] }); continue; }
    const better = (!o.img && n.img) || (/news\.google\./.test(o.u) && !/news\.google\./.test(n.u));
    const m = better ? { ...n, x: n.x || o.x, img: n.img || o.img } : { ...o, x: o.x || n.x, img: o.img || n.img };
    m.brands = [...new Set([...(o.brands || []), ...(n.brands || [])])];
    map.set(k, m);
  }
  return [...map.values()].sort((a, b) => b.d.localeCompare(a.d)).slice(0, 400);
}
// Para las pruebas.
export const __n = { fromGoogle, fromBing, fromFeed, isPY, keyOf };
