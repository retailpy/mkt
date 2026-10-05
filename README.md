# Retail MKT Hub

Diseño gráfico, CM, redes y equipo de Retail MKT en una sola app (PWA instalable).

**App: https://mkt-two.vercel.app**

## Cómo está armada

| Parte | Dónde |
|---|---|
| App (HTML + JS, sin build) | `index.html`, `sync.js`, `config.js`, `sw.js`, `manifest.webmanifest`, íconos |
| Base de datos, login y reglas de acceso | Supabase, proyecto `retail-mkt-hub` (región São Paulo) |
| Publicación | Vercel, conectado a este repo: cada push a `main` se publica solo |

- `sync.js` conecta la app con Supabase: login con email y contraseña, carga los datos al entrar,
  guarda solo cada cambio a los segundos y trae en vivo lo que cambian los demás. Si dos personas
  tocan lo mismo a la vez, combina los cambios por elemento en vez de pisarlos.
- `config.js` tiene la URL del proyecto y la clave *publicable* (es pública por diseño; lo que
  protege los datos son las reglas RLS de la base).
- `vendor/supabase.js` es la librería oficial `@supabase/supabase-js` 2.117.2 (UMD), incluida en el
  repo para no depender de un CDN y para que funcione el caché sin internet.

## Datos y permisos (Supabase)

- `app_state`: una fila por colección (`s:posts`, `s:jobs`, `s:PEOPLE`...). Además:
  `notes:<persona>` y `prompts:<persona>` los ve solo su dueño, y `thread:<id>` (mensajes) solo sus
  dos participantes. Lo garantiza la base (RLS), no la pantalla.
- `members`: quién puede entrar, con qué rol, y su usuario de Supabase Auth.
- Edge Function `admin-users`: crea cuentas, restablece contraseñas, cambia roles y
  activa/desactiva. Solo la puede usar un **Admin total** (la clave de servicio nunca llega al navegador).
- Las migraciones están en `supabase/migrations/` y la función en `supabase/functions/admin-users/`.

## Usuarios

- El Admin total da acceso desde **Usuarios y permisos → Restablecer contraseña** (si la persona
  todavía no tiene cuenta, se la crea) o con **Nueva persona**. La contraseña provisoria se pasa por
  WhatsApp o en persona; al entrar, la app pide elegir una propia.
- “¿Olvidaste tu contraseña?” deja el pedido en Alertas del Admin total.
- “Vista previa · ver como” (solo Admin total) muestra la app como otra persona, sin guardar nada.

## Instalar en el celular

Ver `LEEME.txt`.

## Datos de Meta (seguidores y demográficos)

Dos funciones en Vercel consultan la Graph API de Meta todos los días y guardan el resultado en `app_state`:

| Función | Guarda en | Horario (Paraguay) |
|---|---|---|
| `api/seguidores.js` | `s:META_FOLLOWERS` (un bloque por mes) | 07:00 |
| `api/demograficos.js` | `s:META_DEMO` (ciudades, edades y sexo de Instagram) | 07:15 |
| `api/publicaciones.js` | `s:META_POSTS` (publicaciones de Instagram por marca: imagen, me gusta, alcance) | 07:30 |
| `api/anuncios.js` | `s:META_CREATIVES` (anuncios del mes con imagen y copy, por marca) | 07:45 |
| `api/mensajes.js` | `s:META_INBOX` (mensajes directos de Instagram y Facebook por marca: quién escribió y si se contestó; solo lo leen Admin total, Admin y CM) | 08:00 y con “Actualizar” en la app |
| `api/referentes.js` | `s:META_REFS` (posteos y carruseles de Instagram de los supermercados de referencia, con Pão de Açúcar primero; Business Discovery de Meta, sin reels) | 08:30 y con “Actualizar” en Tendencias |

- Las marcas y su orden están en `api/_lib/meta.js` (`NOMBRES` y `ORDEN`).
- Variables en Vercel: `META_TOKEN` (conviene un token de **usuario del sistema** del Business Manager, que no vence; necesita
  `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_manage_insights`, `read_insights`, `ads_read` y `business_management`; para la sección Mensajes también `pages_messaging`, `instagram_manage_messages` y `pages_manage_metadata`, y en cada Instagram activar “Permitir acceso a los mensajes”), `SUPABASE_URL`, `SUPABASE_KEY`, `CRON_SECRET`, `INGEST_KEY`.
- Escriben con la clave publicable a través de `ingest_meta()`, que exige `INGEST_KEY` y solo acepta esas dos claves
  (ver `supabase/migrations/20260930030000_meta_ingest.sql`).
- Probar sin guardar: `https://mkt-two.vercel.app/api/demograficos?dry=1&secret=CRON_SECRET`.
