# Comercial · cómo funciona (para trabajar solo en esta parte)

> Para el chat de Claude Code que va a hacer cambios **solo en Comercial**. Leé primero `CLAUDE.md` y `docs/CONTEXTO.md`
> (cómo se trabaja: ramas, pruebas, publicar). Acá está todo lo de Comercial: qué hace, dónde está el código y qué no tocar.
> Actualizado el **15/10/2026** (app **v199**: Comercial con Superseis, Stock y Delimarket, 9 categorías, lectura con los Excel reales y bajada directa de Drive; Stock quincenal con el Excel **FINAL** (texto del folleto y columna Novedad); el número de línea es aproximado: buscá por el texto indicado).
> Repositorio: `retailpy/mkt` (GitHub). Producción: `main` → https://retailmkt.vercel.app (Vercel). Base y funciones: Supabase,
> proyecto `retail-mkt-hub`. El otro chat trabaja en su propia rama `claude/…` y publica igual: PR a `main` y merge.

## 1. Qué es

Sección **Comercial** del menú (General → Comercial): «Ofertas de Comercial» · *Todas las ofertas de Superseis, Stock y Delimarket
en un solo lugar.* Muestra las ofertas que manda el departamento Comercial en Excel a carpetas de Google Drive, listas para diseñar.

**Página principal (v194):** debajo del encabezado están los 3 supermercados con sus **9 accesos** (sin pantallas intermedias;
`comHub()`): **Superseis** (Ofertas quincenales · Fin de semana · Superseis Express · Imbatibles), **Stock** (Ofertas quincenales ·
Fin de semana · Stock Express · Imbatibles) y **Delimarket** (Fin de semana). Cada botón dice si hay una oferta **vigente** o la
**próxima**, o por qué no hay (carpeta sin acceso, todavía no se leyó…). Al tocarlo se ve esa categoría **dentro de la app** con
todo lo de las quincenales (lo de abajo); arranca en las quincenales de Superseis. Lo que el servidor no pudo identificar queda en
**“N archivos pendientes de revisión”** (nombre, carpeta, motivo y link a Drive). Si una carpeta no se pudo abrir, lo dice con el
error de Drive (nunca la toma como vacía).

En cada categoría:

- Botones de quincena (Vigente / Oferta quincenal / Terminó) con la **fecha de la oferta** (ya no "Folleto N").
- Por quincena: marca, fecha, total de productos (`+N más` si se sumaron), destacados de **Tapa**, **Redes**, **Destacados**,
  la lista completa con buscador, filtro por página/sección, pestañas por hoja del Excel, copiar un producto o la lista.
- **Copiar cada dato por separado (v190):** en las tarjetas (Tapa, Redes, Destacados) y en cada fila de la lista, el **nombre**,
  el **precio de oferta**, el **precio de antes** y el **descuento** tienen un ícono chico de copiar: tocando el dato (o el ícono)
  se copia **solo ese dato, tal como se ve** (“Gs. 6.000”, “2 x 28.000”, “-20%”; el de antes sin la palabra “Antes”) y avisa
  “Copiado: …”. El ícono grande (arriba a la derecha) sigue copiando **todo** el producto. En la lista, la fila se abre tocando
  fuera de los datos (o con Enter). También con el teclado: Tab hasta el dato y Enter. En el celular el ícono grande va arriba a la derecha de la fila.
- **Ordenar y buscar en cada página (v191):** debajo del título de cada página del folleto (si tiene más de un producto) hay
  un **buscador** («Buscar en esta página»: busca en nombre, código, material, proveedor, subcategoría y sector; todas las palabras
  escritas, sin importar acentos ni mayúsculas) y el **orden por precio de oferta**: «Como el Excel» (el de siempre), «Mayor a menor»
  y «Menor a mayor». Cada página se ordena por su cuenta. Precio para ordenar (`comOfVal`): el número de la oferta; «Precio normal» →
  el precio normal; «2 x 28.000» → 28.000; sin precio («2x1») → al final, en el orden del Excel. El título de la página dice
  «N de M ofertas» si la búsqueda deja menos. «Copiar lista» copia en el orden que se ve. El orden y la búsqueda quedan mientras la app
  está abierta (`comUI.pg`, por quincena, hoja y página); no se guardan en la base ni cambian el Excel/PDF.
