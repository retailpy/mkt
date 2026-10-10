# Retail MKT Hub · Contexto completo para seguir en otro chat

> Pegá o adjuntá este archivo al empezar una conversación nueva. Resume qué es la app, cómo está armada,
> cómo se trabaja y en qué punto quedó todo, con el detalle de Instagram (mensajes, menciones y la
> revisión de Meta). Última actualización: **9 de octubre de 2026** (versión publicada **v149**; en la rama de trabajo hasta **v159**, ver sección 5).
> **Acá no hay contraseñas, tokens ni claves**: esas están solo en Vercel/Supabase/Meta.

---

## 1. Qué es

**Retail MKT Hub** es la app interna del equipo de marketing de **Retail S.A. (Paraguay)**. Reúne en un
solo lugar el trabajo de **Diseño gráfico**, **Community Manager (CM)**, redes sociales, informes y el
equipo. Es una **PWA** (se instala en celular, tablet y compu).

- **Dirección:** https://retailmkt.vercel.app (antes era mkt-two.vercel.app)
- **Repositorio:** GitHub `retailpy/mkt` · rama de trabajo `claude/retail-mkt-hub-integration-pg2wpy` · se publica `main`
- **Marcas** (en este orden): Superseis, Stock, Delimarket, Bianca, Clasipar, Dayo, PediWOW
  (`api/_lib/meta.js` → `NOMBRES` y `ORDEN`).
- **Roles:** Admin total (todo) · Admin (control: ve todo, no modifica) · CM · Diseñador.

### Secciones del menú
- **General:** Dashboard, Inicio, Planificación del mes, Alertas, Avisos, Chat Retail MKT, Comercial, Bloc de notas.
- **Diseño gráfico:** Panel de Trabajo, Planificación, Carga de trabajo, Tendencias, Diseño para Redes / Cartelería / Web / Pantallas, Historial.
- **Community Manager:** Panel de Trabajo, Planificación, Carga de trabajo, Tendencias, Noticias, Plan de posteo,
  Gestión Redes, Gestión Historia, Gestión Canal WhatsApp, Gestión Videos, Historial CM, Ideas Random,
  **Mensajes de las cuentas** (pestañas Mensajes y Menciones), Reclamos del mes.
- **Recursos:** Prompts de imágenes (con eventos festivos), Archivos y enlaces.
- **Informes:** Meta Ads, Informe Redes, Informe mensual. **Vista TV:** TV Team, TV Redes, TV Impacto.
- **Admin:** Usuarios y permisos. **Equipo:** Staff, Turnos Sábados, Cumpleaños. **Ayuda:** Guía de uso.

### Procesos (etapas) que la app respeta
- **Diseño gráfico:** Pendiente → En proceso → Boceto finalizado → En revisión → (En corrección) → Aprobado.
- **CM publicaciones** (feed, historias, Plan de posteo): Pendiente → En proceso → Programado → Publicado → Pautado.
- **Canal de WhatsApp:** las mismas, sin Pautado.
- **Gestión Videos:** Pendiente → Grabación → Edición → Revisión → Corrección → Programado → Publicado → Pautado.
- Los repetitivos siguen el proceso de su tipo.

---

## 2. Cómo está armada (técnico)

| Parte | Dónde |
|---|---|
| App (HTML + JS, sin build) | `index.html` (todo: pantallas, estilos, lógica), `sync.js`, `config.js`, `sw.js`, `manifest.webmanifest`, íconos |
| Funciones del servidor (Vercel) | `api/*.js` y `api/_lib/meta.js` |
| Base de datos, login, reglas (Supabase) | proyecto `retail-mkt-hub` (id `idcdfmeeggmtkudkkzmu`, región São Paulo `sa-east-1`) |
| Migraciones SQL | `supabase/migrations/` |
| Edge Functions de Supabase | `supabase/functions/admin-users` (usuarios), `chat-push`, `integraciones` (GIFs, stickers, Drive, comercial, noticias, tendencias) |
| Tareas programadas | `vercel.json` → `crons` (horarios en UTC; Paraguay = UTC−3) |
| Página de privacidad (para Meta) | `privacidad.html` (+ `#eliminar`) |

