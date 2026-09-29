// Retail MKT Hub · conexión con Supabase: login real, guardado automático y sincronización en vivo.
// Se carga después del script principal de index.html y usa sus variables (PEOPLE, posts, jobs...).
//
// Cada colección se guarda como una fila de la tabla app_state:
//   s:<nombre>          compartida con todo el equipo
//   notes:<persona>     bloc de notas (solo lo ve su dueño)
//   prompts:<persona>   historial de prompts (solo lo ve su dueño)
//   thread:<id>         conversación (solo la ven sus dos participantes)
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
    CHANNEL_POSTS:[() => CHANNEL_POSTS, v => { CHANNEL_POSTS = v; }],
    MAIN_PRIORITIES:[() => MAIN_PRIORITIES, v => { MAIN_PRIORITIES = v; }],
  };

  let me = null, member = null, previewing = false, ready = false;
  const base = new Map(); // clave → { v: versión en el servidor, json: lo último que coincidió con el servidor }

  function localKeys(){
    return [...Object.keys(SHARED).map(k => "s:" + k), "notes:" + me, "prompts:" + me, ...THREADS.filter(t => t.a === me || t.b === me).map(t => "thread:" + t.id)];
  }
  function getLocal(key){
    if (key.startsWith("s:")) return SHARED[key.slice(2)][0]();
    if (key.startsWith("notes:")) return NOTES[me] || [];
    if (key.startsWith("prompts:")) return PROMPT_HISTORY[me] || [];
    return THREADS.find(t => "thread:" + t.id === key);
  }
  function setLocal(key, v){
    if (key.startsWith("s:")){ const h = SHARED[key.slice(2)]; if (h) h[1](v); }
    else if (key.startsWith("notes:")){ if (key === "notes:" + me) NOTES[me] = v; }
    else if (key.startsWith("prompts:")){ if (key === "prompts:" + me) PROMPT_HISTORY[me] = v; }
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
  let flushing = null, lastSeen = "", changedAt = 0, dirtySince = 0, rerenderPending = false, saveErrShown = false;
  function dirtyKeys(){ return localKeys().filter(k => getLocal(k) !== undefined && C(enc(getLocal(k))) !== (base.get(k)?.json ?? null)); }
  async function saveKey(key){
    for (let attempt = 0; attempt < 4; attempt++){
      const data = enc(getLocal(key)), json = C(data), b = base.get(key);
      if (b && b.json === json) return;
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
  function flush(){
    if (!ready || previewing) return Promise.resolve();
    if (flushing) return flushing;
    flushing = (async () => {
      try { for (const k of dirtyKeys()) await withTimeout(saveKey(k)); setStatus(""); saveErrShown = false; }
      catch (err){ console.error(err); setStatus("sin guardar"); if (!saveErrShown){ saveErrShown = true; toast("No se pudo guardar: revisá la conexión. Se vuelve a intentar solo."); } }
      finally { flushing = null; }
    })();
    return flushing;
  }
  // Revisa cambios cada segundo y guarda cuando se dejó de tocar (o cada 4 s si se sigue escribiendo).
  setInterval(() => {
    if (!ready || previewing) return;
    const snap = J(localKeys().map(k => [k, enc(getLocal(k))]));
    const now = Date.now();
    if (snap !== lastSeen){ lastSeen = snap; changedAt = now; if (!dirtySince) dirtySince = now; setStatus("guardando…"); }
    if (dirtySince && (now - changedAt > 800 || now - dirtySince > 4000)){ dirtySince = 0; flush(); }
  }, 1000);
  addEventListener("pagehide", () => flush());
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
    data.forEach(row => { if (row.key.startsWith("thread:") || localKeys().includes(row.key)) applyRow(row); });
    // Las colecciones que todavía no existen en la base se crean con los datos iniciales en el primer guardado.
    lastSeen = ""; dirtySince = Date.now();
  }
  function scheduleRender(){
    if (!ready) return;
    const f = document.activeElement;
    if (f && f.closest && f.closest("#content") && /^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName)){ rerenderPending = true; return; }
    rerenderPending = false; render();
  }
  document.addEventListener("focusout", () => setTimeout(() => { if (rerenderPending) scheduleRender(); }, 150));
  let channel = null;
  function subscribe(){
    channel = sb.channel("app_state").on("postgres_changes", { event:"*", schema:"public", table:"app_state" }, async p => {
      const key = p.new?.key; if (!key || previewing) return;
      if ((base.get(key)?.v || 0) >= (p.new.version || 0)) return;
      const { data: row } = await sb.from("app_state").select("key, data, version").eq("key", key).maybeSingle();
      if (row && applyRow(row)) scheduleRender();
    }).subscribe();
  }

  // ---------- login ----------
  const $id = id => document.getElementById(id);
  function msg(text, err){ const m = $id("loginMsg"); m.textContent = text; m.className = err ? "err" : "ok"; m.hidden = !text; }
  function setStatus(t){ const w = $id("whoami"); if (w) w.dataset.sync = t; }
  function showLogin(){ $id("login").hidden = false; $id("loginForm").hidden = false; $id("changeForm").hidden = true;
    try { const e = localStorage.getItem(EMAIL_KEY); if (e && !$id("loginEmail").value){ $id("loginEmail").value = e; $id("loginPass").focus(); } } catch (err) {} }
  // Recordar: el email queda guardado en este dispositivo y se le ofrece al navegador guardar la contraseña
  // (así no hay que escribirla cada vez). La sesión además queda abierta hasta tocar “Cerrar sesión”.
  const EMAIL_KEY = "rmh-last-email";
  function rememberLogin(email, password){
    try { if ($id("rememberMe")?.checked) localStorage.setItem(EMAIL_KEY, email); else localStorage.removeItem(EMAIL_KEY); } catch (err) {}
    if ($id("rememberMe")?.checked && window.PasswordCredential && navigator.credentials?.store){
      try { navigator.credentials.store(new PasswordCredential({ id:email, password, name:email })).catch(() => {}); } catch (err) {}
    }
  }

  async function afterLogin(user){
    msg("Cargando datos…");
    const { data: m, error } = await sb.from("members").select("*").eq("user_id", user.id).maybeSingle();
    if (error || !m || !m.active){ await sb.auth.signOut(); showLogin(); msg(error ? "No se pudo conectar. Probá de nuevo." : "Tu usuario no tiene acceso a la app. Pedíselo a un Admin total.", true); return; }
    member = m; me = m.person_id;
    try { await loadAll(); }
    catch (e){ console.error(e); showLogin(); msg("No se pudieron cargar los datos. Revisá la conexión y probá de nuevo.", true); return; }
    const pp = PEOPLE.find(x => x.id === me);
    if (!pp){ await sb.auth.signOut(); showLogin(); msg("Tu usuario no está en la lista del equipo. Pedile a un Admin total que lo revise.", true); return; }
    viewer = pp; viewer.role = m.role; viewer.mustChange = false; viewer.active = true;
    document.querySelectorAll('label[for="viewas"], #viewas').forEach(el => el.hidden = m.role !== "Admin total");
    ready = true; subscribe(); enterApp();
  }

  $id("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const email = $id("loginEmail").value.trim(), password = $id("loginPass").value;
    if (!email || !password){ msg("Escribí tu email y tu contraseña.", true); return; }
    msg("Entrando…");
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error){ msg(/invalid/i.test(error.message) ? "Email o contraseña incorrectos." : /banned/i.test(error.message) ? "Tu usuario está desactivado. Hablá con un Admin total." : "No se pudo entrar: " + error.message, true); return; }
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
    const email = $id("loginEmail").value.trim();
    if (!email.includes("@")){ msg("Escribí tu email arriba y volvé a tocar “¿Olvidaste tu contraseña?”.", true); return; }
    await sb.functions.invoke("admin-users", { body:{ action:"request_reset", email } }).catch(() => {});
    msg("Listo: si ese email tiene cuenta, avisamos a los admins. Te van a pasar una contraseña provisoria.");
  });
  $id("logout").addEventListener("click", async () => {
    await flush(); ready = false; await sb.auth.signOut(); location.reload();
  });

  (async () => {
    const { data } = await sb.auth.getSession();
    // Con la contraseña provisoria sin cambiar, se vuelve a pedir el login.
    if (data.session && !data.session.user.user_metadata?.must_change) afterLogin(data.session.user);
    else { if (data.session) await sb.auth.signOut(); showLogin(); }
  })();

  return {
    get me(){ return me; },
    get previewing(){ return previewing; },
    // Llama a la función del servidor que crea cuentas y cambia contraseñas (solo Admin total).
    async admin(body){
      const { data, error } = await sb.functions.invoke("admin-users", { body });
      if (error){ let t = "No se pudo completar."; try { t = (await error.context.json()).error || t; } catch (e) {} toast(t); return false; }
      return data;
    },
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