- Arriba: **Excel** y **PDF** (descarga de lo que se ve), **Carpeta de Comercial (Drive)** (la carpeta general «OFERTAS DIVISION», `1Tlj4ITfLdxtKZ8CuciI0e7UDn_em6rek` = `COM_ROOT`, con todas las carpetas adentro; v195) y **Actualizar** (vuelve a leer todas las carpetas).
- En cada quincena: **Ver Excel original**, **Abrir carpeta en Drive** (la carpeta de esa categoría), **Respaldo en Drive** y "Revisado hace…".
- Alerta "**Se sumaron N productos más**" cuando al volver a leer un Excel aparecen productos nuevos (con "Ver solo los nuevos").
- **Excel FINAL de Stock quincenal (v199):** en la carpeta de Stock quincenal, el Excel que dice **FINAL** en el nombre
  («FINAL QUINCENAL STOCK 26-10 AL 08-11») es el que se usa; si de las mismas fechas también está el «PUBLICADAS», se usa el FINAL
  (el servidor borra el PUBLICADAS guardado cuando el FINAL ya está leído; la pantalla también lo esconde). Las quincenas que no tienen
  FINAL siguen con el PUBLICADAS. En el FINAL:
  - **Nombre del producto = columna «DESCRIPCION FOLLETO», tal cual** (“Papas fritas congeladas VIMA 1 kg.”), sin pasarlo por
    `comNice` (`comName(i)`: `i.fol` = viene del folleto). Es lo que se copia, se busca y sale en Excel/PDF. La descripción del sistema
    («PAPAS FRITAS VIMA CONGELADAS 1KG») queda en el detalle (`i.dsis`).
  - **Variantes:** las filas sin texto de folleto debajo de un producto (mismo cuadro: “Salamín RANCHO 250 gr. Con/sin picante”)
    van **juntas en un solo producto** (`i.vars`: descripción, código, material y precios). La fila dice “N variantes” (en amarillo
    “· con otro precio” si alguna tiene otro precio) y el detalle las lista con códigos y precios. El buscador encuentra el producto
    también por el código o la descripción de una variante. Ej. real: 141 filas → 88 productos del folleto.
  - **Columna «Novedad»** (`i.nov`: “Nuevo” / “Se mantiene”, de la columna NOVEDAD), resumen “N nuevos · M se mantienen” y filtro
    «Novedad: todos / Solo nuevos / Solo los que se mantienen». **Es otra cosa** que el aviso “Se sumaron N productos más” y la
    etiqueta verde **Nuevo** (productos que se agregaron al Excel en la última actualización): los dos siguen, por separado.
  - Las secciones salen de la columna CATEGORIA (el FINAL no tiene filas “Pag. N”). Excel descargado: suma «Novedad»,
    «Descripción del sistema» y «Variantes» solo si el archivo las tiene (`comCols`).

### Carpetas de Drive (solo lectura; todas dentro de «OFERTAS DIVISION», dueña `ofertaspricing`)

