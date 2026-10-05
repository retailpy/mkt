// Tendencias (Diseño y CM): qué hacen los supermercados y las marcas de consumo en campañas gráficas, packaging,
// punto de venta y redes sociales. Solo prensa creativa y de diseño: nada de noticias de negocios (ventas, acciones,
// aperturas, nombramientos, estudios de mercado). Fuentes: la búsqueda de cada medio (WordPress: ?s=…&feed=rss2, ordenada
// por fecha) y sus feeds. Lo que viene en portugués o inglés se traduce al español. Pão de Açúcar va siempre primero.
// Lo usa index.ts (acción "tendencias"); acá no se toca la base.

type Feed = { u: string; src: string; lang: string; cc: string; days: number; bing?: boolean; pin?: string };
export type Item = { t: string; u: string; x: string; img: string; d: string; src: string; lang: string; chain: string; cc: string; tr?: boolean };

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 RetailMKTHub/1.0";
const plus = (s: string) => encodeURIComponent(s).replace(/%20/g, "+");
// Un medio con WordPress: sin texto es su feed (lo último, 45 días); con texto, su búsqueda (piezas de hasta 13 meses).
const wp = (base: string, src: string, lang: string, cc: string) => (q?: string): Feed => q
  ? { u: `${base}/?s=${plus(q)}&feed=rss2&orderby=date&order=DESC`, src, lang, cc, days: 400 }
  : { u: `${base}/feed/`, src, lang, cc, days: 45 };
const M = {
  roast: wp("https://roastbrief.com.mx", "Roastbrief", "es", "MX"),           // campañas y redes de marcas (México y Latinoamérica)
  creativos: wp("https://www.creativosonline.org", "Creativos Online", "es", "ES"),
  brandemia: wp("https://www.brandemia.org", "Brandemia", "es", "ES"),       // branding y packaging
  propmark: wp("https://propmark.com.br", "Propmark", "pt", "BR"),           // campañas de Brasil (Pão de Açúcar)
  promoview: wp("https://www.promoview.com.br", "Promoview", "pt", "BR"),     // activaciones y punto de venta (Brasil)
  cotw: wp("https://campaignsoftheworld.com", "Campaigns of the World", "en", "WW"),
  bpando: wp("https://bpando.org", "BP&O", "en", "WW"),                      // branding y packaging
  dieline: wp("https://thedieline.com", "The Dieline", "en", "US"),          // packaging
  rdb: wp("https://retaildesignblog.net", "Retail Design Blog", "en", "WW"), // diseño de tiendas
  dezeen: wp("https://www.dezeen.com", "Dezeen", "en", "GB"),
};
// Roastbrief: su búsqueda tarda demasiado; sus etiquetas (supermercados, tiktok, halloween…) responden al instante.
const slug = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const RT = (t: string): Feed => ({ u: `https://roastbrief.com.mx/tag/${slug(t)}/feed/`, src: "Roastbrief", lang: "es", cc: "MX", days: 400 });
// Tableros de Pinterest (afiches, encartes, posteos y carruseles de diseño): su feed oficial (RSS). Los elige Admin total.
export const PIN_BOARDS = ["stephanygonzalezblanco95/inspiración-redes-sociales", "94maripf/social-media-post-design", "chellypoplima/modelos-encarte"];
const PIN = (b: string): Feed => ({ u: `https://www.pinterest.com/${b.split("/").map(encodeURIComponent).join("/")}.rss`, src: "Pinterest", lang: "es", cc: "WW", days: 3650, pin: b });
const P: Record<string, Feed> = { // medios sin búsqueda por feed: solo lo último
  mm: { u: "https://www.meioemensagem.com.br/feed", src: "Meio & Mensagem", lang: "pt", cc: "BR", days: 45 },
  gkpb: { u: "https://gkpb.com.br/feed/", src: "GKPB", lang: "pt", cc: "BR", days: 45 },
  adnews: { u: "https://adnews.com.br/feed/", src: "AdNews", lang: "pt", cc: "BR", days: 45 },
  potw: { u: "https://packagingoftheworld.com/feed", src: "Packaging of the World", lang: "en", cc: "WW", days: 45 },
  graffica: { u: "https://graffica.info/feed/", src: "Gràffica", lang: "es", cc: "ES", days: 45 },
  smt: { u: "https://www.socialmediatoday.com/feeds/news/", src: "Social Media Today", lang: "en", cc: "US", days: 30 },
};
// Bing Noticias: solo para Ideas Random (lo que se está haciendo viral en redes).
const MKT: Record<string, string> = { es: "setlang=es&cc=MX", en: "setlang=en&cc=US" };
const B = (q: string, lang = "es"): Feed => ({ u: `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&qft=${encodeURIComponent('sortbydate="1"')}&${MKT[lang]}`, src: "Bing", lang, cc: lang === "es" ? "LA" : "US", days: 30, bing: true });

// Fechas comerciales que vienen (Paraguay/Latinoamérica): cómo las comunican los supermercados y las marcas.
const FECHAS: Record<number, string[]> = { 0:["vuelta a clases","verano"], 1:["vuelta a clases","San Valentín"], 2:["Pascua","Semana Santa"], 3:["Pascua","Día de la Madre"], 4:["Día de la Madre","Día del Padre"],
  5:["Día del Padre","San Juan"], 6:["vacaciones de invierno","Día de la Amistad"], 7:["Día del Niño","primavera"], 8:["primavera","Día del Niño"], 9:["Halloween","Black Friday"], 10:["Black Friday","Navidad"], 11:["Navidad","Año Nuevo"] };
