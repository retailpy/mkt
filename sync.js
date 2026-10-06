// Retail MKT Hub · conexión con Supabase: login real, guardado automático y sincronización en vivo.
// Se carga después del script principal de index.html y usa sus variables (PEOPLE, posts, jobs...).
//
// Cada colección se guarda como una fila de la tabla app_state:
//   s:<nombre>          compartida con todo el equipo
//   notes:<persona>     bloc de notas (solo lo ve su dueño)
//   prompts:<persona>   historial de prompts (solo lo ve su dueño)
//   thread:<id>         conversación privada (solo la ven sus dos participantes)
//   chat:<grupo>        mensajes de un grupo del Chat (solo los ven sus integrantes, según s:CHAT_GROUPS)
// Encuestas y sugerencias (s:SURVEYS, s:SUGGESTIONS) solo las lee y guarda Admin total; los grupos los edita solo Admin total.
// Los cambios se detectan solos y se guardan a los segundos. Si dos personas cambian lo mismo a la vez,
// se combinan los cambios por elemento (id) en vez de pisarse.
const RMH = (() => {
  const cfg = window.RMH_CONFIG || {};
  const sb = window.supabase.createClient(cfg.url, cfg.key);
  const J = JSON.stringify;
  // Forma canónica (claves ordenadas): la base (jsonb) reordena las claves, así se compara el contenido real.
  const sortKeys = x => Array.isArray(x) ? x.map(sortKeys) : x && typeof x === "object" ? Object.keys(x).sort().reduce((o, k) => (o[k] = sortKeys(x[k]), o), {}) : x;
  const C = v => J(sortKeys(v));
  const enc = v => JSON.parse(J(v, (k, x) => x instanceof Set ? { __set:[...x] } : x));
  const dec = v => JSON.parse(J(v), (k, x) => x && typeof x === "object" && !Array.isArray(x) && Array.isArray(x.__set) && Object.keys(x).length === 1 ? new Set(x.__set) : x);
  const replaceArr = (arr, v) => { arr.length = 0; arr.push(...v); };
  const replaceObj = (obj, v) => { Object.keys(obj).forEach(k => delete obj[k]); Object.assign(obj, v); };
  // Preferencias de pantalla (van en localStorage) y contraseñas provisorias (nunca se guardan en la base).
  const LOCAL_ONLY = ["theme", "textSize", "motion", "tempPass"];

  const SHARED = {
    PEOPLE:[() => PEOPLE.map(pp => { const c = { ...pp }; LOCAL_ONLY.forEach(k => delete c[k]); return c; }), v => {
      const keep = new Map(PEOPLE.map(pp => [pp.id, pp]));
      replaceArr(PEOPLE, v.map(pp => { const old = keep.get(pp.id); if (old) LOCAL_ONLY.forEach(k => { if (old[k] !== undefined) pp[k] = old[k]; }); return pp; }));
      PEOPLE.forEach(pp => { if (pp.perms instanceof Set) upgradePerms(pp); }); // secciones nuevas
      if (viewer) viewer = PEOPLE.find(pp => pp.id === viewer.id) || viewer;
      refreshPeople(); }],
    posts:[() => posts, v => { posts = v; }],
    jobs:[() => jobs, v => { jobs = v; }],
    jobCounter:[() => jobCounter, v => { jobCounter = v; }],
    NOTIFS:[() => NOTIFS, v => { NOTIFS = v; }],
    notifSeq:[() => notifSeq, v => { notifSeq = v; }],
    resetRequests:[() => resetRequests, v => { resetRequests = v; }],
    RECURRING:[() => RECURRING, v => { RECURRING = v; }],
    RECUR_DONE:[() => RECUR_DONE, v => { RECUR_DONE = v; }],
    SAT_OFF:[() => SAT_OFF, v => { SAT_OFF = v; }],
    SAT_TURN:[() => SAT_TURN, v => { SAT_TURN = v; }],
    PAUTA_LIMITS:[() => PAUTA_LIMITS, v => { PAUTA_LIMITS = v; }],
    PAUTA_PLAN:[() => PAUTA_PLAN, v => { PAUTA_PLAN = v; }],
    SUGGESTIONS:[() => SUGGESTIONS, v => { SUGGESTIONS = v; }],
    OBJECTIVES:[() => OBJECTIVES, v => { OBJECTIVES = v; }],
    MONTH_CAMPAIGNS:[() => MONTH_CAMPAIGNS, v => { MONTH_CAMPAIGNS = v; }],
    UPCOMING:[() => UPCOMING, v => { UPCOMING = v; }],
    OBJ_PROPOSALS:[() => OBJ_PROPOSALS, v => { OBJ_PROPOSALS = v; }],
    SURVEYS:[() => SURVEYS, v => { SURVEYS = v; }],
    LINKS:[() => LINKS, v => { LINKS = v; }],
    AVISOS:[() => AVISOS, v => { AVISOS = v; }],
    CAMPAIGNS:[() => CAMPAIGNS, v => replaceArr(CAMPAIGNS, v)],
    META_ADS:[() => META_ADS, v => { META_ADS = v; }],
    META_FOLLOWERS:[() => META_FOLLOWERS, v => { META_FOLLOWERS = v || {}; }],
    META_DEMO:[() => META_DEMO, v => { META_DEMO = v || {}; }],
    META_POSTS:[() => META_POSTS, v => { META_POSTS = v || {}; }],
    META_CREATIVES:[() => META_CREATIVES, v => { META_CREATIVES = v || {}; }],
    META_INBOX:[() => META_INBOX, v => { META_INBOX = v || {}; }],
    INBOX_DONE:[() => INBOX_DONE, v => { INBOX_DONE = v || {}; }],
    META_REFS:[() => META_REFS, v => { META_REFS = v || {}; }],
    CHANNEL_POSTS:[() => CHANNEL_POSTS, v => { CHANNEL_POSTS = v; }],
    MAIN_PRIORITIES:[() => MAIN_PRIORITIES, v => { MAIN_PRIORITIES = v; }],
    CHAT_GROUPS:[() => CHAT_GROUPS, v => { CHAT_GROUPS = v; }],
    PRESENCE:[() => PRESENCE, v => { PRESENCE = v || {}; }],
    CHAT_MUTES:[() => CHAT_MUTES, v => { CHAT_MUTES = v || {}; }],
    CHAT_CLEARED:[() => CHAT_CLEARED, v => { CHAT_CLEARED = v || {}; }],
    STICKER_FAVS:[() => STICKER_FAVS, v => { STICKER_FAVS = v || {}; }],
    APP_FLAGS:[() => APP_FLAGS, v => { APP_FLAGS = v || {}; }],
    TEAM_IDEAS:[() => TEAM_IDEAS, v => { TEAM_IDEAS = Array.isArray(v) ? v : []; }],
  };
  // Claves que solo existen para Admin total (la base no se las deja leer ni guardar al resto).
  const ADMIN_ONLY = new Set(["s:SUGGESTIONS", "s:SURVEYS"]);
  // Claves que todos leen pero solo Admin total guarda. (Los grupos de chat los crea cualquiera: la base controla
  // que cada uno cambie solo los suyos.)
  const ADMIN_WRITE = new Set([]);
  const isAT = () => member?.role === "Admin total";

  let me = null, member = null, previewing = false, ready = false;
  const base = new Map(); // clave → { v: versión en el servidor, json: lo último que coincidió con el servidor }

  function localKeys(){
    return [...Object.keys(SHARED).map(k => "s:" + k).filter(k => isAT() || !ADMIN_ONLY.has(k)), "notes:" + me, "prompts:" + me,
      ...THREADS.filter(t => t.a === me || t.b === me).map(t => "thread:" + t.id),
      ...CHAT_GROUPS.filter(g => chatMember(g, { id:me, role:member?.role })).map(g => "chat:" + g.id)]; // siempre con quien inició sesión
  }
  function getLocal(key){
    if (key.startsWith("s:")) return SHARED[key.slice(2)][0]();
    if (key.startsWith("notes:")) return NOTES[me] || [];
    if (key.startsWith("prompts:")) return PROMPT_HISTORY[me] || [];
    if (key.startsWith("chat:")){ const id = key.slice(5); return CHATS[id] || (CHATS[id] = { id, msgs:[], seen:{} }); }
    return THREADS.find(t => "thread:" + t.id === key);
  }
  function setLocal(key, v){
    if (key.startsWith("s:")){ const h = SHARED[key.slice(2)]; if (h) h[1](v); }
    else if (key.startsWith("notes:")){ if (key === "notes:" + me) NOTES[me] = v; }
    else if (key.startsWith("prompts:")){ if (key === "prompts:" + me) PROMPT_HISTORY[me] = v; }
    else if (key.startsWith("chat:")) CHATS[key.slice(5)] = v;
    else if (key.startsWith("thread:")){ const i = THREADS.findIndex(t => "thread:" + t.id === key); if (i >= 0) THREADS[i] = v; else THREADS.push(v); }
  }

  // Combina dos versiones (ya codificadas) que partieron de la misma base: gana lo que cambió cada lado; en listas, por id.
  const isObj = x => x && typeof x === "object" && !Array.isArray(x);
  const hasIds = a => Array.isArray(a) && a.every(x => isObj(x) && "id" in x);
  function merge(b, l, r){
    if (C(l) === C(r)) return l;
    if (b === undefined) return l === undefined ? r : l;
    if (C(l) === C(b)) return r;
    if (C(r) === C(b)) return l;
    if (typeof l === "number" && typeof r === "number") return Math.max(l, r);
    if (hasIds(b) && hasIds(l) && hasIds(r)){
      const bm = new Map(b.map(x => [x.id, x])), lm = new Map(l.map(x => [x.id, x])), rm = new Map(r.map(x => [x.id, x])), out = [];
      r.forEach(x => {
        const bx = bm.get(x.id), lx = lm.get(x.id);
        if (!bx || !lx){ if (bx && C(x) === C(bx)) return; out.push(x); return; } // nuevo en el servidor, o borrado acá pero cambiado allá
        out.push(merge(bx, lx, x));
      });
      const ids = new Set(out.map(x => x.id));
      l.forEach(x => {
        if (rm.has(x.id) && bm.has(x.id)) return;
        if (bm.has(x.id)){ if (C(x) !== C(bm.get(x.id))) out.push(x); return; } // borrado allá pero cambiado acá
        if (!rm.has(x.id)){ out.push(x); ids.add(x.id); return; } // nuevo acá
        if (C(x) === C(rm.get(x.id))) return;
        // Las dos personas crearon algo con el mismo número: el de acá recibe otro.
        const nums = [...ids].filter(i => typeof i === "number");
        const id = typeof x.id === "number" ? Math.max(0, ...nums) + 1 : x.id + "-" + Math.random().toString(36).slice(2, 5);
        ids.add(id); out.push({ ...x, id });
      });
      return out;
    }
    if (Array.isArray(b) && Array.isArray(l) && Array.isArray(r) && [...b, ...l, ...r].every(x => !x || typeof x !== "object")){
      const bs = new Set(b.map(J)), ls = new Set(l.map(J)), rs = new Set(r.map(J));
      return [...r.filter(x => !(bs.has(C(x)) && !ls.has(C(x)))), ...l.filter(x => !bs.has(C(x)) && !rs.has(C(x)))];
    }
    if (isObj(b) && isObj(l) && isObj(r)){
      const out = {};
      new Set([...Object.keys(l), ...Object.keys(r)]).forEach(k => { const v = merge(b[k], l[k], r[k]); if (v !== undefined) out[k] = v; });
      return out;
    }
    return l;
  }

  // ---------- guardado ----------
  let flushing = null, lastSeen = "", changedAt = 0, dirtySince = 0, rerenderPending = false, saveErrShown = false, retryAt = 0;
  // Pendiente de guardar: cambió desde lo último del servidor, o todavía no existe en la base (v 0: se crea).
  // De solo lectura: las escriben las funciones de Meta; la app las lee pero nunca las guarda.
  const READONLY = new Set(["s:META_FOLLOWERS", "s:META_DEMO", "s:META_POSTS", "s:META_CREATIVES", "s:META_INBOX", "s:META_REFS"]);
  const noSave = k => READONLY.has(k) || (ADMIN_WRITE.has(k) && !isAT());
  function dirtyKeys(){ return localKeys().filter(k => { if (noSave(k) || getLocal(k) === undefined) return false; const b = base.get(k); return !b || b.v === 0 || C(enc(getLocal(k))) !== b.json; }); }
  async function saveKey(key){
    if (noSave(key)) return;
    for (let attempt = 0; attempt < 4; attempt++){
      const data = enc(getLocal(key)), json = C(data), b = base.get(key);
      if (b && b.v > 0 && b.json === json) return;
      const { data: v, error } = await sb.rpc("save_state", { p_key:key, p_data:data, p_base:b?.v || 0 });
      if (error) throw error;
      if (v !== null && v !== undefined){ base.set(key, { v, json }); return; }
      // Conflicto: alguien lo cambió antes. Se trae lo último y se combinan los cambios.
      const { data: row, error: e2 } = await sb.from("app_state").select("key, data, version").eq("key", key).maybeSingle();
      if (e2) throw e2;
      if (!row){ base.delete(key); continue; }
      const merged = merge(b?.json ? JSON.parse(b.json) : undefined, enc(getLocal(key)), row.data);
      base.set(key, { v:row.version, json:C(row.data) });
      setLocal(key, dec(merged)); scheduleRender();
    }
  }
  // Una conexión colgada no puede trabar el guardado: a los 20 s se corta y se reintenta.
  const withTimeout = p => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("tiempo de espera agotado")), 20000))]);
  // ---------- respaldo en el dispositivo ----------
  // Lo que todavía no llegó a la base se copia en este dispositivo (por persona). Si la sesión se corta o la página se
  // recarga antes de guardar, al volver a entrar se recupera y se combina con lo último de la base (no se pierde).
  const PEND = () => "rmh-pend-" + me;
  function stashPending(){
    try {
      if (!me || previewing || !ready) return;
      const keys = dirtyKeys();
      if (!keys.length){ localStorage.removeItem(PEND()); return; }
      localStorage.setItem(PEND(), J({ at:Date.now(), items:keys.map(k => [k, base.get(k)?.json || null, enc(getLocal(k))]) }));
    } catch (e) {}
  }
  function restorePending(){
    try {
      const raw = localStorage.getItem(PEND()); if (!raw) return 0;
      const p = JSON.parse(raw); localStorage.removeItem(PEND());
      if (!p || Date.now() - (p.at || 0) > 7 * 864e5) return 0;
      let n = 0;
      (p.items || []).forEach(([k, b, local]) => {
        if (noSave(k) || !(localKeys().includes(k) || k.startsWith("thread:"))) return;
        const cur = getLocal(k) === undefined ? undefined : enc(getLocal(k)), merged = merge(b ? JSON.parse(b) : undefined, local, cur);
        if (C(merged) !== C(cur)){ setLocal(k, dec(merged)); n++; }
      });
      return n;
    } catch (e){ console.warn("restorePending", e); return 0; }
  }
  // ---------- sesión cortada ----------
  // Si la sesión se corta (por ejemplo, la hora de la compu está mal y no se puede renovar), la app no lo puede guardar:
  // se avisa bien visible, lo cargado queda en el dispositivo y se vuelve a entrar sin recargar la página.
  let authLost = false, loggingOut = false;
  const isAuthErr = e => !!e && (e.status === 401 || e.code === "PGRST301" || e.code === "PGRST303" || /jwt|not authenticated|invalid refresh token|refresh token not found|session/i.test(e.message || ""));
  function lostSession(){
    if (authLost || !ready || previewing || loggingOut) return;
    authLost = true; stashPending(); setStatus("sin guardar");
    let b = $id("lostBar");
    if (!b){ b = document.createElement("div"); b.id = "lostBar"; b.className = "lostbar"; b.setAttribute("role", "alert"); document.body.appendChild(b); }
    b.innerHTML = `<div><b>Se cortó tu sesión: lo que cargues ahora no se guarda en la base.</b><span>No cierres ni recargues la página. Volvé a entrar y se guarda solo lo que cargaste.</span></div><button type="button" class="btn sm primary" id="lostRe">Volver a entrar</button>`;
    b.hidden = false; $id("lostRe").onclick = () => showLogin();
    try { toast("Se cortó tu sesión. Volvé a entrar para guardar lo que cargaste."); } catch (e) {}
  }
  // La hora de la computadora desfasada hace que la sesión se renueve sin parar y termine cortándose.
  // Se compara con la hora del servidor de la app (encabezado Date de una respuesta de este mismo sitio).
  // Diferencia entre la hora de esta compu y la del servidor (ms). El chat la usa para que la hora de cada mensaje
  // sea la real aunque la compu esté adelantada o atrasada (si no, sus mensajes quedaban fuera de orden).
  let clockOffset = 0;
  async function checkClock(){
    try {
      const clock = () => performance.timeOrigin + performance.now(); // la hora de la compu
      const t0 = clock(), r = await fetch("sw.js?t=" + Math.round(t0), { method:"HEAD", cache:"no-store" }), d = Date.parse(r.headers.get("date") || "");
      if (isNaN(d)) return;
      const off = d + 500 - (t0 + clock()) / 2; clockOffset = Math.abs(off) > 2000 ? Math.round(off) : 0; // la hora del servidor viene en segundos enteros
      const skew = Math.round(((t0 + clock()) / 2 - d) / 60000), old = $id("clockBar");
      if (Math.abs(skew) < 3){ old?.remove(); return; }
      const b = old || Object.assign(document.createElement("div"), { id:"clockBar", className:"lostbar warn" }); b.setAttribute("role", "alert");
      b.innerHTML = `<div><b>La hora de esta computadora está ${skew > 0 ? "adelantada" : "atrasada"} ${Math.abs(skew) >= 90 ? Math.round(Math.abs(skew) / 60) + " h" : Math.abs(skew) + " min"}.</b><span>Corregila (en Windows: Configuración → Hora e idioma → “Establecer la hora automáticamente”). Con la hora mal, la sesión se corta y no se guarda lo que cargás.</span></div><button type="button" class="btn sm" data-clockok>Entendido</button>`;
      if (!old) document.body.appendChild(b);
      b.querySelector("[data-clockok]").onclick = () => b.remove();
    } catch (e) {}
  }
  function flush(){
    if (!ready || previewing || authLost) return Promise.resolve();
    if (flushing) return flushing;
    // Sin nada propio para guardar (por ejemplo, solo llegó un cambio de otra persona) no se arranca un guardado.
    // Antes, ese guardado vacío terminaba al instante y quedaba marcado como “en curso” para siempre,
    // y lo que la persona cargaba después no se guardaba hasta recargar la página.
    const keys = dirtyKeys();
    if (!keys.length){ setStatus(""); return Promise.resolve(); }
    const run = (async () => {
      try { for (const k of keys) await withTimeout(saveKey(k)); setStatus(""); saveErrShown = false; stashPending(); }
      catch (err){ console.error(err); stashPending(); setStatus("sin guardar"); retryAt = Date.now() + 5000;
        if (isAuthErr(err)) lostSession(); else if (!saveErrShown){ saveErrShown = true; toast("No se pudo guardar: revisá la conexión. Se vuelve a intentar solo."); } }
      finally { if (flushing === run) flushing = null; }
    })();
    flushing = run;
    return run;
  }
  // Revisa cambios cada segundo y guarda cuando se dejó de tocar (o cada 4 s si se sigue escribiendo).
  setInterval(() => {
    if (!ready || previewing) return;
    const snap = J(localKeys().map(k => [k, enc(getLocal(k))]));
    const now = Date.now();
    if (snap !== lastSeen){ lastSeen = snap; changedAt = now; if (!dirtySince) dirtySince = now; setStatus(authLost ? "sin guardar" : "guardando…"); stashPending(); }
    if (dirtySince && (now - changedAt > 800 || now - dirtySince > 4000)){ dirtySince = 0; flush(); }
    else if (retryAt && now >= retryAt){ retryAt = 0; flush(); } // reintento después de un error de conexión
  }, 1000);
  addEventListener("pagehide", () => flush());
  // Si se cierra la app con algo sin guardar (por ejemplo, un pedido recién creado), el navegador pregunta antes de cerrar.
  addEventListener("beforeunload", e => {
    if (!ready || previewing) return;
    let pending = !!flushing; try { pending = pending || dirtyKeys().length > 0; } catch (err) {}
    if (pending){ stashPending(); flush(); e.preventDefault(); e.returnValue = ""; }
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });

  // ---------- carga y tiempo real ----------
  function applyRow(row){
    const key = row.key, b = base.get(key);
    if (b && b.v >= row.version) return false;
    const local = getLocal(key) === undefined ? undefined : enc(getLocal(key));
    const dirty = local !== undefined && b && C(local) !== b.json;
    setLocal(key, dec(dirty ? merge(JSON.parse(b.json), local, row.data) : row.data));
    base.set(key, { v:row.version, json:C(row.data) });
    return true;
  }
  async function loadAll(){
    const { data, error } = await sb.from("app_state").select("key, data, version");
    if (error) throw error;
    base.clear();
    THREADS = []; // solo las conversaciones que vienen del servidor
    data.sort((a, b) => (a.key.startsWith("s:") ? 0 : 1) - (b.key.startsWith("s:") ? 0 : 1)); // primero los grupos, después sus mensajes
    data.forEach(row => { if (row.key.startsWith("thread:") || row.key.startsWith("chat:") || localKeys().includes(row.key)) applyRow(row); });
    // Las que todavía no están en la base: su base es el valor inicial (versión 0). Así, si otra persona la crea
    // mientras tanto, lo que se cargó acá se combina en vez de perderse.
    localKeys().forEach(k => { if (!base.has(k) && getLocal(k) !== undefined) base.set(k, { v:0, json:C(enc(getLocal(k))) }); });
    // Las colecciones que todavía no existen en la base se crean con los datos iniciales en el primer guardado.
    lastSeen = ""; dirtySince = Date.now();
  }
  // Lo que llega de otra persona se aplica enseguida, pero la pantalla no se redibuja mientras alguien está
  // cargando algo (una ventana abierta o un formulario a medio escribir): así no se pierde lo que escribió.
  let typingForm = null;
  document.addEventListener("input", e => { const fm = e.target.closest && e.target.closest("#content form"); if (fm) typingForm = fm; });
  document.addEventListener("submit", () => { typingForm = null; setTimeout(() => { if (rerenderPending) scheduleRender(); }, 0); }, true);
  function busy(){
    const f = document.activeElement;
    if (f && f.id === "chatInput" && !document.querySelector("#content aside.drawer")) return false; // el chat se actualiza en vivo; render conserva lo que se está escribiendo
    if (f && f.closest && f.closest("#content") && (/^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName) || f.isContentEditable)) return true;
    if (document.querySelector(".rtedit[data-dirty]")) return true; // texto del pedido sin guardar
    if (document.querySelector("#content aside.drawer, #content .imodal, #jobForm")) return true; // formulario abierto: no se pisa lo cargado
    return !!(typingForm && document.body.contains(typingForm));
  }
  function scheduleRender(){
    if (!ready) return;
    if (busy()){ rerenderPending = true; try { renderNav(); chatNotify(); } catch (e) {} return; } // el aviso de chat nuevo llega igual, aunque estés escribiendo
    rerenderPending = false; render();
  }
  document.addEventListener("focusout", () => setTimeout(() => { if (rerenderPending) scheduleRender(); }, 150));
  document.addEventListener("click", () => setTimeout(() => { if (rerenderPending) scheduleRender(); }, 200));
  // Presencia: quien tiene la app abierta aparece "Disponible" solo, y desde cuándo está activo.
  let presenceCh = null;
  const since = new Date().toISOString();
  function presence(){
    ONLINE = { [me]:since };
    try {
      const ch = sb.channel("presencia", { config:{ presence:{ key:me } } });
      if (typeof ch.track !== "function") return; // sin soporte (pruebas): solo se ve a sí mismo en línea
      presenceCh = ch;
      ch.on("presence", { event:"sync" }, () => {
        const st = ch.presenceState(), o = {};
        Object.entries(st).forEach(([id, arr]) => { const t = (arr || []).map(x => x.since).filter(Boolean).sort()[0]; if (t) o[id] = t; });
        o[me] = o[me] || since; ONLINE = o; scheduleRender();
      });
      ch.subscribe(status => { if (status === "SUBSCRIBED") ch.track({ since }); });
    } catch (e){ console.error(e); }
  }
  let channel = null;
  function subscribe(){
    channel = sb.channel("app_state").on("postgres_changes", { event:"*", schema:"public", table:"app_state" }, async p => {
      const key = p.new?.key; if (!key || previewing) return;
      if ((base.get(key)?.v || 0) >= (p.new.version || 0)) return;
      const { data: row } = await sb.from("app_state").select("key, data, version").eq("key", key).maybeSingle();
      if (row && applyRow(row)) scheduleRender();
    }).subscribe(status => { if (status === "SUBSCRIBED") catchUp(); }); // al (re)conectar se trae lo que llegó mientras tanto
  }
  // La conexión en vivo se corta (celular bloqueado, pestaña en segundo plano, wifi, sesión renovada) y lo que llega
  // durante el corte no se repite. Por eso, además, se revisa qué cambió: cada 10 s, al volver a la app y al volver internet.
  let catching = false;
  async function catchUp(){
    if (!ready || previewing || catching) return; catching = true;
    try {
      const { data, error } = await sb.from("app_state").select("key, version");
      if (error && isAuthErr(error)) lostSession();
      if (error || !Array.isArray(data)) return;
      const stale = data.filter(r => (base.get(r.key)?.v || 0) < r.version).map(r => r.key);
      if (!stale.length) return;
      let changed = false;
      for (let i = 0; i < stale.length; i += 50){
        const { data: rows } = await sb.from("app_state").select("key, data, version").in("key", stale.slice(i, i + 50));
        (rows || []).forEach(r => { if (applyRow(r)) changed = true; });
      }
      if (changed) scheduleRender();
    } catch (e) { console.warn("catchUp", e); }
    finally { catching = false; }
  }
  setInterval(catchUp, 10000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") catchUp(); });
  addEventListener("online", () => catchUp());
  addEventListener("focus", () => catchUp());
  // La sesión se renueva cada hora: la conexión en vivo tiene que usar el token nuevo.
  try { sb.auth.onAuthStateChange((ev, s) => {
    if (s?.access_token && sb.realtime?.setAuth) sb.realtime.setAuth(s.access_token);
    if (ev === "SIGNED_OUT") lostSession();
  }); } catch (e) {}

  // ---------- login ----------
  const $id = id => document.getElementById(id);
  function msg(text, err){ const m = $id("loginMsg"); m.textContent = text; m.className = err ? "err" : "ok"; m.hidden = !text; }
  function setStatus(t){ const w = $id("whoami"); if (w) w.dataset.sync = t; }
  function showLogin(){ $id("login").hidden = false; $id("loginForm").hidden = false; $id("changeForm").hidden = true;
    try { const e = localStorage.getItem(EMAIL_KEY); if (e && !$id("loginEmail").value){ $id("loginEmail").value = e; $id("loginPass").focus(); } } catch (err) {} }
  // Recordar: el usuario (o email) queda guardado en este dispositivo y se le ofrece al navegador guardar la contraseña
  // (así no hay que escribirla cada vez). La sesión además queda abierta hasta tocar “Cerrar sesión”.
  const EMAIL_KEY = "rmh-last-email";
  function rememberLogin(email, password){
    try { if ($id("rememberMe")?.checked) localStorage.setItem(EMAIL_KEY, email); else localStorage.removeItem(EMAIL_KEY); } catch (err) {}
    if ($id("rememberMe")?.checked && window.PasswordCredential && navigator.credentials?.store){
      try { navigator.credentials.store(new PasswordCredential({ id:email, password, name:email })).catch(() => {}); } catch (err) {}
    }
  }

  async function afterLogin(user){
    // Volver a entrar después de que se cortó la sesión: no se recarga nada, se guarda lo que estaba pendiente.
    if (ready && member && authLost){
      if (user.id !== member.user_id){ stashPending(); location.reload(); return; }
      authLost = false; $id("lostBar")?.remove(); $id("login").hidden = true; msg("");
      retryAt = 0; flush(); catchUp(); try { toast("Listo: volviste a entrar. Se está guardando lo que cargaste."); } catch (e) {}
      return;
    }
    msg("Cargando datos…");
    const { data: m, error } = await sb.from("members").select("*").eq("user_id", user.id).maybeSingle();
    if (error || !m || !m.active){ await sb.auth.signOut(); showLogin(); msg(error ? "No se pudo conectar. Probá de nuevo." : "Tu usuario no tiene acceso a la app. Pedíselo a un Admin total.", true); return; }
    member = m; me = m.person_id;
    if (m.role !== "Admin total"){ SUGGESTIONS = []; SURVEYS = []; } // no se muestran ni se guardan: son solo de Admin total
    try { await loadAll(); }
    catch (e){ console.error(e); showLogin(); msg("No se pudieron cargar los datos. Revisá la conexión y probá de nuevo.", true); return; }
    const pp = PEOPLE.find(x => x.id === me);
    if (!pp){ await sb.auth.signOut(); showLogin(); msg("Tu usuario no está en la lista del equipo. Pedile a un Admin total que lo revise.", true); return; }
    viewer = pp; viewer.role = m.role; viewer.mustChange = false; viewer.active = true;
    const restored = restorePending(); // lo que no se llegó a guardar la vez anterior (sesión cortada o página cerrada)
    document.querySelectorAll('label[for="viewas"], #viewas').forEach(el => el.hidden = m.role !== "Admin total");
    ready = true; subscribe(); presence(); enterApp();
    if (restored) setTimeout(() => { try { toast(`Se recuperó lo que habías cargado sin guardar (${restored === 1 ? "1 sección" : restored + " secciones"}). Ya se está guardando.`); } catch (e) {} }, 1200);
    checkClock(); setInterval(checkClock, 30 * 60e3);
  }

  // Se entra con el usuario de ingreso (ej. "Alesme"); el email sigue funcionando. Con el usuario, la función del
  // servidor busca la cuenta y devuelve solo la sesión: los emails no salen del servidor.
  async function signIn(who, password){
    if (who.includes("@")) return sb.auth.signInWithPassword({ email:who, password });
    const r = await sb.functions.invoke("admin-users", { body:{ action:"login", username:who, password } });
    if (r.error){ let t = "No se pudo conectar. Probá de nuevo."; try { t = (await r.error.context.json()).error || t; } catch (e) {} return { data:{}, error:{ message:t, mine:true } }; }
    if (!r.data?.session) return { data:{}, error:{ message:"No se pudo conectar. Probá de nuevo.", mine:true } };
    return sb.auth.setSession(r.data.session);
  }
  $id("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const email = $id("loginEmail").value.trim(), password = $id("loginPass").value;
    if (!email || !password){ msg("Escribí tu usuario y tu contraseña.", true); return; }
    msg("Entrando…");
    const { data, error } = await signIn(email, password);
    if (error){ msg(error.mine ? error.message : /invalid/i.test(error.message) ? "Usuario o contraseña incorrectos." : /banned/i.test(error.message) ? "Tu usuario está desactivado. Hablá con un Admin total." : "No se pudo entrar: " + error.message, true); return; }
    rememberLogin(email, password);
    $id("loginPass").value = "";
    if (data.user.user_metadata?.must_change){
      $id("loginForm").hidden = true; $id("changeForm").hidden = false; msg("");
      $id("changeHello").textContent = "Entraste con una contraseña provisoria: elegí la tuya para continuar.";
      $id("newPass1").value = ""; $id("newPass2").value = ""; $id("changeErr").hidden = true; return;
    }
    afterLogin(data.user);
  });
  $id("changeForm").addEventListener("submit", async e => {
    e.preventDefault();
    const a = $id("newPass1").value, b = $id("newPass2").value, err = $id("changeErr");
    const fail = t => { err.textContent = t; err.hidden = false; };
    if (a.length < 10) return fail("La contraseña tiene que tener al menos 10 caracteres.");
    if (a !== b) return fail("Las dos contraseñas no coinciden.");
    const { data, error } = await sb.auth.updateUser({ password:a, data:{ must_change:false } });
    if (error) return fail(/different/i.test(error.message) ? "Elegí una contraseña distinta a la provisoria." : "No se pudo guardar: " + error.message);
    await afterLogin(data.user);
    if (ready){ viewer.mustChange = false; resetRequests = resetRequests.filter(id => id !== me); render(); toast("Listo: guardaste tu contraseña. Nadie más la conoce, ni los admins."); }
  });
  $id("forgot").addEventListener("click", async () => {
    const who = $id("loginEmail").value.trim();
    if (!who){ msg("Escribí tu usuario arriba y volvé a tocar “¿Olvidaste tu contraseña?”.", true); return; }
    await sb.functions.invoke("admin-users", { body:who.includes("@") ? { action:"request_reset", email:who } : { action:"request_reset", username:who } }).catch(() => {});
    msg("Listo: si ese usuario existe, avisamos a los admins. Te van a pasar una contraseña provisoria.");
  });
  $id("logout").addEventListener("click", async () => {
    loggingOut = true; await flush(); ready = false;
    // Al salir, este dispositivo deja de recibir los mensajes de esta persona.
    try { const reg = await navigator.serviceWorker?.getRegistration(), sub = await reg?.pushManager?.getSubscription(); if (sub) await sb.from("push_subs").delete().eq("endpoint", sub.endpoint); } catch (e) {}
    await sb.auth.signOut(); location.reload();
  });

  (async () => {
    const { data } = await sb.auth.getSession();
    // Con la contraseña provisoria sin cambiar, se vuelve a pedir el login.
    if (data.session && !data.session.user.user_metadata?.must_change) afterLogin(data.session.user);
    else { if (data.session) await sb.auth.signOut(); showLogin(); }
  })();

  return {
    get me(){ return me; },
    get clockOffset(){ return clockOffset; },
    get previewing(){ return previewing; },
    // Llama a la función del servidor que crea cuentas y cambia contraseñas (solo Admin total).
    async admin(body){
      const { data, error } = await sb.functions.invoke("admin-users", { body });
      if (error){ let t = "No se pudo completar."; try { t = (await error.context.json()).error || t; } catch (e) {} toast(t); return false; }
      return data;
    },
    // Notificaciones push del chat: clave pública del servidor y los dispositivos de cada persona.
    // Guarda ya (sin esperar el segundo de pausa): los mensajes del chat salen al instante.
    flushNow(){ return flush(); },
    // GIFs y stickers (función "integraciones" de Supabase: las claves quedan en el servidor).
    async integ(body){
      if (previewing && !["gifs", "stickers", "preview_send", "tendencias"].includes(body.action)) return { ok:false, error:"No disponible en la vista previa" };
      const { data, error } = await sb.functions.invoke("integraciones", { body });
      if (error){ let t = "No se pudo conectar. Probá de nuevo."; try { t = (await error.context.json()).error || t; } catch (e) {} return { ok:false, error:t }; }
      return data || { ok:false, error:"Sin respuesta" };
    },
    // Material adjunto de los pedidos: archivos privados del equipo (bucket "material" de Supabase Storage).
    async upload(path, file){
      if (previewing) return { ok:false, error:"No disponible en la vista previa" };
      const { error } = await sb.storage.from("material").upload(path, file, { contentType:file.type || "application/octet-stream", upsert:false });
      return error ? { ok:false, error:/size|large|exceed/i.test(error.message) ? "El archivo supera 15 MB" : "No se pudo subir el archivo" } : { ok:true };
    },
    async fileUrl(path, name){ const { data, error } = await sb.storage.from("material").createSignedUrl(path, 600, name ? { download:name } : undefined); return error ? null : data?.signedUrl || null; },
    async fileDel(path){ const { error } = await sb.storage.from("material").remove([path]); return !error; },
    // Sesión actual (para pedirle a las funciones de Vercel que actualicen datos, por ejemplo los mensajes de las cuentas).
    catchUp(){ return catchUp(); },
    async token(){ const { data } = await sb.auth.getSession(); return data?.session?.access_token || null; },
    async pushKey(){ const { data, error } = await sb.functions.invoke("chat-push", { method:"GET" }); return error ? null : data?.key || null; },
    async pushSave(sub){ if (!me || previewing) return false; const { error } = await sb.from("push_subs").upsert({ endpoint:sub.endpoint, person_id:me, sub }); return !error; },
    async pushDel(endpoint){ await sb.from("push_subs").delete().eq("endpoint", endpoint); },
    async changePassword(oldPass, newPass){
      const { data: u } = await sb.auth.getUser();
      const { error: e1 } = await sb.auth.signInWithPassword({ email:u.user.email, password:oldPass });
      if (e1) return "La contraseña actual no es correcta.";
      const { error } = await sb.auth.updateUser({ password:newPass });
      return error ? "No se pudo cambiar: " + error.message : null;
    },
    // "Ver como": mientras se mira el sitio como otra persona, no se guarda nada.
    async viewAs(id, then){
      if (id === me){ if (previewing){ try { await loadAll(); } catch (e) {} previewing = false; } }
      else if (!previewing){ await flush(); previewing = true; }
      then();
    },
    flush,
  };
})();
// Visible para index.html (window.RMH): GIFs, stickers, envío inmediato del chat y notificaciones lo usan.
window.RMH = RMH;
