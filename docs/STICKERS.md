# GIFs y stickers del Chat Retail MKT

Las dos cosas se conectan desde la app, sin tocar Vercel: **Configuración → Integraciones** (solo Admin total).
Ahí están los pasos con los links. Las claves quedan guardadas en el servidor (Supabase, tabla `integration_config`
sin acceso desde la app) y las usa la función `supabase/functions/integraciones`.

- **GIFs**: una API Key gratis de GIPHY (developers.giphy.com → Create an App → API).
- **Stickers**: se guardan en la carpeta de Drive **Stickers Retail MKT**. La app genera un script (con una clave
  secreta) que se pega en script.google.com y se publica como Aplicación web (Ejecutar como: Yo · Acceso: Cualquier usuario);
  la URL `/exec` se pega en la app. Cada sticker: PNG, WEBP, GIF o JPG, hasta 2 MB al elegirlo; la app lo achica a
  320 × 320 px (máx. 400 KB). Los GIF animados tienen que pesar 400 KB o menos.