- **`sync.js`**: login, carga de datos, guardado por clave, tiempo real y "catch-up" cada 10 s.
  Claves compartidas en `SHARED`; las de solo lectura en `READONLY`; las solo para CM/Admin en `CM_ONLY`.
- **`sw.js`**: service worker, red primero para la app; la versión del caché (`mkthub-vNNN`) se sube en cada cambio.
  La app muestra **"Hay una versión nueva de la app · Actualizar"** cuando se publica algo.
- **Base:** tabla `app_state (key, data, version, updated_at, updated_by)`, una fila por colección (`s:…`).
  Permisos con RLS: `private.can_access_state`. Escribe la app con la RPC `save_state`.
  Las funciones de Meta escriben con RPC protegidas por `INGEST_KEY`: `ingest_meta`, `read_meta`,
  `ingest_dm`, `log_dm`, `ingest_ig_act`.

### Variables de entorno en Vercel (solo los nombres)
`META_TOKEN` (token de Meta, de la app **Retail S.A.**) · `META_APP_SECRET` (clave secreta de la app Retail S.A.,
para la firma del webhook) · `META_IG_APP_SECRET` (opcional, otra clave aceptada) · `META_VERIFY_TOKEN` (opcional;
si no está, el token de verificación del webhook es `retail-mkt-hub`, que no es secreto) · `SUPABASE_URL` ·
`SUPABASE_KEY` · `INGEST_KEY` · `CRON_SECRET`. En Supabase (Edge Functions): `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`. **Nunca pegar estos valores en un chat.**

### Funciones `api/` (Meta)
| Función | Qué hace | Guarda en |
|---|---|---|
| `seguidores.js`, `demograficos.js` | seguidores y público | `s:META_FOLLOWERS`, `s:META_DEMO` |
| `publicaciones.js` | publicaciones de Instagram (1 archivo por mes) | `s:META_POSTS` |
| `anuncios.js` | anuncios de Meta Ads | `s:META_CREATIVES` |
| `mensajes.js` | lista de conversaciones IG/FB (a Instagram Meta la corta por tiempo) | `s:META_INBOX` |
| `referentes.js` | supermercados de referencia | `s:META_REFS` |
| `comercial.js` | ofertas de los Excel de Drive | `s:COMERCIAL` |
| **`webhook-meta.js`** | recibe en vivo mensajes, comentarios con @marca y menciones | `s:META_DM`, `s:META_IG_ACT`, registro `s:META_DM_LOG` |
| **`interacciones.js`** | lee los comentarios que arroban a la marca (posts de los últimos 30 días) | `s:META_IG_ACT` |
| **`responder.js`** | contesta un mensaje de Instagram desde la app | `s:META_DM` |

Crons (UTC): seguidores 9:00/15:00/2:40 · demográficos 9:10/15:10/2:50 · publicaciones 9:20/15:20 ·
anuncios 9:30/15:30 · mensajes 9:40/15:40 · referentes 9:50/15:50 · **interacciones 9:55/15:55** · comercial 3:15/10:00/16:00.

---

## 3. Cómo se trabaja (flujo de cada cambio)

1. Hacer el cambio.
2. Correr **todas las pruebas** automáticas (Playwright; ver sección 6).
3. Subir la versión del caché en `sw.js` (`mkthub-vNNN`).
4. Commit en la rama `claude/retail-mkt-hub-integration-pg2wpy` y push.
5. Crear el PR a `main` (repo `retailpy/mkt`), hacer merge (método *merge*, con el sha completo).
6. Adelantar la rama a `main` y push.
7. Verificar que Vercel publicó (estado del commit en GitHub = "Deployment has completed").
8. Avisar al usuario **en español** (Paraguay/rioplatense: "vos", "tocá"), con **pasos numerados** si tiene que hacer algo en Meta, Vercel, Supabase o Google.