| Supermercado | Categoría | Se reconoce por el nombre | Carpeta (id) |
|---|---|---|---|
| Superseis | Quincenal | `PUBLICADAS` (la de siempre) | `1ciqZuhAtcIa-_OYYutd-8Zq8CTPZS-5N` «OFERTA QUINCENAL S6» (con su subcarpeta VIGENTE) |
| Stock | Quincenal | `FINAL` (se prefiere) o `PUBLICADAS` («Publicadas Stock») | `1RIqkeQ7iR22JX_j3k5JqZXdMsPl0x7eP` «OFERTA QUINCENAL STOCK» |
| Superseis | Fin de semana | `FDS` o «fin de semana» («FDS SG») | `16e3im1-9kYWZ7rZixRtRPUelHyDSoxxy` «SUPERSEIS» |
| Stock | Fin de semana | `FDS` («FDS Stock») | `1iHSUvW6WbZO2WDSZ0o3VtS345p48aAdR` «STOCK» |
| Delimarket | Fin de semana | `FDS` («FDS Deli») | `1NnZGuw3iWQaWNqz5axsE4zWlUAW-sXhA` «DELIMARKET» |
| Superseis / Stock | Express | `EXPRESS` + `PUBLICADA(S)` + `S6` o `STOCK` | `14b8mp9dItU2SmoJUbiaCNc9g3vBI3xal` «DINAMICA EXPRESS» (compartida) |
| Superseis / Stock | Imbatibles | `IMBATIBLE(S)` + `S6` o `STOCK` | `1wnr3i0WNIUOuOEILUg5z_LWdmHd1A79W` «LOS IMBATIBLES» (compartida) |
| Superseis / Stock | Quincenal (FINAL) | `FINAL` + `S6` o `STOCK` (se prefiere a las de arriba) | `1-xZ--Tb9rvCYDpmh2zrsYQz-jy-AfDBf` «MKT - FOLLETOS» (compartida; v229, script 8) |

Reglas (`clasificar()` en `comercial.ts`): solo planillas (.xlsx/.xls o Google Sheets) que dicen la categoría en el nombre; las
**versiones internas** (`INTERNA`) nunca se usan; en una carpeta de una marca, si el nombre dice **otra** marca queda pendiente; en las
compartidas, si no dice S6 o Stock (o dice las dos) queda pendiente; Express **sin** “publicada” queda pendiente. También queda
pendiente si no tiene las **fechas** en el nombre o si el Excel no tiene columnas de producto y precio de oferta.

**Tal cual el Excel (v230):** descuento = columna «% DESC.» sin calcular nada (vacía → no se muestra; texto → como está);
oferta y precio normal con texto, la marca de la primera columna y la temática (salvo FLEJE, etiqueta `.ctem`) se muestran como
están escritos en el Excel (`comRaw`, `comPvpTxt`, `comFlagTxt`, `comTem`). `PARSE_V` = 4.

**«MKT - FOLLETOS» (v229):** Comercial deja ahí los Excel **FINAL** de las quincenales de Superseis y Stock («FINAL QUINCENAL S6 26-10 AL 08-11»,
«FINAL QUINCENAL STOCK 26-10 AL 08-11»). Se lee junto con la carpeta de cada marca: si de una quincena hay FINAL, se usa ese (el
PUBLICADAS y un FINAL viejo que ya no está en Drive se borran cuando el nuevo está leído; la pantalla también elige uno solo:
en Drive → de «MKT - FOLLETOS» → el más nuevo). Las quincenas sin FINAL siguen con el PUBLICADAS de la carpeta de la marca.
Necesita el **script de Drive versión 8** (con el 7 esa carpeta queda “falta actualizar el script”). En `index.html`: `COM_FOLLETOS`,
`comFids()` (carpetas de cada categoría) y `comSrcOf()`.

Carpeta de respaldos: `1A_WCm2AkSN9H6GdNazCk-9L4ngoaNWfZ` (el Excel de cada quincena **de Superseis**, en la carpeta del mes y año; como antes).

## 2. Cómo viajan los datos

```
Excel en Drive ──(Apps Script de Google, cuenta retailmarketingpy)──► Supabase Edge Function "integraciones"
 (7 carpetas de ofertas)   comercial_list {folder} / comercial_file          acción comercial_sync: lee, clasifica, compara y guarda
                                                                                       │
                                                       app_state, clave "s:COMERCIAL" (solo la escribe el servidor)
                                                                                       │
                                     sync.js la trae a todos (en vivo + revisión cada 10 s) ──► index.html: pComercial()
```

- **Quién dispara la lectura**
  - La app: al abrir Comercial (si pasaron más de 3 h) y con el botón **Actualizar** (`comSync(true)` → `integ({ action:"comercial_sync", force:true })`).
  - Rutina de Vercel (`vercel.json` → `/api/comercial`, que llama a la función sin sesión): 03:15, 10:00 y 16:00 UTC
    (00:15, 07:00 y 13:00 de Paraguay). La de la noche deja el **respaldo** el mismo día que empieza la oferta.
