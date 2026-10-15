# Comercial · cómo funciona (para trabajar solo en esta parte)

> Para el chat de Claude Code que va a hacer cambios **solo en Comercial**. Leé primero `CLAUDE.md` y `docs/CONTEXTO.md`
> (cómo se trabaja: ramas, pruebas, publicar). Acá está todo lo de Comercial: qué hace, dónde está el código y qué no tocar.
> Actualizado el **15/10/2026** (app publicada **v189**; en la rama de Comercial **v190**: copiar cada dato por separado; el número de línea es aproximado: buscá por el texto indicado).
> Repositorio: `retailpy/mkt` (GitHub). Producción: `main` → https://retailmkt.vercel.app (Vercel). Base y funciones: Supabase,
> proyecto `retail-mkt-hub`. El otro chat trabaja en su propia rama `claude/…` y publica igual: PR a `main` y merge.

## 1. Qué es

Sección **Comercial** del menú (General → Comercial). Muestra las **ofertas de cada quincena** que manda el departamento
Comercial en Excel ("PUBLICADAS") a una carpeta de Google Drive, listas para diseñar:

- Botones de quincena (Vigente / Oferta quincenal / Terminó) con la **fecha de la oferta** (ya no "Folleto N").
- Por quincena: marca, fecha, total de productos (`+N más` si se sumaron), destacados de **Tapa**, **Redes**, **Destacados**,
  la lista completa con buscador, filtro por página/sección, pestañas por hoja del Excel, copiar un producto o la lista.
- **Copiar cada dato por separado (v190):** en las tarjetas (Tapa, Redes, Destacados) y en cada fila de la lista, el **nombre**,
  el **precio de oferta**, el **precio de antes** y el **descuento** tienen un ícono chico de copiar: tocando el dato (o el ícono)
  se copia **solo ese dato, tal como se ve** (“Gs. 6.000”, “2 x 28.000”, “-20%”; el de antes sin la palabra “Antes”) y avisa
  “Copiado: …”. El ícono grande (arriba a la derecha) sigue copiando **todo** el producto. En la lista, la fila se abre tocando
  fuera de los datos (o con Enter). También con el teclado: Tab hasta el dato y Enter. En el celular el ícono grande va arriba a la derecha de la fila.
- Arriba: **Excel** y **PDF** (descarga de lo que se ve), **Carpeta de Comercial (Drive)** y **Actualizar** (vuelve a leer Drive).
- En cada quincena: **Ver Excel original**, **Abrir carpeta en Drive**, **Respaldo en Drive** y "Revisado hace…".
- Alerta "**Se sumaron N productos más**" cuando al volver a leer un Excel aparecen productos nuevos (con "Ver solo los nuevos").

Carpeta de Comercial en Drive: `https://drive.google.com/drive/folders/1ciqZuhAtcIa-_OYYutd-8Zq8CTPZS-5N` (solo lectura).
Carpeta de respaldos: `1A_WCm2AkSN9H6GdNazCk-9L4ngoaNWfZ` (el Excel de cada quincena, en la carpeta del mes y año).

## 2. Cómo viajan los datos

```
Excel en Drive ──(Apps Script de Google, cuenta retailmarketingpy)──► Supabase Edge Function "integraciones"
   (carpeta Comercial)        comercial_list / comercial_file                acción comercial_sync: lee, compara y guarda
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

### Forma de `s:COMERCIAL`

```js
{ v:1, updated, syncedAt, backupScript:true|false,
  files: { [idDelArchivoEnDrive]: {
    id, name, brand:"Superseis"|"Stock"|"Delimarket", from:"2026-10-12", to:"2026-10-25",   // del nombre del archivo
    folleto:"19", title, modified, v:PARSE_V, inDrive:true|false, n:<productos>, at,
    sheets:[ { name, label, items:[ { sec, sector, cod, mat, desc, pvp, of, tem, pct, rec, neg, prov, nprov, sub, flag?, fx? } ] } ],
    added?: { n, at, keys:["cod|desc", …] },        // productos de más en la última lectura (alerta "Se sumaron N")
    backup?: { at, id, url }                          // respaldo en Drive
  } } }
```

`flag` (primera columna del Excel): `Tapa`, `Destacar`, `Zócalo redes`, `Publicada`, `Confirmado` u otro texto.

## 3. Dónde está el código

| Qué | Archivo y lugar |
|---|---|
| Pantalla de Comercial | `index.html`: buscar `// ---------- Comercial:` (≈ línea 9476; `pComercial()` ≈ 9595). Ahí están `comUI`, `comState`, `comPeriods`, `comRange`, `comNice`/`comSent`/`comSec` (textos legibles), `comPct`, `comCard`, `comF` (copiar un dato: `data-comcp`), `comSync`, `comExcel`, `comPdf`, `COM_GUIDE`, **`pComercial()`** y sus eventos (`data-com…`). |
| Estilos | `index.html`, bloque CSS `/* Comercial: ofertas de la quincena */` (≈ líneas 555–617): clases `.com*`, `.cof*`, `.cpct`, `.cflag`, `.cnew`. |
| Menú y permisos | `SECTIONS` → `{ k:"comercial", virtual:true }`; `PERM_EXTRA` incluye `"comercial"`; está en `ROLE_COMMON` (CM y Diseñador lo ven). El rol **Revisor** (revisión de Meta) **no** lo ve ni puede leer `s:COMERCIAL` en la base: no lo cambies. |
| Sincronización | `sync.js`: `SHARED.COMERCIAL` y `READONLY` (no se guarda desde la app). |
| Servidor (lectura y guardado) | `supabase/functions/integraciones/index.ts`: `comercialSync()`, `productosNuevos()`, acción `comercial_sync`; arriba `COMERCIAL_FOLDER_ID`, `BACKUP_FOLDER_ID`, `SCRIPT_V`. |
| Lector del Excel | `supabase/functions/integraciones/comercial.ts`: `parseOfertas()` (columnas y marcas), `periodo()` (fechas desde el nombre: "12 AL 25-10"), `marcaDe()` (S6/Superseis, Stock, Deli), `nombreOfertas()`, `excelOfertas()` (Excel de respaldo). `PARSE_V`: si cambiás cómo se lee, subilo en 1 y se vuelven a leer todos. |
| Apps Script de Drive | Texto del script dentro de `index.ts` (`scriptText`): `comercialList`, `comercialFile`, `backupCopy`, `backupFile`. Si se cambia, hay que subir `SCRIPT_V` y Admin total lo copia de nuevo en **Configuración → Integraciones** (lo pega en script.google.com). |
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
  ajustar `periodo()` y `marcaDe()`.
- La alerta "+N más" compara **código + descripción** (`cod|desc`) contra la lectura anterior, contando repetidos.
- Las quincenas quedan guardadas aunque borren el Excel de Drive (`inDrive:false` → "Ya no se encuentra el archivo original").
- No mostrar ni pedir claves (Supabase, Google, Vercel). La configuración del script está en la tabla `integration_config`.