**Reglas que pidió el usuario (y están en `CLAUDE.md`):**
- Responder siempre en español, simple y con pasos numerados.
- No mostrar ni pedir tokens, claves, contraseñas ni credenciales; recordar no pegarlos en el chat.
- No hacer cambios destructivos innecesarios en la base ni borrar cosas compartidas sin revisar dependencias.
- Las claves `META_*` son de solo lectura para la app. Las contraseñas provisorias solo se ven dentro de la app (Admin total).
- No poner nombres de modelos de IA en commits ni PRs.

---

## 4. Instagram: mensajes, menciones y la revisión de Meta (DETALLE)

### 4.1 Qué app de Meta se usa
- **Se usa la app "Retail S.A."** (ID **831534974253193**, tipo Empresa). El `META_TOKEN` de Vercel es de esa app.
- **Modo: En producción** (Live) desde el **8/10/2026**. **Negocio verificado** (Verificación del negocio: Retail S.A., Verificado).
- Existe otra app, **"Retail Demo"**, que se usó al principio para probar el "inicio de sesión de Instagram".
  **Ya no se usa: no tocarla.** (Hubo idas y vueltas; la decisión final es **todo en Retail S.A.**)

### 4.2 Webhook (avisos en vivo de Meta)
- En **Retail S.A. → Webhooks → Instagram**:
  - URL de devolución de llamada: `https://retailmkt.vercel.app/api/webhook-meta`
  - Identificador de verificación: `retail-mkt-hub`
  - Campos suscriptos: **messages**, **comments**, **live_comments**, **mentions** (también llegan avisos de `story_insights`, que se ignoran).
- La firma de cada aviso se valida con **`META_APP_SECRET` = clave secreta de la app Retail S.A.** (se corrigió el 8/10; antes tenía la de otra app y la firma "no coincidía").
- **"Conectar las páginas"** (Configuración → Integraciones → Instagram en vivo) suscribe las 7 páginas a la app (`subscribed_apps`, campo messages). Está hecho y en "ok" para las 7.
- Cada aviso queda anotado (sin el texto) en **`s:META_DM_LOG`** (últimos 40), visible en
  **Configuración → Integraciones → "Últimos avisos de Meta"** (dice en palabras si la firma está bien, de qué marca vino, cuántos mensajes/menciones se guardaron, o si fue la prueba del panel de Meta).

### 4.3 Mensajes directos (DM)
- **Entrada:** Meta → `webhook-meta.js` → RPC `ingest_dm` → `s:META_DM` (por marca y persona; últimos 30 mensajes por conversación, 62 días).
  También `mensajes.js` lee la lista de conversaciones (`s:META_INBOX`), pero en Instagram Meta corta por tiempo; por eso el webhook.
- **Pantalla:** Panel de CM → **Mensajes** (pestaña Mensajes): sin contestar / contestados / todos, por marca y red; se puede marcar "Contestado" a mano.
- **Contestar desde la app (v149):** al abrir una conversación de Instagram hay un cuadro y **Enviar**
  (`api/responder.js` → `POST /{página}/messages` con el token de la página, `messaging_type: RESPONSE`).
  Solo **Admin total y CM**. Meta deja contestar **hasta 24 h** después del último mensaje de la persona; si no deja, la app lo explica.
- La **mención en una historia** llega como mensaje y se ve como "Te mencionó en su historia".
- **Probado el 8/10/2026:** un "hola prueba" desde un Instagram con rol de evaluador llegó en vivo a la app, y la respuesta enviada desde la app llegó a Instagram. ✅

