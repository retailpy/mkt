# Stickers del Chat Retail MKT

Los stickers que sube el equipo se guardan en Google Drive, en la carpeta **Stickers Retail MKT**
(https://drive.google.com/drive/folders/1EwWLkJ3XCl927Yi0ryCvFC807Vdp0iFk), no en Supabase.
La app ya trae 10 stickers de boceto con emociones (no necesitan Drive).

## Cómo se conecta (una sola vez, con la cuenta dueña de la carpeta)

1. Entrá a https://script.google.com → **Nuevo proyecto** → pegá el contenido de `docs/stickers-apps-script.gs`.
2. **Configuración del proyecto (⚙) → Propiedades del script → Agregar**: nombre `KEY`, valor: una clave larga inventada (por ejemplo 40 letras y números al azar). No la compartas.
3. **Implementar → Nueva implementación → Aplicación web**: Ejecutar como **Yo**, Quién tiene acceso **Cualquier usuario**. Autorizá los permisos de Drive. Copiá la URL que termina en `/exec`.
4. En Vercel (proyecto de la app) → Settings → Environment Variables, agregá:
   - `STICKERS_SCRIPT_URL` = la URL `/exec`
   - `STICKERS_SCRIPT_KEY` = la misma clave del paso 2
   y redesplegá.

## Cómo funciona

- La app nunca habla directo con el script: pasa por `/api/stickers` (Vercel), que verifica que la persona haya iniciado sesión y agrega la clave.
- Cada sticker: PNG, WEBP, GIF o JPG, **máximo 400 KB**. La app achica la imagen sola a 320 × 320 px (los GIF animados se suben como están, por eso tienen que ser livianos).
- En el chat, el botón de stickers muestra: **Recientes** (este dispositivo), **Favoritos** (de cada persona, en todos sus dispositivos), **Bocetos** (los que trae la app) y **Biblioteca** (todo lo subido a la carpeta).