- **Sin sesión** la función solo actualiza (no devuelve ofertas) y como mucho cada 20 min. Con sesión: cada 30 min, o 15 s con `force`.
- La clave `s:COMERCIAL` está en `READONLY` de `sync.js`: la app **nunca** la guarda; solo la escribe la función.
- **Script de Drive versión 7** (`SCRIPT_V`): `comercial_list` recibe la carpeta (solo las de `FUENTES`) y lista también las
  subcarpetas (2 niveles); `comercial_file` acepta archivos de cualquiera de esas carpetas y baja las planillas de Google como Excel.
  Con el script de antes (≤ 6) solo se lee la carpeta de las quincenales de Superseis (como siempre) y las demás categorías dicen
  “Todavía no se leyó: falta actualizar el script”.
- **Rápido (v197):** las 7 carpetas se listan a la vez y los Excel se bajan **directo de Drive** (`bajarOfertas`: las carpetas se
  comparten con el link) de a 6 por vez; si Drive no lo entrega, se pide al script (`comercial_file`) como antes. Por vez se leen
  hasta **40** archivos (`COM_LEER`; el resto en la próxima revisión, el aviso dice “Quedan N”). No se leen las subcarpetas de
  ofertas viejas (`ARCHIVADAS`: «ANTERIORES», «HISTÓRICO»…). En la pantalla, los buscadores dibujan la lista una sola vez cuando se
  deja de tipear (`comLater`), no con cada letra.
  No se leen ofertas que terminaron hace más de **120 días** las quincenas y **60 días** las demás (`COM_DIAS`). Las quincenas quedan
  siempre; de fin de semana, Express e Imbatibles se guardan los últimos 2 meses. Si hay más de 40 para leer, primero lo vigente y lo
  próximo, después lo que ya terminó. Si una carpeta no responde, se reintenta sola una vez. Un Excel que no se pudo leer no se vuelve a bajar hasta que lo cambien en Drive.

### Forma de `s:COMERCIAL`

```js
{ v:1, updated, syncedAt, backupScript:true|false, scriptV:7,
  src: { [idDeCarpeta]: { at, ok:true, name, n } | { at, err:"motivo" } | { at, old:true } },   // cómo se leyó cada carpeta
  pending: [ { id, name, path, src, cat, brand, reason, modified, read?, v? } ],                // pendientes de revisión
  files: { [idDelArchivoEnDrive]: {
    id, name, brand:"Superseis"|"Stock"|"Delimarket", cat:"quincenal"|"fds"|"express"|"imbatibles", src:<idDeCarpeta>, path,
    from:"2026-10-12", to:"2026-10-25",   // del nombre del archivo (las de antes sin cat = quincenales de Superseis)
    folleto:"19", title, modified, v:PARSE_V, inDrive:true|false, n:<productos>, at,
    final?: true,                                   // Excel “FINAL” (se usa en vez del PUBLICADAS de las mismas fechas)
    sheets:[ { name, label, items:[ { sec, sector, cod, mat, desc, pvp, of, tem, pct, rec, neg, prov, nprov, sub, flag?, fx?,
      fol?:1, dsis?, nov?:"Nuevo"|"Se mantiene", vars?:[ { d, cod, mat, pvp, of, pct } ] } ] } ],   // FINAL: desc = texto del folleto
    added?: { n, at, keys:["cod|desc", …] },        // productos de más en la última lectura (alerta "Se sumaron N")
    backup?: { at, id, url }                          // respaldo en Drive
  } } }
```

`flag` (primera columna del Excel): `Tapa`, `Destacar`, `Zócalo redes`, `Publicada`, `Confirmado` u otro texto.

## 3. Dónde está el código