### 4.4 Menciones (comentarios que arroban a la marca)
- Pedido del usuario: **solo los comentarios que escriben @cuenta de la marca** (no todos los comentarios).
- **Pantalla:** Panel de CM → Mensajes → pestaña **Menciones**: estado (sin contestar / contestados), marca, publicación, "Contestar en Instagram", "Contestado" a mano. Los comentarios que son solo etiquetas a amigos (sorteos) no esperan respuesta.
- **Datos:** `s:META_IG_ACT` (RPC `ingest_ig_act`, suma por id sin borrar; 35 días, hasta 250 por marca). Llegan por:
  - `interacciones.js` (dos veces por día y con "Actualizar"): comentarios de las publicaciones de la marca de los últimos 30 días que tienen **@cuenta** (`arroba()` en `api/_lib/meta.js`).
  - webhook: `comments` / `live_comments` con @cuenta, y `mentions` con `comment_id` (comentarios en publicaciones de otras cuentas).
- **Con acceso estándar** Meta no manda el usuario de quien comenta → se muestra "Usuario de Instagram". La respuesta de la marca se reconoce por el campo `user`/`from.id`.
- Primera lectura (8/10): Superseis 3, Stock 2, Bianca 1 comentarios con @.

### 4.5 Permisos y revisión de Meta (App Review) — EN CURSO
- Situación: los permisos estaban en **acceso estándar** → Meta solo avisa mensajes de cuentas **con rol** en la app.
  Para recibir los de **cualquier cliente** hace falta **Acceso avanzado**.
- **Roles en Retail S.A.** (Roles de la aplicación → Roles): administradores (Retail MKT Hub, Retail Hub, Conversions API System User);
  **Evaluadores de Instagram:** `supermercados_superseis` (aceptado) y el Instagram personal del usuario (aceptado) → sus mensajes ya llegan.
- **Pedido enviado a revisión el 8–9/10/2026** (Alerta de Meta: "Tu aplicación se ha enviado a revisión y está pendiente de ser revisada"):
  - Permisos: **`instagram_manage_messages`** y **`pages_manage_metadata`**. (`pages_read_engagement` se sacó: es solo para proveedores de tecnología.)
  - Preguntas de acceso: ¿integración para varios clientes? **No** · ¿para un cliente individual (TP 1:1)? **No** (es para la propia empresa).
  - Uso permitido: textos en inglés (abajo) + videos: (1) "Conectar las páginas" y "Revisar" para pages_manage_metadata; (2) mensaje enviado desde Instagram → llega a la app → se contesta desde la app → llega a Instagram, para instagram_manage_messages.
  - Tratamiento de datos: encargados **Vercel Inc.** (servicios de TI en la nube, **Estados Unidos**) y **Supabase Inc.** (servicios de TI en la nube, **Brasil**); responsable **Retail S.A.**, **Paraguay**; requests-3: **No**; requests-4: **Ninguna de las opciones anteriores**.
  - Instrucciones para revisores: plataforma **Sitio web** `https://retailmkt.vercel.app/`, Facebook Login: **No**, texto de cómo probar (abajo) y un **usuario de prueba "RevisorMeta" (rol CM)** creado en la app (la contraseña se escribió solo en Meta). **Cuando Meta apruebe, borrar ese usuario** en Usuarios y permisos.
- **Pendiente:** pedir acceso avanzado de **`instagram_manage_comments`** (el botón se habilita hasta 24 h después de la primera llamada que lo usa; la app ya la hizo el 8/10). Para eso: texto (abajo) y un video de la pestaña Menciones.
- **Cuando aprueben:** llegan en vivo los mensajes y menciones de cualquier persona, con su @. No hay que cambiar código.

