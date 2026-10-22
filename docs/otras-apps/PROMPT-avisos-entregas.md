# Avisos de entregas con ventana emergente y sonido: prompt para otra app

Hay dos formas de usarlo:

1. **Con una IA que programa** (Claude, ChatGPT, Cursor, Lovable, Bolt…): copiá el prompt de abajo y adjuntá el archivo `avisos-entregas.js`.
2. **A mano**: el archivo `avisos-entregas.js` ya funciona solo. Se agrega a la página y se llama a `AvisosEntregas.iniciar({...})`. Al final de este documento hay un ejemplo.

---

## Prompt para copiar y pegar

```
Quiero agregar a mi app un sistema de AVISOS DE ENTREGAS con ventana emergente y sonido,
para las TAREAS y PUBLICACIONES que vencen hoy o que ya están atrasadas.
Te adjunto "avisos-entregas.js", una versión que ya funciona en otra app (JavaScript puro, sin librerías).
Usalo como base y adaptalo a mi código (mi framework, mis datos, mis roles y mi forma de navegar).
No cambies el comportamiento que describo abajo.

QUÉ TIENE QUE PASAR
1. Al abrir la app (unos 3 segundos después de que termina de cargar) se revisan las tareas y
   publicaciones que NO están terminadas y cuya fecha de entrega o publicación es HOY o ya pasó.
2. Por cada una sale una tarjeta en una ventana emergente (abajo a la derecha en la compu, arriba en el celular):
   - Vence hoy: "¡Atención! Hoy es el día de entrega" (o "…de publicación" si es una publicación). Color ámbar.
   - 1 día de atraso: "¡Atención! Un día atrasado". Color naranja.
   - 2 días de atraso: "¡Atención! Dos días atrasados". Color rojo.
   - 3 o más: "¡Atención! N días atrasados". Color rojo.
   Cada tarjeta muestra el título, la marca o el detalle, la fecha que tenía, el estado y,
   si no es de quien la ve, el nombre del responsable. Tiene un botón "Ver tarea" o "Ver publicación" que la abre.
3. Con UN DÍA O MÁS de atraso, la tarjeta agrega: "Para confirmar fecha de entrega, comunicate con [Nombre]"
   y un botón "Chat con [Nombre]" que abre el chat con esa persona. A esa persona no le sale ese botón.
4. Si hay más de 4, se muestran las 3 más atrasadas y una tarjeta "Y N entregas más para hoy o atrasadas"
   con un botón para ver la lista completa.
5. SONIDO PROPIO, distinto de los demás avisos de la app: un "ring-ring" rápido de despertador, dos veces.
   Se genera con Web Audio API (osciladores), sin archivos de audio. El navegador solo deja sonar después de que
   la persona toca la página una vez, así que hay que "despertar" el AudioContext con el primer toque o tecla.
6. Para que no moleste:
   - Cada aviso sale UNA vez a la mañana y otra vez a la tarde (desde las 14 h) si sigue pendiente.
     Se recuerda en el dispositivo (localStorage) con la clave tipo+id+día+turno.
   - Al día siguiente vuelve a salir, ya con un día más de atraso.
   - Deja de salir cuando la tarea se marca como entregada o terminada, o la publicación queda Programada o Publicada.
   - Se revisa cada 10 minutos para que salga el aviso de la tarde o el de un día nuevo sin recargar.
   - Botones "Después", la ✕ y la tecla Escape cierran la ventana.
7. QUIÉN LO VE:
   - Cada persona ve solo lo suyo (las tareas o publicaciones donde es responsable).
   - Los jefes (en mi app: [completar, ej.: "Admin total"]) ven las de todo el equipo, con el nombre de cada responsable.
   - Estos roles NO reciben ninguna ventana ni sonido: [completar, ej.: "Admin"].
     A ellos solo les sigue apareciendo el contador +1 o +2 del chat.
8. Si la app está abierta pero en otra pestaña o minimizada, además llega la notificación del celular
   o la compu (si la persona ya dio permiso).
9. Respetar "reducir animaciones" del sistema (sin animaciones) y que se vea bien en el celular (390 px de ancho).
10. Agregar en Configuración un botón "Probar: entrega atrasada" que muestre un ejemplo y haga sonar el sonido.

DATOS DE MI APP (completá o pedime lo que falte)
- Dónde están las tareas y sus campos: [ej.: tabla "tareas": id, titulo, marca, fecha_entrega, responsable, estado]
- Qué estados cuentan como terminado: [ej.: "Entregado", "Aprobado"]
- Dónde están las publicaciones y sus campos: [ej.: tabla "posts": id, titulo, marca, fecha, cm, estado]
- Qué estados de publicación cuentan como terminado: [ej.: "Programado", "Publicado"]
- Zona horaria para saber qué día es hoy: America/Asuncion
- Persona para confirmar fechas (botón de chat): [nombre y cómo abro su chat]

Cuando termines, decime qué archivos cambiaste y cómo lo pruebo.
```

---

## Ejemplo de uso a mano

```html
<script src="avisos-entregas.js"></script>
<script>
  AvisosEntregas.iniciar({
    usuario: { id: "u1", nombre: "Ana", rol: "CM" },          // quién está usando la app
    esJefe: u => u.rol === "Admin total",                     // los jefes ven lo de todo el equipo
    obtenerPendientes: () => [                                // todas las tareas y publicaciones
      { id: "T-12", tipo: "tarea", titulo: "Post Día del Niño", detalle: "Superseis · Post RRSS",
        fecha: "2026-10-22", responsable: "Ana", estado: "En proceso", terminado: false },
      { id: "P-7", tipo: "publicacion", titulo: "Historia cuotas", detalle: "Stock · Historia",
        fecha: "2026-10-20", responsable: "Ana", estado: "Pendiente", terminado: false },
    ],
    abrir: item => { /* ir a la tarea o publicación */ },
    contacto: { id: "alyssa", nombre: "Alyssa" },             // para "comunicate con Alyssa"
    abrirChat: persona => { /* abrir el chat con esa persona */ },
    verTodos: () => { /* ir a la lista completa */ },
    noMolestar: () => false,                                  // true = sin sonido
  });
  // Para probar: AvisosEntregas.probar();
</script>
```

Las opciones que se cambian arriba del archivo son la zona horaria (`ZONA`), la hora del aviso de la tarde (`HORA_TARDE`) y los roles sin ventana (`ROLES_SIN_VENTANA`).