| Qué | Archivo y lugar |
|---|---|
| Pantalla de Comercial | `index.html`: buscar `// ---------- Comercial:` (≈ línea 9600; `pComercial()` ≈ 9792). Ahí están `COM_FOLDER`/`COM_BRANDS`/`COM_CAT` (las 9 categorías y sus carpetas), `comHub()`, `comCatStatus()`, `comPending()`, `comEmptyMsg()`, `comUI` (`comUI.cat` = "Marca\|categoría"), `comState`, `comPeriods`, `comRange`, `comNice`/`comSent`/`comSec` (textos legibles), `comPct`, `comCard`, `comF` (copiar un dato: `data-comcp`), `comOfVal`/`comPageItems`/`comPageTools` (orden y buscador de cada página: `data-compk`, `data-compord`, `data-compq`), `comSync`, `comExcel`, `comPdf`, `COM_GUIDE`, **`pComercial()`** y sus eventos (`data-com…`). |
| Estilos | `index.html`, bloque CSS `/* Comercial: ofertas de Superseis, Stock y Delimarket */` (≈ líneas 555–650): clases `.comhub`, `.comb`, `.comcat`, `.compend`, `.com*`, `.cof*`, `.cpct`, `.cflag`, `.cnew`. |
| Menú y permisos | `SECTIONS` → `{ k:"comercial", virtual:true }`; `PERM_EXTRA` incluye `"comercial"`; está en `ROLE_COMMON` (CM y Diseñador lo ven). El rol **Revisor** (revisión de Meta) **no** lo ve ni puede leer `s:COMERCIAL` en la base: no lo cambies. |
| Sincronización | `sync.js`: `SHARED.COMERCIAL` y `READONLY` (no se guarda desde la app). |
| Servidor (lectura y guardado) | `supabase/functions/integraciones/index.ts`: `comercialSync()` (recorre `FUENTES`), `productosNuevos()`, `COM_LEER`, `COM_DIAS`, acción `comercial_sync`; arriba `COMERCIAL_FOLDER_ID`, `BACKUP_FOLDER_ID`, `SCRIPT_V`. |
| Lector del Excel y carpetas | `supabase/functions/integraciones/comercial.ts`: **`FUENTES`** (las 7 carpetas con su categoría y marca), **`clasificar()`** (qué es cada archivo por su nombre), `parseOfertas()` (columnas y marcas; `HEAD2` = otros nombres de columna para los Excel nuevos, solo si falta el de siempre), `periodo()` (fechas desde el nombre: "12 AL 25-10", "17 AL 19 DE OCTUBRE", o solo el mes), `nombreOfertas()`, `excelOfertas()` (Excel de respaldo). `PARSE_V`: si cambiás cómo se lee, subilo en 1 y se vuelven a leer todos. Si cambiás las carpetas, cambiá también `COM_FOLDER` en `index.html`. |
| Apps Script de Drive | Texto del script dentro de `index.ts` (`scriptText`): `COMERCIAL_FOLDERS`, `comercialList`, `enOfertas`, `comercialFile`, `backupCopy`, `backupFile`. Si se cambia, hay que subir `SCRIPT_V` y Admin total lo copia de nuevo en **Configuración → Integraciones** (lo pega en script.google.com). |
| Rutina diaria | `api/comercial.js` + `vercel.json` (`crons`). |

## 4. Cómo probar y publicar (igual que el resto de la app)

1. Cambiá solo los archivos de Comercial. **No toques** otras secciones (las trabaja otro chat).
2. Subí la versión del caché en `sw.js` (`mkthub-vNNN` → +1) para que la app avise "Hay una versión nueva".
3. Pruebas: la carpeta `pruebas/` (Playwright con un Supabase falso) **no está en el repositorio**: viene en el zip del código
   (`retail-mkt-hub-codigo.zip`) y tiene su `LEEME.md`. La de Comercial es **`test-lote35.js`** (quincenas, destacados, Excel/PDF,
   “+N más”, Carpeta en Drive). Resumen: copiar `pruebas/` junto a la app, `npm i playwright lucide@0.468.0 xlsx`, servir la app con
   `python3 -m http.server 8765` desde la raíz del repo y `node test-lote35.js` (Chromium: `/opt/pw-browsers/chromium`).
   Las pruebas abren la app en `ROOT = '/home/user/mkt'`.