#### Textos usados en Meta (inglés)
**pages_manage_metadata**
```
We use pages_manage_metadata only to subscribe our own Facebook Pages (the pages of our brands Superseis, Stock, Delimarket and others, all owned by Retail S.A.) to our app's webhooks, so that the Instagram messages and comments sent to our own brand accounts reach our internal team tool. We do not modify any page settings or content.
```
**instagram_manage_messages**
```
Retail MKT Hub is an internal tool used only by the marketing team of Retail S.A. to manage our own brands (Superseis, Stock, Delimarket and others). We use instagram_manage_messages to receive, via webhooks, the Instagram Direct messages that customers send to our own brand accounts, and to show them in our team inbox with their status (answered or waiting), so our community managers do not miss any customer question or complaint. Replies are sent from Instagram/Meta Business Suite. Only our own Instagram professional accounts, linked to our own Facebook Pages, are connected. Data is kept for 60 days and is never shared with third parties.
```
**instagram_manage_comments** (pendiente de pedir)
```
We use instagram_manage_comments to receive, via webhooks (comments, live_comments and mentions), and to read the comments that mention our brand accounts (@brand) on the posts and live videos of our own brand accounts and on other accounts' posts. Our community managers see them in our internal team tool with their status (answered or waiting) and reply from Instagram. Only our own accounts are connected. Data is kept for 35 days and is never shared with third parties.
```

### 4.6 Cómo revisar el estado desde Supabase (SQL de solo lectura)
```sql
-- Últimos avisos de Meta (sin texto de mensajes)
select ev->>'at', ev->>'kind', ev->>'sig', ev->'brands', ev->>'n', ev->>'acts'
from app_state, jsonb_array_elements(data->'events') ev where key = 's:META_DM_LOG' limit 10;
-- Conversaciones en vivo por marca
select k, (select count(*) from jsonb_each(v)) from app_state, jsonb_each(data) e(k, v)
where key = 's:META_DM' and jsonb_typeof(v) = 'object';
-- Menciones por marca y errores de lectura
select k, v->>'err', v->'diag', jsonb_array_length(v->'items') from app_state, jsonb_each(data) e(k, v)
where key = 's:META_IG_ACT' and jsonb_typeof(v) = 'object';
```

---

