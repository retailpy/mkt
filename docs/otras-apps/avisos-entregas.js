/* =====================================================================
   Avisos de entregas de hoy y atrasadas
   Ventana emergente + sonido de despertador (sin archivos de audio)
   Sacado de Retail MKT Hub (v231–v233). JavaScript puro, sin librerías.
   ---------------------------------------------------------------------
   Cómo se usa (mínimo):
     AvisosEntregas.iniciar({
       usuario: { id: "u1", nombre: "Ana", rol: "Diseñador" },
       obtenerPendientes: () => [ ...lista de tareas/publicaciones... ],
       abrir: (item) => { ...ir a la tarea o publicación... },
       contacto: { id: "alyssa", nombre: "Alyssa" },   // opcional
       abrirChat: (contacto) => { ...abrir el chat... }, // opcional
     });
   Cada pendiente es un objeto así:
     { id: "T-12", tipo: "tarea" | "publicacion", titulo: "Post Día del Niño",
       detalle: "Superseis · Post RRSS", fecha: "2026-10-21",  // fecha de entrega o publicación (AAAA-MM-DD)
       responsable: "Ana", estado: "En proceso", terminado: false }
   ===================================================================== */
(function () {
  const ZONA = "America/Asuncion";        // zona horaria para saber qué día es "hoy"
  const HORA_TARDE = 14;                  // a partir de esta hora vuelve a avisar lo que sigue pendiente
  const MAX_TARJETAS = 4;                 // si hay más, se muestran 3 y una tarjeta "Y N más"
  const ROLES_SIN_VENTANA = ["Admin"];    // estos roles no reciben ventanas ni sonido

  const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date()); // "2026-10-21"
  const diasHasta = f => Math.round((new Date(f + "T12:00") - new Date(hoy() + "T12:00")) / 86400000); // 0 = hoy, -1 = ayer
  const turno = () => +new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, hour: "2-digit", hourCycle: "h23" }).format(new Date()) >= HORA_TARDE ? "tarde" : "manana";
  const ddmm = f => f.slice(8, 10) + "/" + f.slice(5, 7);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---- Textos y colores según el atraso ----
  const titulo = (d, esPub) => d >= 0 ? `¡Atención! Hoy es el día de ${esPub ? "publicación" : "entrega"}`
    : `¡Atención! ${d === -1 ? "Un día atrasado" : d === -2 ? "Dos días atrasados" : `${-d} días atrasados`}`;
  const color = d => d >= 0 ? "#f59e0b" : d === -1 ? "#f97316" : "#ef4444"; // ámbar hoy, naranja 1 día, rojo 2+

  // ---- Sonido tipo despertador (Web Audio, sin archivos) ----
  let ctx = null, ultimo = 0;
  const audio = () => {
    try {
      if (!ctx) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ctx = new A(); }
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
    } catch { ctx = null; }
    return ctx;
  };
  // El navegador solo deja sonar después de que la persona tocó la página una vez: se "despierta" el audio al primer toque.
  ["pointerdown", "keydown", "touchend"].forEach(ev => document.addEventListener(ev, () => { if (!ctx || ctx.state !== "running") audio(); }, { capture: true, passive: true }));
  function campanita(c, salida, f, t, dur, vol) {
    [[f, vol, "sine", dur], [f * 2.01, vol * 0.22, "sine", dur * 0.55], [f * 3, vol * 0.06, "triangle", dur * 0.3]].forEach(([fr, v, tipo, d]) => {
      const o = c.createOscillator(), g = c.createGain(); o.type = tipo; o.frequency.setValueAtTime(fr, t);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(salida); o.start(t); o.stop(t + d + 0.05);
    });
  }
  function sonarDespertador(forzar) {
    if (!forzar && Date.now() - ultimo < 2500) return false; ultimo = Date.now();
    const c = audio(); if (!c || c.state !== "running") return false;
    const salida = c.createGain(), filtro = c.createBiquadFilter(); filtro.type = "lowpass"; filtro.frequency.value = 5200; salida.gain.value = 0.32;
    salida.connect(filtro); filtro.connect(c.destination);
    const t = c.currentTime + 0.03;
    // "ring-ring" rápido (sol-mi-sol-mi agudos), dos veces
    [0, 0.62].forEach(at => [1567.98, 1318.51, 1567.98, 1318.51].forEach((f, i) => campanita(c, salida, f, t + at + i * 0.11, 0.16, 0.34)));
    return true;
  }

  // ---- Estilos de la ventana (se agregan solos) ----
  const CSS = `
.ae-pop{position:fixed;right:22px;bottom:22px;z-index:9000;width:min(380px,calc(100vw - 32px));animation:aeIn .55s cubic-bezier(.2,1.3,.4,1) both;font-family:system-ui,sans-serif}
.ae-pop.out{animation:aeOut .25s ease-in both}
.ae-card{position:relative;background:#0f172a;color:#e2e8f0;border:2px solid color-mix(in srgb,var(--c) 55%,transparent);border-radius:18px;padding:14px;box-shadow:0 18px 50px rgba(0,0,0,.45),0 0 0 4px color-mix(in srgb,var(--c) 18%,transparent);animation:aeNudge .9s .55s ease-in-out 3}
.ae-ring{position:absolute;inset:-2px;border-radius:19px;pointer-events:none;animation:aePulse 1.2s ease-out 6}
.ae-head{display:flex;gap:10px;align-items:center}.ae-head b{display:block;font-size:16px;color:var(--c)}.ae-head small{color:#94a3b8;font-size:12px}
.ae-ico{flex:none;display:grid;place-items:center;width:42px;height:42px;border-radius:50%;background:color-mix(in srgb,var(--c) 22%,transparent);font-size:22px;animation:aeBell .7s .4s ease-in-out 5}
.ae-x{margin-left:auto;background:none;border:0;color:#94a3b8;font-size:18px;cursor:pointer;padding:6px}
.ae-list{display:grid;gap:8px;margin-top:10px;max-height:min(52vh,420px);overflow:auto}
.ae-item{display:grid;gap:4px;justify-items:start;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--c) 9%,transparent);border-left:3px solid var(--c)}
.ae-k{font-size:12px;font-weight:700;color:var(--c)}.ae-t{font-size:15px}.ae-m{font-size:13px;color:#94a3b8}.ae-ask{font-size:13px;font-weight:600}
.ae-btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.ae-btn{border:1px solid #334155;background:#1e293b;color:#e2e8f0;border-radius:999px;padding:6px 12px;font-size:13px;cursor:pointer}
.ae-btn.pri{background:#22d3ee;border-color:#22d3ee;color:#0f172a;font-weight:700}
.ae-foot{display:flex;justify-content:flex-end;margin-top:10px}
@keyframes aeIn{0%{opacity:0;transform:translateY(40px) scale(.9)}100%{opacity:1;transform:none}}
@keyframes aeOut{to{opacity:0;transform:translateY(24px) scale(.96)}}
@keyframes aePulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--c) 55%,transparent)}100%{box-shadow:0 0 0 18px transparent}}
@keyframes aeBell{0%,100%{transform:rotate(0)}20%{transform:rotate(-14deg)}40%{transform:rotate(12deg)}60%{transform:rotate(-8deg)}80%{transform:rotate(5deg)}}
@keyframes aeNudge{0%,100%{transform:none}15%{transform:translateX(-5px)}30%{transform:translateX(5px)}45%{transform:translateX(-3px)}60%{transform:translateX(3px)}}
@media (max-width:700px){.ae-pop{right:16px;left:16px;width:auto;bottom:auto;top:12px}}
@media (prefers-reduced-motion:reduce){.ae-pop,.ae-card,.ae-ring,.ae-ico{animation:none!important}}`;
  function ponerEstilos() { if (document.getElementById("ae-css")) return; const s = document.createElement("style"); s.id = "ae-css"; s.textContent = CSS; document.head.appendChild(s); }

  // ---- Lógica: qué avisar ----
  let cfg = null, abiertos = [];
  const claveVistos = () => "avisos-entregas-" + cfg.usuario.id;
  const leerVistos = () => { try { return JSON.parse(localStorage.getItem(claveVistos())) || []; } catch { return []; } };
  const guardarVistos = ids => { try { localStorage.setItem(claveVistos(), JSON.stringify(ids.slice(-300))); } catch {} };

  // Lo que vence hoy o ya venció y no está terminado. Cada persona ve lo suyo; los jefes (esJefe) ven lo de todos.
  function pendientesDeHoyYAtrasados() {
    const u = cfg.usuario, todo = cfg.esJefe ? cfg.esJefe(u) : false;
    return (cfg.obtenerPendientes() || [])
      .filter(x => !x.terminado && x.fecha && diasHasta(x.fecha) <= 0 && (todo || x.responsable === u.nombre))
      .map(x => ({ ...x, d: diasHasta(x.fecha) }))
      .sort((a, b) => a.d - b.d); // el más atrasado primero
  }

  function revisar() {
    if (!cfg || ROLES_SIN_VENTANA.includes(cfg.usuario.rol)) return;
    const lista = pendientesDeHoyYAtrasados(); if (!lista.length) return;
    const vistos = leerVistos(), t = turno(), dia = hoy();
    // Cada aviso sale una vez a la mañana y otra a la tarde (si sigue pendiente). Al día siguiente vuelve, con más días de atraso.
    const nuevos = lista.map(x => ({ ...x, clave: `${x.tipo}:${x.id}|${dia}|${t}` })).filter(x => !vistos.includes(x.clave));
    if (!nuevos.length) return;
    guardarVistos([...vistos, ...nuevos.map(x => x.clave)]);
    let tarjetas = nuevos;
    if (nuevos.length > MAX_TARJETAS) {
      const resto = nuevos.slice(3);
      tarjetas = [...nuevos.slice(0, 3), { resumen: true, n: resto.length, atrasados: resto.filter(x => x.d < 0).length, d: Math.min(...resto.map(x => x.d)) }];
    }
    abiertos = tarjetas; mostrar();
    if (!cfg.noMolestar?.()) { sonarDespertador(); avisoDelSistema(nuevos); }
  }

  // ---- La ventana ----
  function mostrar() {
    let el = document.getElementById("ae-pop");
    if (!abiertos.length) { if (el) { el.classList.add("out"); setTimeout(() => el.remove(), 260); } return; }
    if (!el) { el = document.createElement("div"); el.id = "ae-pop"; el.setAttribute("role", "alertdialog"); el.setAttribute("aria-live", "assertive"); document.body.appendChild(el); }
    const total = abiertos.reduce((s, x) => s + (x.resumen ? x.n : 1), 0), top = abiertos[0];
    el.className = "ae-pop"; el.style.setProperty("--c", color(top.d));
    const items = abiertos.map((x, i) => {
      if (x.resumen) return `<div class="ae-item" style="--c:${color(x.d)}"><span class="ae-k">¡Atención! Más entregas</span><b class="ae-t">Y ${x.n} ${x.n === 1 ? "entrega más" : "entregas más"} para hoy o atrasadas</b>
        <span class="ae-m">${[x.atrasados && `${x.atrasados} atrasados`, x.n - x.atrasados && `${x.n - x.atrasados} para hoy`].filter(Boolean).join(" · ")}</span>
        ${cfg.verTodos ? `<div class="ae-btns"><button class="ae-btn" data-ae-todos>Ver todos</button></div>` : ""}</div>`;
      const esPub = x.tipo === "publicacion", otro = x.responsable !== cfg.usuario.nombre;
      const m = `${esc(x.detalle || "")} · ${x.d >= 0 ? (esPub ? "se publica hoy" : "se entrega hoy") : (esPub ? "tenía que publicarse el " : "tenía que entregarse el ") + ddmm(x.fecha)}${x.estado ? " · " + esc(x.estado) : ""}${otro ? " · " + esc(x.responsable || "sin asignar") : ""}`;
      const pedir = x.d < 0 && cfg.contacto && cfg.abrirChat && cfg.contacto.id !== cfg.usuario.id; // 1+ día de atraso: confirmar fecha
      return `<div class="ae-item" style="--c:${color(x.d)}"><span class="ae-k">⏰ ${titulo(x.d, esPub)}</span><b class="ae-t">${esc(x.titulo)}</b><span class="ae-m">${m}</span>
        ${pedir ? `<span class="ae-ask">💬 Para confirmar fecha de entrega, comunicate con ${esc(cfg.contacto.nombre)}</span>` : ""}
        <div class="ae-btns">${pedir ? `<button class="ae-btn pri" data-ae-chat="${i}">Chat con ${esc(cfg.contacto.nombre)}</button>` : ""}<button class="ae-btn${pedir ? "" : " pri"}" data-ae-ver="${i}">${esPub ? "Ver publicación" : "Ver tarea"}</button></div></div>`;
    }).join("");
    el.innerHTML = `<div class="ae-card"><span class="ae-ring"></span><div class="ae-head"><span class="ae-ico">⏰</span><div><b>${abiertos.length > 1 ? `¡Atención! Entregas de hoy y atrasadas (${total})` : esc(titulo(top.d, top.tipo === "publicacion"))}</b><small>recién</small></div><button class="ae-x" data-ae-cerrar aria-label="Cerrar">✕</button></div>
      <div class="ae-list">${items}</div><div class="ae-foot"><button class="ae-btn" data-ae-cerrar>Después</button></div></div>`;
  }
  document.addEventListener("click", e => {
    const v = e.target.closest("[data-ae-ver]"), c = e.target.closest("[data-ae-chat]");
    if (v) { const x = abiertos[+v.dataset.aeVer]; abiertos = abiertos.filter(y => y !== x); mostrar(); cfg.abrir?.(x); return; }
    if (c) { abiertos = abiertos.filter(y => y !== abiertos[+c.dataset.aeChat]); mostrar(); cfg.abrirChat(cfg.contacto); return; }
    if (e.target.closest("[data-ae-todos]")) { abiertos = []; mostrar(); cfg.verTodos(); return; }
    if (e.target.closest("[data-ae-cerrar]")) { abiertos = []; mostrar(); }
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && abiertos.length) { abiertos = []; mostrar(); } });

  // Si la app está abierta pero en otra pestaña, avisa también con la notificación del celular o la compu (si la persona la permitió).
  function avisoDelSistema(lista) {
    if (!("Notification" in window) || Notification.permission !== "granted" || (document.visibilityState === "visible" && document.hasFocus())) return;
    lista.slice(0, 3).forEach(x => { try { new Notification(titulo(x.d, x.tipo === "publicacion"), { body: x.titulo, tag: "ae-" + x.id }); } catch {} });
  }

  window.AvisosEntregas = {
    iniciar(opciones) {
      cfg = opciones; ponerEstilos();
      setTimeout(revisar, 3000);                 // al abrir la app (espera a que termine de cargar)
      setInterval(revisar, 10 * 60 * 1000);      // cada 10 min revisa: así sale el aviso de la tarde y el de un día nuevo
    },
    revisar,                                       // llamalo también cuando cambian los datos (p. ej., le asignaron una tarea)
    probar() { abiertos = [{ id: "demo", tipo: "tarea", titulo: "Ejemplo: Cartel de góndola", detalle: "Stock · Cartelería", fecha: new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10), estado: "En proceso", responsable: cfg?.usuario?.nombre, d: -2 }]; ponerEstilos(); mostrar(); setTimeout(() => sonarDespertador(true), 30); },
  };
})();