// [búsqueda en español, en inglés, en portugués, cómo reconocerla en el texto]
const FECHA: Record<string, [string, string, string, RegExp]> = {
  "Navidad": ["navidad", "christmas", "natal", /navidad|navide[ñn]|christmas|xmas|\bnatal(ino|ina|inas|inos)?\b|pap[aá] noel|santa claus|holiday (ad|campaign|season)/i],
  "Black Friday": ["black friday", "black friday", "black friday", /black friday|cyber monday|cyber week/i],
  "Halloween": ["halloween", "halloween", "halloween", /halloween|d[ií]a de (los )?muertos|dia das bruxas/i],
  "Año Nuevo": ["año nuevo", "new year", "réveillon", /a[ñn]o nuevo|new year|ano novo|r[ée]veillon|fin de a[ñn]o/i],
  "Pascua": ["pascua", "easter", "páscoa", /pascua|easter|p[aá]scoa/i],
  "Semana Santa": ["semana santa", "easter", "semana santa", /semana santa|holy week|easter/i],
  "San Valentín": ["san valentín", "valentine", "dia dos namorados", /san valent[ií]n|valentine|enamorados|dia dos namorados/i],
  "Día de la Madre": ["día de la madre", "mother's day", "dia das mães", /d[ií]a de la madre|d[ií]a de las madres|mother'?s day|dia das m[aã]es/i],
  "Día del Padre": ["día del padre", "father's day", "dia dos pais", /d[ií]a del padre|father'?s day|dia dos pais/i],
  "vuelta a clases": ["regreso a clases", "back to school", "volta às aulas", /vuelta a clases|regreso a clases|back to school|volta [àa]s aulas|[uú]tiles escolares/i],
  "verano": ["verano", "summer", "verão", /verano|\bsummer\b|ver[aã]o/i],
  "San Juan": ["san juan", "festa junina", "festa junina", /san juan|festas? juninas?|s[aã]o jo[aã]o/i],
  "vacaciones de invierno": ["vacaciones de invierno", "winter", "férias de inverno", /vacaciones de invierno|f[ée]rias de inverno|winter (campaign|holidays)/i],
  "Día de la Amistad": ["día del amigo", "friendship day", "dia do amigo", /d[ií]a de la amistad|d[ií]a del amigo|friendship day|dia do amigo/i],
  "Día del Niño": ["día del niño", "children's day", "dia das crianças", /d[ií]a del ni[ñn]o|d[ií]a de la ni[ñn]ez|children'?s day|dia das crian[cç]as/i],
  "primavera": ["primavera", "spring", "primavera", /primavera|\bspring\b/i],
};
export const fechasQueVienen = () => { const m = new Date().getMonth(); return [...new Set([...FECHAS[m], ...FECHAS[(m + 1) % 12]])].slice(0, 3); };

// Cadenas de referencia → país (para la banderita) y nombre.
const CHAINS: [RegExp, string, string][] = [
  [/p[aã]o de a[cç][uú]car/i, "BR", "Pão de Açúcar"], [/\bst\.? ?marche\b/i, "BR", "St. Marche"], [/zona sul/i, "BR", "Zona Sul"], [/\bassa[ií] atacadista|\batacad[aã]o\b/i, "BR", "Assaí / Atacadão"],
  [/\boxxo\b/i, "MX", "OXXO"], [/city market/i, "MX", "City Market"], [/\bla comer\b/i, "MX", "La Comer"], [/chedraui/i, "MX", "Chedraui"], [/soriana/i, "MX", "Soriana"], [/bodega aurrera/i, "MX", "Bodega Aurrera"],
  [/ametller/i, "ES", "Ametller Origen"], [/corte ingl[eé]s/i, "ES", "El Corte Inglés"], [/hipercor/i, "ES", "Hipercor"], [/mercadona/i, "ES", "Mercadona"], [/bonpreu|esclat/i, "ES", "Bonpreu"], [/\beroski\b/i, "ES", "Eroski"], [/alcampo/i, "ES", "Alcampo"],
  [/whole foods/i, "US", "Whole Foods"], [/trader joe/i, "US", "Trader Joe's"], [/wegmans/i, "US", "Wegmans"], [/sprouts farmers/i, "US", "Sprouts"], [/\bwalmart\b/i, "US", "Walmart"], [/costco/i, "US", "Costco"], [/kroger/i, "US", "Kroger"], [/fairway/i, "US", "Fairway"],
  [/waitrose/i, "GB", "Waitrose"], [/\bm&s\b|marks (&|and) spencer/i, "GB", "M&S Food"], [/\btesco\b/i, "GB", "Tesco"], [/sainsbury/i, "GB", "Sainsbury's"], [/\basda\b/i, "GB", "Asda"], [/co-?op food/i, "GB", "Co-op"],
  [/monoprix/i, "FR", "Monoprix"], [/carrefour/i, "FR", "Carrefour"], [/intermarch[eé]/i, "FR", "Intermarché"], [/albert heijn/i, "NL", "Albert Heijn"], [/\blidl\b/i, "DE", "Lidl"], [/\baldi\b/i, "DE", "Aldi"], [/\bedeka\b/i, "DE", "Edeka"], [/\brewe\b/i, "DE", "REWE"],
  [/\bJumbo\b/, "CL", "Jumbo"], [/tottus/i, "CL", "Tottus"], [/unimarc/i, "CL", "Unimarc"], [/\bcoto\b/i, "AR", "Coto"], [/carulla/i, "CO", "Carulla"], [/\bmakro\b/i, "LA", "Makro"],
  [/freshippo|\bhema\b/i, "CN", "Freshippo / Hema"], [/\baeon\b/i, "JP", "AEON"], [/\be-?mart\b/i, "KR", "Emart"], [/woolworths/i, "AU", "Woolworths"], [/\bcoles\b/i, "AU", "Coles"],
];
const chainOf = (t: string) => { for (const [re, cc, n] of CHAINS) if (re.test(t)) return { cc, n }; return null; };

// ---------- Qué es cada nota (en español, portugués e inglés) ----------
const SUPER = /supermerc|supermarket|hipermerc|hypermarket|grocer|mercearia|atacarejo|minimercado|autoservicio|convenience store|tienda de conveniencia|loja de conveni|marca propia|marca pr[oó]pria|marca blanca|private label|own[- ]brand|store brand/i;
const FOOD = /aliment|comida|\bfood|snack|bebida|beverage|\bdrinks?\b|cerveza|cerveja|\bbeer|\bvino\b|vinho|\bwine|caf[eé]\b|coffee|helado|sorvete|ice cream|chocolate|galleta|biscoito|bolacha|cookie|\bpan\b|\bp[aã]es?\b|bread|panader|padaria|bakery|leche|leite|\bmilk|queso|queijo|cheese|\bcarnes?\b|\bmeat|frut|fruit|verdura|vegetal|hortali|pizza|hamburgues|burger|ketchup|mayonesa|maionese|salsa|molho|\bsauce|cereal|yogur|iogurte|yogurt|refresco|refrigerante|\bsoda|jugo|\bsuco|juice|dulce|\bdoce|candy|golosina|caramelo|pasta|\barroz|\brice\b|aceite|azeite|\boil\b|condimento|tempero|\bspices?\b|receta|receita|recipe|cocina|cozinha|kitchen|\bchef|restaurante|restaurant|mcdonald|burger king|\bkfc\b|coca-cola|pepsi|heinz|nestl[eé]|doritos|lay'?s|oreo|kit ?kat|fanta|sprite|red bull|danone|unilever|kraft|mondelez|ambev|heineken|corona\b|starbucks|domino'?s|subway|taco bell|pizza hut|ifood|rappi|uber eats|delivery|bimbo|gamesa|sabritas|guaran[aá]|skol|brahma|doriana|bauducco|piracanjuba|britannia|uncrustables/i;
const DESIGN = /dise[ñn]o|design|empaque|embalaje|envoltorio|branding|rebrand|identidad (visual|de marca|corporativa)|identidade (visual|de marca)|visual identity|brand identity|nueva imagen|nova identidade|nueva identidad|\blogo|tipograf|typograph|ilustraci|ilustra[cç]|illustrat|afiche|\bcartel\b|cartaz|p[oó]sters?\b|flyer|folleto|folheto|encarte|key visual|gr[aá]fica|graphic|packag|embalag|envase|art direction|direcci[oó]n de arte|dire[cç][aã]o de arte|mascota|mascote|mascot|personaje|edici[oó]n limitada|edi[cç][aã]o limitada|limited[- ]edition/i;
const PACK = /packag|embalag|embalaje|empaque|envoltorio|envase|etiqueta|r[oó]tulo|\blabels?\b|\blatas?\b|\bcans?\b|botella|garrafa|bottle|frasco|\bjar\b|caja de|caixa de|\bbox\b|edici[oó]n limitada|edi[cç][aã]o limitada|limited[- ]edition|marca propia|marca pr[oó]pria|private label|own[- ]brand/i;
const CAMPAIGN = /campa[ñn]|campanha|campaign|anuncio|an[uú]ncio|advert|\bads?\b|commercial\b|nuevo comercial|novo comercial|comercial de (tv|televisi|natal|navidad)|\bspot\b|publicidad|publicidade|propaganda|activaci[oó]n|ativa[cç][aã]o|activation|\bstunt|\booh\b|outdoor|v[ií]a p[uú]blica|m[ií]dia exterior|billboard|valla|colaboraci[oó]n|colabora[cç][aã]o|\bcollab|parceria|alianza|edici[oó]n limitada|edi[cç][aã]o limitada|limited[- ]edition|\bfilme\b|cortometraje/i;
const LAUNCH = /\blanza|\blan[cç]a|launch|estrena|estreia|presenta\b|apresenta|nuevo sabor|novo sabor|new flavou?r|novedad|novidade/i;
const SOCIAL = /tiktok|instagram|facebook|whatsapp|threads|youtube|redes sociales|redes sociais|social media|\breels?\b|carrusel|carrossel|carousel|\bstories\b|\bmemes?\b|viral|influencer|influenciador|creador(es|as)? de contenido|criador(es|as)? de conte[uú]do|content creators?|\bcreators?\b|\bugc\b|\btrends?\b|tendencia en redes|challenge|\breto\b|desaf[ií]o|hashtag|serie vertical|\bstreamer|community manager|en redes|nas redes|engagement|seguidores|followers|comentarios|coment[aá]rios/i;
const POS = /punto de venta|ponto de venda|point[- ]of[- ]sale|\bpop\b|in-?store|exhibici|exhibidor|\bdisplays?\b|g[oó]ndola|\bshelf|shelves|prateleira|lineal|vitrine|vidriera|escaparate|window display|carteler[ií]a|se[ñn]al[ée]tica|sinaliza[cç][aã]o|signage|wayfinding|store design|(dise[ñn]o|interiorismo) de (la )?tienda|projeto de loja|interiorismo|interior design|retail design|tienda concepto|loja conceito|concept store|flagship|\blayout|checkout|carrito|carrinho|trolley|shopping cart|\btote\b|sacola|bolsa (reutilizable|de compras)|estande|merchandising|pop-?up|nueva tienda|nova loja|new store|store (redesign|interior|concept)|supermarket (interior|design)|grocery store design/i;
// Afuera (en el título): negocios, nombramientos, cuentas de agencias, estudios, eventos, tecnología, el morro Pão de Açúcar y policiales.
const NEG_T = new RegExp([
  "\\bventas (suben|caen|crecen|bajan|aumentan|r[eé]cord)", "sus ventas", "r[eé]cord (de|en) ventas", "\\bvendas (sobem|caem|crescem|recorde)", "recorde de vendas", "\\bsales (rise|fall|grow|growth|drop|up|down|jump|surge|decline)", "like-for-like", "(record|annual|quarterly) sales",
  "factur", "faturamento", "ganancia", "\\blucro", "ingresos", "receita (l[ií]quida|bruta|operacional)", "revenue", "earnings", "\\bprofits?\\b", "resultados? (financ|trimes|del (primer|segundo|tercer|cuarto) trimestre|anuales|de ventas|l[ií]quido)", "trimestre", "\\bq[1-4]\\b", "quarterly", "(first|second|third|fourth) quarter", "balan[cç]o",
  "acciones (suben|bajan|caen|se disparan)", "a[cç][oõ]es (sobem|caem|disparam|recuam|do gpa|da companhia|da empresa)", "bolsa de valores", "ibovespa", "pcar3", "\\bb3\\b", "cotiza", "(stock|share) price", "inversi[oó]n", "inversores", "inversionista", "investimento", "investidor", "\\binvest",
  "recupera[cç][aã]o judicial", "d[ií]vida", "deuda", "\\bdebt", "\\bipo\\b", "fusi[oó]n", "fus[aã]o", "merger", "adquisici", "aquisi[cç]", "acquisi", "compra (de|da|do) (rede|empresa|participa)", "market share", "cuota de mercado", "participa[cç][aã]o de mercado",
  "crecimiento", "crescimento", "\\bgrowth\\b", "motor de", "\\bsector\\b", "\\bsetor\\b", "negocios?\\b", "neg[oó]cios?\\b", "\\bbusiness", "empresas\\b", "industria", "ind[uú]stria", "el mercado", "o mercado", "the market\\b", "mercado (de|do) (consumo|trabajo|trabalho|varejo|retail|alimentos)",
  "comportamiento del consumidor", "comportamento do consumidor", "consumer (behaviou?r|trends|insights|spending)", "h[aá]bitos de (consumo|compra)", "consumidores (gastan|prefieren|buscan)",
  "\\bceo\\b", "\\bcfo\\b", "\\bcmo\\b", "diretora?\\b", "director (general|ejecutivo|de marketing|creativo)", "presidente", "\\bvp\\b", "vicepresidente", "executiv", "nombra", "nomea", "\\bcontrata", "ficha a", "appoint", "\\bhires\\b", "\\bnamed\\b",
  "se (une|suma) a (la agencia|el equipo)", "assume (a|o|como) (dire|presid|vice|cargo|lideran)", "promovid[oa] a", "deixa (a|o) (cargo|empresa|ag[eê]ncia)",
  "layoff", "despid", "demiss", "sindicat", "huelga", "greve", "\\bstrike", "demanda", "juicio", "processo (judicial|contra)", "processa ", "lawsuit", "\\bsues?\\b", "multa", "recall", "retira del mercado", "arancel", "tarifa", "tariff", "inflaci", "infla[cç][aã]o", "precios? (sube|baja)", "pre[cç]os? (sobe|cai)",
  "expansi[oó]n", "expans[aã]o", "(gana|conquista|suma|consigue) (la |a )?(nueva )?cuenta", "nova conta", "conquista (a )?conta", "wins (the )?account", "account win", "\\bpitch", "licitaci", "agencia del a[ñn]o", "ag[eê]ncia do ano", "holding",
  "retail media", "m[ií]dia de varejo", "medios de retail", "program[aá]tic", "adtech", "martech", "\\bcrm\\b", "\\berp\\b", "saas", "software", "first[- ]party", "anunciantes",
  "pesquisa", "survey", "encuesta", "estudio (revela|de mercado|muestra|indica|se[ñn]ala|sobre)", "seg[uú]n (un|el) estudio", "estudo (revela|mostra|aponta|indica)", "segundo (o |um )?estudo", "\\bstudy (finds|shows|reveals)", "new study", "informe", "relat[oó]rio", "\\breport", "ranking", "[ií]ndice", "webinar", "podcast", "entrevista", "interview", "opini[oó]n", "columna", "coluna",
  "says commenter", "comments? update", "readers? (say|react)", "campanhas da semana", "congreso", "congresso", "conference", "summit", "feria", "trade show", "apas show", "\\bnrf\\b", "\\bexpo\\b", "\\bforo\\b", "f[oó]rum", "jornada", "masterclass", "\\bcurso", "workshop",
  "chatgpt", "openai", "gemini", "copilot", "wordpress", "plugin", "\\bapps? para", "inteligencias artificiales", "agentic", "ag[ée]ntico", "metaverso", "blockchain", "cripto", "\\bnft", "transformaci[oó]n digital",
  "bondinho", "morro d", "\\burca\\b", "telef[ée]rico", "cable car", "sugarloaf", "corrida", "caminhada", "maratona", "marathon", "carrera", "caminata", "corre y camina", "cart[aã]o-postal", "cart[õo]es-postais", "ponto tur[ií]stico",
  "asalt", "\\brobo\\b", "assalto", "roubo", "crimen", "\\bcrime", "polic[ií]a", "\\bmuri[oó]", "asesin", "fallec", "falece", "\\bdie[ds]\\b", "killed", "tiroteo", "incendio", "inc[eê]ndio", "accidente", "acidente",
  "gobierno", "governo", "government", "elecci", "elei[cç]", "election", "ministerio", "minist[eé]rio", "impuesto", "imposto", "\\btax\\b", "\\bley\\b", "\\blei\\b", "regulaci", "regula[cç]",
].join("|"), "i");
// Aperturas de tiendas: afuera, salvo que la nota sea del diseño de la tienda (concepto, pop-up, interiorismo).
const OPEN = /inaugura|\babr(e|en|ir[aá]n?|i[oó]) (su |sus |una |uma |a |o |nova |nueva |novas |nuevas |primera |primeira |\d+ )*(tiendas?|lojas?|sucursal(es)?|locales|unidades|stores?)\b|nuevas? (tiendas|sucursal(es)?|locales)|novas? lojas|new stores?|store openings?|apertura de|abertura de|cierre de|fechamento|\bcloses?\b|closing/i;
const OPEN_OK = /pop-?up|concept|conceito|concepto|tempor(al|[aá]ri)|ef[ií]mer|dise[ñn]o|design|interior|experiencia|experi[eê]ncia|flagship/i;
const negTitle = (t: string) => NEG_T.test(t) || (OPEN.test(t) && !OPEN_OK.test(t));
// Afuera aunque esté en el resumen: finanzas fuertes y el morro.
const NEG_X = /pcar3|ibovespa|faturamento|lucro l[ií]quido|receita l[ií]quida|earnings|quarterly|recupera[cç][aã]o judicial|bondinho|morro do p[aã]o|corrida e caminhada|carrera y caminata|corre y camina/i;
// Restan puntos: premios, IA, notas generales sobre “el marketing”.
const SOFT = /premio|pr[eê]mio|award|\blions\b|effie|ganadores|vencedores|winners|shortlist|jurado|\bj[uú]ri\b|\bia\b|\bai\b|inteligencia artificial|intelig[eê]ncia artificial|el marketing|o marketing|marketers?|estrategia|estrat[eé]gia|strategy|tendencias para|insights?/i;

type F = { sup: number; chain: number; pda: number; food: number; des: number; pack: number; camp: number; launch: number; soc: number; pos: number; soft: number; fecha: number };
const feat = (t: string, x: string, fechaRe?: RegExp): F => {
  const all = t + " " + x, ch = chainOf(all);
  return { sup: SUPER.test(all) || ch ? 1 : 0, chain: ch ? 1 : 0, pda: ch?.n === "Pão de Açúcar" ? 1 : 0, food: FOOD.test(all) ? 1 : 0, des: DESIGN.test(all) ? 1 : 0, pack: PACK.test(all) ? 1 : 0,
    camp: CAMPAIGN.test(all) ? 1 : 0, launch: LAUNCH.test(t) ? 1 : 0, soc: SOCIAL.test(all) ? 1 : 0, pos: POS.test(all) ? 1 : 0, soft: SOFT.test(t) ? 1 : 0, fecha: fechaRe && fechaRe.test(all) ? 1 : 0 };
};

type G = { k: string; n: number; cap: number; pda?: boolean; feeds: () => Feed[]; need: (f: F) => boolean; score: (f: F) => number; fecha?: boolean };
const fechaFeeds = () => fechasQueVienen().flatMap((f) => { const [es, en, pt] = FECHA[f] || [f, f, f]; return [RT(es), M.creativos(es), M.cotw(en), M.propmark(pt)]; });
const GROUPS: Record<string, G[]> = {
  dg: [
    // Campañas visuales: campañas gráficas, piezas, packaging y rediseños de supermercados (y de las marcas que venden).
    { k: "super", n: 8, cap: 3, pda: true,
      feeds: () => [M.cotw("supermarket"), M.cotw("grocery"), RT("supermercados"), RT("supermercado"), RT("walmart"), RT("oxxo"), M.creativos("supermercado"), M.brandemia("supermercado"), M.propmark("supermercado"), M.propmark("pão de açúcar"), M.bpando("supermarket"), M.dieline("supermarket"),
        M.roast(), M.cotw(), M.creativos(), M.brandemia(), M.propmark(), P.gkpb, P.mm, P.adnews],
      need: (f) => (f.sup || f.food) && (f.des || f.camp) ? true : false,
      score: (f) => 4 * f.sup + 2 * f.chain + f.food + 2 * f.des + 2 * f.camp + f.pack + 0.5 * f.launch - 2 * f.soft },
    // Punto de venta y packaging: exhibición, cartelería, tiendas, envases y marca propia.
    { k: "insp", n: 8, cap: 3,
      feeds: () => [M.dieline("grocery"), M.dieline("private label"), M.bpando("grocery"), M.bpando("supermarket"), M.rdb("supermarket"), M.rdb("grocery"), M.dezeen("supermarket"), M.promoview("supermercado"), M.brandemia("packaging"),
        M.dieline(), M.bpando(), P.potw, P.graffica, M.rdb()],
      need: (f) => (f.pack || f.pos) && (f.sup || f.food) ? true : false,
      score: (f) => 3 * f.sup + 3 * f.pack + 2 * f.pos + f.des + f.food + f.chain - 2 * f.soft },
    // Visuales (si todavía no hay posteos de Instagram): piezas de campañas y packaging, como galería.
    { k: "vis", n: 12, cap: 4, pda: true,
      feeds: () => [M.cotw("supermarket"), M.cotw("grocery"), M.cotw("food"), M.propmark("pão de açúcar"), M.dieline("grocery"), M.bpando("grocery"), M.bpando("supermarket"), P.potw, M.dieline()], // sin fotos de personas ni de eventos
      need: (f) => (f.sup || f.food) && (f.des || f.camp || f.pack) ? true : false,
      score: (f) => 3 * f.sup + f.chain + f.food + 2 * f.des + f.camp + f.pack - 2 * f.soft },
  ],
  cm: [
    // Contenidos que funcionan: lo que hacen en redes los supermercados y las marcas de consumo.
    { k: "super", n: 8, cap: 3, pda: true,
      feeds: () => [RT("supermercados"), RT("supermercado"), RT("walmart"), RT("oxxo"), RT("tiktok"), RT("redes-sociales"), RT("instagram"), M.cotw("social media"), M.cotw("grocery"), M.creativos("supermercado"), M.propmark("pão de açúcar"), M.propmark("supermercado"),
        M.roast(), M.cotw(), P.gkpb, P.mm, P.adnews],
      need: (f) => (f.sup || f.food) && (f.soc || f.camp) ? true : false,
      score: (f) => 4 * f.sup + 2 * f.chain + 3 * f.soc + f.camp + f.food + 0.5 * f.launch - 2 * f.soft },
    // Campañas y contenidos por fecha: cómo comunican las fechas que vienen (las del año pasado también sirven de referencia).
    { k: "redes", n: 8, cap: 3, fecha: true, feeds: fechaFeeds,
      need: (f) => f.fecha && (f.camp || f.soc || f.des || f.launch) ? true : false, // campañas de la fecha de cualquier marca de consumo (primero supermercados y alimentos)
      score: (f) => 3 * f.sup + f.chain + 2 * f.soc + f.camp + f.des + 2 * f.food - 2 * f.soft },
    { k: "vis", n: 12, cap: 4, pda: true,
      feeds: () => [M.cotw("supermarket"), M.cotw("social media"), M.propmark("pão de açúcar"), M.cotw("grocery"), M.cotw("food"), M.dieline("grocery")],
      need: (f) => (f.sup || f.food) && (f.camp || f.soc || f.des) ? true : false,
      score: (f) => 3 * f.sup + f.chain + 2 * f.soc + f.camp + f.des + f.food - 2 * f.soft },
  ],
  // Ideas Random (CM): lo que está pegando en TikTok, Instagram y Facebook.
  ideas: [
    { k: "ideas", n: 12, cap: 4,
      feeds: () => [B("tendencia TikTok"), B("viral TikTok comida"), B("trend Instagram reels"), B("challenge viral redes"), B("receta viral TikTok"), B("TikTok food trend", "en"), B("viral Instagram reel trend", "en"), RT("tiktok"), RT("viral"), P.smt],
      need: (f) => !!f.soc, score: (f) => 2 * f.soc + 2 * f.food + f.sup - f.soft },
  ],
};

// ---------- Lectura de los feeds ----------
const decode = (t: string) => t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&#8230;|&hellip;/g, "…").replace(/&#8217;|&rsquo;/g, "’").replace(/&#8216;|&lsquo;/g, "‘").replace(/&#822[01];|&[lr]dquo;/g, "\"")
  .replace(/&#8211;|&ndash;/g, "–").replace(/&#8212;|&mdash;/g, "—").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const strip = (h: string) => decode(decode(h)).replace(/<[^>]+>/g, " ").replace(/La entrada .*? se publicó primero en .*$/s, "").replace(/The post .*? appeared first on .*$/s, "").replace(/O post .*? apareceu primeiro em .*$/s, "")
  .replace(/\[(…|\.\.\.)\]/g, "…").replace(/\s+/g, " ").trim();
const tag = (x: string, n: string) => { const m = x.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`)); return m ? m[1] : ""; };
const BAD_IMG = /s\.w\.org|gravatar|emoji|feedburner|pixel|spacer|blank\.|\/avatars?\/|\/icons?\/|1x1|\.svg(\?|$)|\.gif(\?|$)|placeholder|share-?button|facebook\.com\/tr|doubleclick|\/\/ads\./i;
const bigger = (u: string) => u.replace(/-(\d{2,3})x(\d{2,3})(?=\.(jpe?g|png|webp)(\?|$))/i, (m, w, h) => (+w <= 300 && +h <= 300 ? "" : m)); // miniatura de WordPress → la imagen entera
function pickImg(it: string, html: string){
  const cands = [
    ...[...it.matchAll(/<media:(?:content|thumbnail)[^>]+url=["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...it.matchAll(/<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']image/g)].map((m) => m[1]),
    ...[...it.matchAll(/<enclosure[^>]+type=["']image[^"']*["'][^>]*url=["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...html.matchAll(/<img[^>]+src=["']([^"']+)["']/g)].map((m) => m[1]),
  ].map((u) => decode(u).trim().replace(/^http:\/\//, "https://")).filter((u) => /^https:\/\//.test(u) && !BAD_IMG.test(u));
  return cands.length ? bigger(cands[0]) : "";
}
export type Stat = { u: string; st: number | string; n: number; img: number };
const feedMemo = new Map<string, { at: number; items: any[]; st: number | string }>();
async function readFeed(f: Feed, stats?: Stat[]){
  const m = feedMemo.get(f.u);
  if (m && Date.now() - m.at < 20 * 60e3){ stats?.push({ u: f.u, st: m.st, n: m.items.length, img: m.items.filter((i) => i.img).length }); return m.items; }
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 16000); // las búsquedas de algunos medios tardan
  let st: number | string = 0, items: any[] = [];
  try {
    const r = await fetch(f.u, { headers: { "User-Agent": UA, "Accept": "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5" }, signal: ctl.signal });
    st = r.status;
    if (r.ok){
      const xml = (await r.text()).slice(0, 1_500_000);
      items = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)].slice(0, 30).map(([it]) => {
        const desc = tag(it, "description"), body = tag(it, "content:encoded");
        let t = strip(tag(it, "title")); const u = decode(tag(it, "link")).trim();
        let x = strip(desc).slice(0, 260), src: string = f.src, link = u, img = "";
        if (f.bing){ // Bing Noticias: el link real va en el parámetro url, el medio en News:Source y la foto en News:Image
          try { link = new URL(u).searchParams.get("url") || u; } catch { /* queda el de Bing */ }
          src = strip(tag(it, "News:Source")) || "Bing Noticias";
          const bi = decode(tag(it, "News:Image")).trim(); if (bi) img = bi.replace(/^http:/, "https:") + "&w=640&h=360&c=14";
        } else img = pickImg(it, decode(desc + body));
        if (f.pin){ img = img.replace(/\/(236x|170x|474x)\//, "/564x/"); if (!t.trim()) t = "Pieza en Pinterest"; src = "Pinterest"; } // la imagen más grande del pin
        if (!x && body) x = strip(body).slice(0, 260);
        const pd = Date.parse(decode(tag(it, "pubDate") || tag(it, "dc:date")).trim());
        return { t, u: link, x, img, d: isNaN(pd) ? "" : new Date(pd).toISOString(), src, lang: f.lang, cc: f.cc, days: f.days, pin: f.pin || "" };
      }).filter((i) => i.t && i.d && /^https?:\/\//.test(i.u));
    }
  } catch (e: any){ st = e?.name === "AbortError" ? "timeout" : "error"; }
  finally { clearTimeout(tm); }
  feedMemo.set(f.u, { at: Date.now(), items, st });
  stats?.push({ u: f.u, st, n: items.length, img: items.filter((i) => i.img).length });
  return items;
}
// La foto de la nota (og:image) cuando el feed no la trae.
async function ogImage(u: string){
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(u, { headers: { "User-Agent": UA, "Accept": "text/html" }, signal: ctl.signal });
    if (!r.ok || !r.body) return "";
    const rd = r.body.getReader(), dec = new TextDecoder(); let html = "";
    while (html.length < 300_000){ const { done, value } = await rd.read(); if (done) break; html += dec.decode(value, { stream: true }); if (/<\/head>/i.test(html)) break; }
    rd.cancel().catch(() => {});
    const m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]*content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i);
    const img = m ? decode(m[1]).trim().replace(/^http:\/\//, "https://") : "";
    return /^https:\/\//.test(img) && !BAD_IMG.test(img) ? img : "";
  } catch { return ""; } finally { clearTimeout(tm); }
}
// Traducción al español (MyMemory, gratis). Lo ya traducido se reutiliza (known).
async function toEs(text: string, from: string){
  if (!text) return "";
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 480))}&langpair=${from === "pt" ? "pt" : "en"}|es`, { signal: ctl.signal });
    const j = await r.json();
    const out = String(j?.responseData?.translatedText || "");
    return j?.responseStatus === 200 && out && !/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(out) ? decode(out) : "";
  } catch { return ""; } finally { clearTimeout(tm); }
}
const firstSentence = (x: string) => { const s = x.replace(/…$/, "").split(/(?<=[.!?])\s/)[0] || x; return (s.length > 200 ? s.slice(0, 197).replace(/\s\S*$/, "") + "…" : s).trim(); };

// ---------- Armado de los grupos de un área ----------
// known: notas ya armadas antes (con su traducción y su foto), para no traducir ni buscar fotos dos veces.
export async function armar(area: string, known: Map<string, any>, { debug = false, translate = true, boards = PIN_BOARDS } = {}){
  const now = Date.now(), used = new Set<string>(), groups: { k: string; items: Item[] }[] = [], stats: Stat[] = [], dbg: any[] = [];
  const fechas = fechasQueVienen(), fechaRe = new RegExp(fechas.map((f) => FECHA[f]?.[3].source || f).join("|"), "i");
  for (const g of GROUPS[area] || []){
    const all = (await Promise.all(g.feeds().map((f) => readFeed(f, debug ? stats : undefined)))).flat();
    const seenU = new Set<string>(), seenT = new Set<string>(), negs: string[] = [], nope: string[] = [];
    const cands = all.filter((i) => {
      const k = i.t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 60);
      if (seenU.has(i.u) || seenT.has(k)) return false; seenU.add(i.u); seenT.add(k);
      if (now - Date.parse(i.d) > i.days * 864e5 || Date.parse(i.d) > now + 2 * 864e5) return false;
      if (negTitle(i.t) || NEG_X.test(i.t + " " + i.x)){ if (debug) negs.push(`${i.src}: ${i.t}`); return false; }
      return true;
    }).map((i) => {
      const f = feat(i.t, i.x, g.fecha ? fechaRe : undefined), ch = chainOf(i.t + " " + i.x), age = (now - Date.parse(i.d)) / 864e5;
      return { ...i, f, ok: g.need(f), chain: ch?.n || "", cc: ch?.cc || i.cc, s: g.score(f) + (i.lang === "es" ? 1 : 0) + (i.img ? 0.5 : 0) - age / 30 };
    });
    if (debug) cands.filter((i) => !i.ok).forEach((i) => nope.push(`${i.src}: ${i.t}`));
    const ok = cands.filter((i) => i.ok).sort((a, b) => b.s - a.s);
    const pick: any[] = [];
    // Pão de Açúcar siempre: su nota creativa más nueva va primero (aunque ya esté en otro grupo).
    if (g.pda){ const p = ok.filter((i) => i.f.pda).sort((a, b) => b.d.localeCompare(a.d))[0]; if (p) pick.push(p); }
    const per: Record<string, number> = {};
    pick.forEach((i) => { per[i.src] = (per[i.src] || 0) + 1; });
    for (const cap of [g.cap, g.cap + 2]) for (const i of ok){
      if (pick.length >= g.n + 4) break;
      if (pick.includes(i) || used.has(i.u) || (per[i.src] || 0) >= cap) continue;
      pick.push(i); per[i.src] = (per[i.src] || 0) + 1;
    }
    // Foto: la del feed o la de la nota (og:image). Sin foto no va.
    await Promise.all(pick.map(async (i) => { if (!i.img){ const k = known.get(i.u); i.img = k?.img || await ogImage(i.u); } }));
    const out = pick.filter((i) => i.img).slice(0, g.n);
    out.forEach((i) => used.add(i.u));
    const items: Item[] = await Promise.all(out.map(async (i) => {
      const base: Item = { t: i.t, u: i.u, x: firstSentence(i.x), img: i.img, d: i.d, src: i.src, lang: i.lang, chain: i.chain, cc: i.cc };
      if (i.lang === "es" || !translate) return base;
      const k = known.get(i.u); if (k?.tr) return { ...base, t: k.t, x: k.x, tr: true };
      const [t, x] = await Promise.all([toEs(i.t, i.lang), toEs(base.x, i.lang)]);
      return t ? { ...base, t, x: x || "", tr: true } : base;
    }));
    groups.push({ k: g.k, items });
    if (debug) dbg.push({ k: g.k, cands: cands.length, ok: ok.length, out: out.map((i) => `${i.s.toFixed(1)} ${i.d.slice(0, 10)} ${i.src}${i.chain ? " [" + i.chain + "]" : ""}: ${i.t}${i.img ? "" : " (sin foto)"}`),
      neg: negs.slice(0, 25), nope: nope.slice(0, 25) });
  }
  // Galería de piezas gráficas: los pines más nuevos de los tableros de Pinterest (todas sus imágenes, sin traducir).
  if (area === "dg" || area === "cm"){
    const pins = (await Promise.all(boards.slice(0, 8).map((b) => readFeed(PIN(b), debug ? stats : undefined)))).flat().filter((i) => i.img)
      .sort((a, b) => b.d.localeCompare(a.d));
    const per: Record<string, number> = {}, seen = new Set<string>(), out: Item[] = [];
    for (const cap of [6, 99]) for (const i of pins){ if (out.length >= 18) break; if (seen.has(i.u) || (per[i.pin] || 0) >= cap) continue; seen.add(i.u); per[i.pin] = (per[i.pin] || 0) + 1;
      out.push({ t: i.t.slice(0, 140), u: i.u, x: "", img: i.img, d: i.d, src: "Pinterest", lang: "es", chain: "", cc: "WW" }); }
    groups.push({ k: "pins", items: out });
  }
  return debug ? { groups, stats, dbg } : { groups };
}
// Para las pruebas.
export const __t = { feat, negTitle, NEG_X, chainOf, GROUPS };