## 5. Otras cosas recientes (v137–v159)
- **v150:** los reels salen también en las últimas 9 publicaciones del Dashboard e Informes (con etiqueta “Reel”); el archivo mensual de `api/publicaciones.js` los guarda.
- **v151:** se puede contestar desde la app también los mensajes de **Facebook** (`api/responder.js` acepta `net: "FB"`, permiso `pages_messaging`); al enviar, la conversación queda como contestada.
- **v152:** Mensajes se ordena por red: **Facebook** (Inbox · Comentarios) e **Instagram** (DM · Comentarios), cada uno con Sin contestar / Contestados / Todos. Comentarios de Instagram = solo los que arroban a la marca (lo que antes era “Menciones”). Comentarios de Facebook: todavía no llegan (falta permiso de Meta); la pantalla lo avisa.
- **v153:** Comercial: al tocar “Actualizar”, al lado del total de productos sale “+N nuevos” (lo agregado en esa actualización, por quincena; queda hasta la próxima novedad y se guarda en el dispositivo).
- **v154:** en el Panel de CM, el ícono de Mensajes cuenta los sin contestar por separado (“2 Facebook · 3 Instagram sin contestar”).
- **v155:** Mensajes rediseñado: Facebook e Instagram **lado a lado**, cada uno con su tarjeta (sin contestar y % contestado) y su columna (Inbox/DM y Comentarios). Estado y marca se eligen con botones (sin desplegables). En pantallas chicas se ve una red a la vez: se elige tocando su tarjeta.
- **v156 · permisos:** quien no es Admin ni Admin total (CM y Diseñador) ve **solo** Dashboard, Prompts de imágenes, Staff y Cumpleaños (más su Perfil y Configuración). Admin total le habilita el resto en **Usuarios y permisos**: ahora es una hoja simple, una tarjeta por persona con botones por sección (✓ = lo ve), “Dejar solo lo básico” y “Activar todo”. Admin y Admin total ven todo como antes. Es solo de pantalla: la base (RLS) no cambió. Los permisos viejos se reinician una sola vez (`permsV` 7 en `upgradePerms`).
- **v157 · cumpleaños:** si hoy cumple años alguien, el Dashboard y el Inicio muestran una celebración (cornetita que revienta y papelitos de colores). Al que cumple le dice “¡Feliz cumpleaños!”. Se apaga con “reducir animaciones”.
- **v158:** “Vista previa · ver como” es **solo para Fede** (Admin total); Alyssa y el resto no lo tienen. En la vista previa la persona siempre figura “Disponible”. El cartel de cumpleaños va arriba de todo, dentro del margen y probado a 390–1920 px (varios cumpleaños y nombres largos).
- **v159 · Pauta Meta Ads:** la sección Meta Ads pasa a llamarse **Pauta Meta Ads**. Arriba (en las dos pestañas) hay miniaturas de los anuncios que **corren ahora**; al tocar una se ve en grande con su texto y números. `api/anuncios.js` ahora trae **todos los anuncios activos** (aunque todavía no tengan impresiones en el mes), en grupos chicos y todas las marcas a la vez; si una marca falla, el motivo queda en `s:META_CREATIVES.errors` y la pantalla lo avisa. Antes Superseis y Delimarket no guardaban nada (falla sin registro) y las demás marcas quedaban vacías: hay que tocar **Actualizar** en “Corriendo ahora” después de publicar. El botón Actualizar de la app ahora también puede llamar a `/api/anuncios` (Admin total, Admin y CM).
- **v159 · Comercial:** cuando el servidor lee un Excel que ya estaba y trae productos de más, lo anota (`files[id].added = { n, at, keys }`, función `integraciones` → `comercial_sync`) y la app muestra “**+N más**” al lado del total, el cartel “Se sumaron N productos más en la última actualización”, la etiqueta **Nuevo** en cada producto y el filtro “Ver solo los nuevos”. Lo ve todo el equipo (no depende del dispositivo). **Hay que desplegar la Edge Function `integraciones`** en Supabase para que empiece a anotarlo.
- Prompts de imágenes: paso 2 "¿Es para un evento festivo?" (14 fechas + Otro) con la onda de cada marca.
- Procesos de CM en todos lados (incluidos repetitivos y calendarios).
- Planificación del mes: "Lo que se viene" editable, dura hasta su fecha, íconos, campañas de varias marcas ("Las tres").
- Avisos +N en Panel de Trabajo (Diseño: hasta cerrar el pedido; CM: hasta abrirlo) y en los íconos de cada sección.
- Inicio: "Tu carga de trabajo" debajo de "Mis trabajos". Menú al entrar: General + el área de la persona abiertos.
- Archivos y enlaces más limpio (un color). Aviso de versión nueva.

---

## 6. Pruebas automáticas
- Están fuera del repo, en la carpeta `pruebas/` del .zip del código (Playwright + Node).
- `runall.sh` corre todo lo de `suite.txt` + `mobscan.js` (revisión en celular). Las pruebas usan una Supabase falsa (`fake-supabase.js`), fijan la fecha (`shift-date.js`) y abren la app en `http://localhost:8765` (copia de la app) / `8767` (carpeta de trabajo); se levantan con `python3 -m http.server`.
- Pruebas de Instagram: `test-lote37` (mensajes en vivo), `test-lote45` (Menciones + contestar), `test-igact-api` (webhook e interacciones), `test-responder-api` (enviar respuestas), `whtest.js` (webhook básico).

---

## 7. Próximos pasos
1. Esperar la respuesta de Meta (Alertas de la app Retail S.A. y correo). Si piden cambios, responder con lo que pidan.
2. Pedir acceso avanzado de `instagram_manage_comments` (sección 4.5).
3. Cuando aprueben: borrar el usuario "RevisorMeta"; mandar un mensaje de prueba desde una cuenta **sin** rol para confirmar que llega.
4. Repetir lo de Superseis con las otras marcas no hace falta: las 7 páginas ya están conectadas; solo verificar que lleguen.