4. Commit y push a la rama del chat; PR a `main` y merge (Vercel publica `main` en https://retailmkt.vercel.app).
5. **Si cambiaste `supabase/functions/integraciones/*`**, además hay que desplegar la función en Supabase (proyecto
   `retail-mkt-hub`, función `integraciones`, `verify_jwt` apagado). Forma recomendada (el repo es público): primero commit y
   push, y después desplegar un `index.ts` de una línea que importa el código de ese commit, así queda idéntico al repo:
   `import "https://raw.githubusercontent.com/retailpy/mkt/<SHA-del-commit>/supabase/functions/integraciones/index.ts";`
   (los otros 3 archivos los trae solo). Para comprobar que anda: desde la base, `select net.http_post(url := '…/functions/v1/integraciones',
   body := '{"action":"status"}'::jsonb)` y en `net._http_response` tiene que responder 401 “Iniciá sesión en la app”.
   Sin este paso, el servidor sigue con la versión vieja.
6. Antes de empezar, traé lo último de `main` (`git fetch origin main` y mezclalo): el otro chat también publica.
   Si al mezclar choca `sw.js` (`mkthub-vNNN`), quedate con el número más alto y sumale 1. Anotá tu cambio en `docs/CONTEXTO.md`
   (sección de versiones) para que el otro chat lo sepa.

## 5. Cuidado con

- Los nombres de archivo de Comercial traen las fechas ("OF. QUINCENAL PUBLICADAS S6 12 AL 25-10.xlsx"). Si cambia el formato,
  ajustar `periodo()` y `clasificar()`. Lo que no se reconoce aparece en “pendientes de revisión” con el motivo: mirá ahí primero.
- Los Excel de fin de semana, Express e Imbatibles se leen con el mismo lector que las quincenales (busca columnas de producto y de
  precio de oferta, con otros nombres posibles en `HEAD2`: «PVP OFERTA(S)», «Código Articulo», «Material SAP»…). Si traen otro
  formato, quedan pendientes con “No se encontraron las columnas…”.
- Nombres reales (15/10/2026): «FDS S6 02_10_2026 AL 04_10_2026», «FDS STOCK 16_10_26 al 18_10_26», «FDS DELI 09_10_26 AL 11_10_2026»
  (fechas con guion bajo y año: `periodo()` las entiende), «DINAMICA S6/STOCK EXPRESS PUBLICADAS 12 Al 25-10», «_S6 - LOS IMBATIBLES
  20-07 AL 22-11», «OF. QUINCENAL PUBLICADAS STOCK 12 AL 25-10». Varias carpetas tienen subcarpeta «VIGENTE» (se lee) y «ANTERIORES» (no).
- Dentro de los Excel: lo que está debajo de **«INTERNAS»/«INTERNA»** no se muestra (no se publica); el bloque **«Adicional … solo
  para destacar en redes»** sale como páginas «Adicional · …»; las filas «VIGENCIA DESDE / HASTA» repetidas se saltean; en Delimarket
  la primera columna es el sector y «DESTACAR» ahí se toma como destacado. Con «DESCRIPCION FOLLETO» (Excel FINAL) el nombre es
  ese texto y las filas sin él son variantes del producto de arriba (misma sección y categoría); «NOVEDAD» → `nov`. `PARSE_V` = 3.
- La alerta "+N más" compara **código + descripción** (`cod|desc`) contra la lectura anterior, contando repetidos (en el FINAL,
  `desc` es el texto del folleto). Pasar del PUBLICADAS al FINAL no la dispara (es otro archivo); una actualización del FINAL sí.
- Las quincenas quedan guardadas aunque borren el Excel de Drive (`inDrive:false` → "Ya no se encuentra el archivo original").
- No mostrar ni pedir claves (Supabase, Google, Vercel). La configuración del script está en la tabla `integration_config`.
