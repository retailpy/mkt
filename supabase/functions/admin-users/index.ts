// Retail MKT Hub · gestión de cuentas (solo Admin total), con la clave de servicio del lado del servidor.
// Acciones: create, set_password, set_active, set_role, remove  (requieren sesión de Admin total)
//           request_reset                                     (pública: "¿Olvidaste tu contraseña?")
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const ROLES = ["Admin total", "Admin", "Diseñador", "CM"];
const BAN_FOREVER = "876000h";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function member(personId: string) {
  const { data } = await db.from("members").select("*").eq("person_id", personId).maybeSingle();
  return data;
}
async function activeAdminTotals() {
  const { count } = await db.from("members").select("*", { count: "exact", head: true })
    .eq("role", "Admin total").eq("active", true);
  return count ?? 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ error: "Pedido inválido" }, 400); }
  const action = String(body.action || "");

  // Pública: deja el pedido para que un Admin total restablezca la contraseña. No revela si el email existe.
  if (action === "request_reset") {
    const email = String(body.email || "").trim().toLowerCase();
    if (email) {
      const { data: m } = await db.from("members").select("person_id").ilike("email", email).eq("active", true).maybeSingle();
      if (m) {
        const { data: row } = await db.from("app_state").select("data, version").eq("key", "s:resetRequests").maybeSingle();
        const list: string[] = Array.isArray(row?.data) ? row!.data : [];
        if (!list.includes(m.person_id)) {
          list.push(m.person_id);
          if (row) await db.from("app_state").update({ data: list, version: row.version + 1, updated_at: new Date().toISOString() }).eq("key", "s:resetRequests").eq("version", row.version);
          else await db.from("app_state").insert({ key: "s:resetRequests", data: list });
        }
      }
    }
    return json({ ok: true });
  }

  // El resto: solo Admin total activo.
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await db.auth.getUser(token);
  if (!auth?.user) return json({ error: "Tenés que iniciar sesión." }, 401);
  const { data: me } = await db.from("members").select("*").eq("user_id", auth.user.id).maybeSingle();
  if (!me || !me.active || me.role !== "Admin total") return json({ error: "Solo un Admin total puede hacer esto." }, 403);

  const personId = String(body.person_id || "");
  if (!personId) return json({ error: "Falta la persona." }, 400);
  const target = await member(personId);
  const isLastAdmin = target?.role === "Admin total" && target?.active && (await activeAdminTotals()) <= 1;

  if (action === "create" || action === "set_password") {
    const password = String(body.password || "");
    if (password.length < 10) return json({ error: "La contraseña tiene que tener al menos 10 caracteres." }, 400);
    const email = String(body.email || target?.email || "").trim().toLowerCase();
    const role = String(body.role || target?.role || "");
    if (!email.includes("@")) return json({ error: "Esta persona no tiene un email válido." }, 400);
    if (!ROLES.includes(role)) return json({ error: "Rol inválido." }, 400);
    const meta = { person_id: personId, must_change: true };
    let userId = target?.user_id as string | null;
    if (userId) {
      const { error } = await db.auth.admin.updateUserById(userId, { password, user_metadata: meta, ban_duration: "none" });
      if (error) return json({ error: error.message }, 400);
    } else {
      const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: meta });
      if (error) return json({ error: error.message.includes("already") ? "Ya existe una cuenta con ese email." : error.message }, 400);
      userId = data.user.id;
    }
    const { error } = await db.from("members").upsert({ person_id: personId, email, role, active: true, user_id: userId });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (!target) return json({ ok: true, note: "Esa persona todavía no tiene cuenta." });

  if (action === "set_active") {
    const active = !!body.active;
    if (!active && isLastAdmin) return json({ error: "Tiene que quedar al menos un Admin total activo." }, 400);
    if (target.user_id) await db.auth.admin.updateUserById(target.user_id, { ban_duration: active ? "none" : BAN_FOREVER });
    await db.from("members").update({ active }).eq("person_id", personId);
    return json({ ok: true });
  }
  if (action === "set_role") {
    const role = String(body.role || "");
    if (!ROLES.includes(role)) return json({ error: "Rol inválido." }, 400);
    if (role !== "Admin total" && isLastAdmin) return json({ error: "Tiene que quedar al menos un Admin total activo." }, 400);
    await db.from("members").update({ role }).eq("person_id", personId);
    return json({ ok: true });
  }
  if (action === "remove") {
    if (isLastAdmin) return json({ error: "No podés quitar al último Admin total activo." }, 400);
    if (target.user_id === auth.user.id) return json({ error: "No podés quitarte a vos." }, 400);
    await db.from("members").delete().eq("person_id", personId);
    if (target.user_id) await db.auth.admin.deleteUser(target.user_id);
    return json({ ok: true });
  }
  return json({ error: "Acción desconocida." }, 400);
});
