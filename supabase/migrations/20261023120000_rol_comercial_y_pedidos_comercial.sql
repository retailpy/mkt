-- Rol Comercial y Pedidos Comercial (v242).
-- Comercial: los compradores (ej. Gisella Aquino, usuario Gaquino). En la app ven el Dashboard (solo sus supermercados),
-- las ofertas de Comercial y sus Pedidos de activaciones. La base les deja leer solo eso (más PEOPLE, APP_FLAGS y PRESENCE,
-- que la app necesita para entrar) y guardar solo s:PEDIDOS_COM, su presencia y su perfil (s:PEOPLE). Sin chat ni material
-- de los pedidos del equipo más allá de lo que suben ellos (el bucket “material” sigue igual para todos).
-- s:PEDIDOS_COM: el resto del equipo lo lee y guarda como cualquier clave compartida (Admin total lo pasa a Diseño o CM y,
-- cuando el CM publica, la app lo marca “Publicado”).
-- Avisos push (trigger chat_push → chat-push): pedido nuevo → a Admin total; pedido publicado → al comprador que lo cargó.

alter table public.members drop constraint members_role_check;
alter table public.members add constraint members_role_check check (role = any (array['Admin total', 'Admin', 'Diseñador', 'CM', 'Revisor', 'Comercial']));

create or replace function private.is_comercial()
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select exists (select 1 from public.members where user_id = auth.uid() and active and role = 'Comercial')
$function$;

create or replace function private.no_chat()
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select private.is_revisor() or private.is_comercial() or exists (
    select 1
    from public.app_state s
    cross join lateral jsonb_array_elements(case when jsonb_typeof(s.data) = 'array' then s.data else '[]'::jsonb end) e
    where s.key = 's:PEOPLE'
      and e->>'id' = private.my_person_id()
      and coalesce((e->>'noChat')::boolean, false)
  )
$function$;

create or replace function private.can_access_state(p_key text, p_data jsonb)
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select case
    when private.my_person_id() is null then false
    when private.is_revisor() then p_key in ('s:PEOPLE', 's:APP_FLAGS', 's:PRESENCE', 's:INBOX_DONE', 's:META_INBOX', 's:META_DM', 's:META_DM_LOG', 's:META_IG_ACT', 's:META_POSTS')
    when private.is_comercial() then p_key in ('s:PEOPLE', 's:APP_FLAGS', 's:PRESENCE', 's:PEDIDOS_COM', 's:COMERCIAL', 's:META_FOLLOWERS', 's:META_DEMO', 's:META_POSTS')
    when p_key like 'notes:%' or p_key like 'prompts:%' then split_part(p_key, ':', 2) = private.my_person_id()
    when p_key like 'thread:%' then not private.no_chat() and private.my_person_id() in (p_data->>'a', p_data->>'b')
    when p_key like 'chat:%' then not private.no_chat() and exists (
      select 1
      from public.app_state g
      cross join lateral jsonb_array_elements(case when jsonb_typeof(g.data) = 'array' then g.data else '[]'::jsonb end) e
      where g.key = 's:CHAT_GROUPS'
        and e->>'id' = substr(p_key, 6)
        and (
          coalesce((e->>'all')::boolean, false)
          or coalesce(e->'members', '[]'::jsonb) ? private.my_person_id()
          or exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and coalesce(e->'roles', '[]'::jsonb) ? m.role)
        )
    )
    when p_key in ('s:SUGGESTIONS', 's:SURVEYS') then private.is_admin_total()
    when p_key = 's:INFLUENCERS' then exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role in ('Admin total', 'CM'))
    when p_key in ('s:META_INBOX', 's:RECLAMOS', 's:ESCRACHES', 's:META_DM', 's:META_DM_LOG', 's:META_IG_ACT') then exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role in ('Admin total', 'Admin', 'CM'))
    else p_key like 's:%'
  end
$function$;

-- Comercial solo guarda sus pedidos, su presencia y su perfil (restrictivas: se suman a las demás reglas).
drop policy if exists "app_state: comercial solo sus pedidos (modificar)" on public.app_state;
create policy "app_state: comercial solo sus pedidos (modificar)" on public.app_state as restrictive for update
  using (not private.is_comercial() or key in ('s:PEDIDOS_COM', 's:PRESENCE', 's:PEOPLE'))
  with check (not private.is_comercial() or key in ('s:PEDIDOS_COM', 's:PRESENCE', 's:PEOPLE'));
drop policy if exists "app_state: comercial solo sus pedidos (crear)" on public.app_state;
create policy "app_state: comercial solo sus pedidos (crear)" on public.app_state as restrictive for insert
  with check (not private.is_comercial() or key in ('s:PEDIDOS_COM', 's:PRESENCE', 's:PEOPLE'));

-- Avisos push: lo de antes (20261020120000) + Pedidos Comercial.
create or replace function private.chat_push_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n_new int; n_old int; s text; fresh jsonb; hoy text;
begin
  if new.key = 's:NOTIFS' then
    if tg_op <> 'UPDATE' or jsonb_typeof(new.data) <> 'array' then return new; end if;
    select coalesce(jsonb_agg(x.e), '[]'::jsonb) into fresh from (
      select e from jsonb_array_elements(new.data) e
      where ((e->>'type' in ('nuevo', 'pub', 'listo', 'fix', 'approved', 'nota') and coalesce(e->>'to', '') not in ('', 'admin'))
          or (e->>'type' in ('review', 'nota', 'sug', 'drive') and e->>'to' = 'admin'))
        and not coalesce((e->>'read')::boolean, false)
        and coalesce(e->>'date', '') >= to_char((now() at time zone 'America/Asuncion') - interval '1 day', 'YYYY-MM-DD')
        and concat_ws('|', e->>'id', e->>'to', e->>'type', e->>'job', e->>'post') not in (
          select concat_ws('|', o->>'id', o->>'to', o->>'type', o->>'job', o->>'post')
          from jsonb_array_elements(case when jsonb_typeof(old.data) = 'array' then old.data else '[]'::jsonb end) o)
      limit 20) x;
    if jsonb_array_length(fresh) = 0 then return new; end if;
    select secret into s from public.push_config where id = 1;
    perform net.http_post(
      url := private.chat_push_url(),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', s),
      body := jsonb_build_object('key', new.key, 'items', fresh)
    );
    return new;
  end if;
  if new.key = 's:AVISOS' then
    if tg_op <> 'UPDATE' or jsonb_typeof(new.data) <> 'array' then return new; end if;
    hoy := to_char(now() at time zone 'America/Asuncion', 'YYYY-MM-DD');
    select coalesce(jsonb_agg(x.e), '[]'::jsonb) into fresh from (
      select e from jsonb_array_elements(new.data) e
      where coalesce(e->>'from', '') <= hoy and coalesce(e->>'until', '') >= hoy
        and coalesce(e->>'id', '') not in (
          select coalesce(o->>'id', '')
          from jsonb_array_elements(case when jsonb_typeof(old.data) = 'array' then old.data else '[]'::jsonb end) o)
      limit 10) x;
    if jsonb_array_length(fresh) = 0 then return new; end if;
    select secret into s from public.push_config where id = 1;
    perform net.http_post(
      url := private.chat_push_url(),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', s),
      body := jsonb_build_object('key', new.key, 'items', fresh)
    );
    return new;
  end if;
  if new.key = 's:PEDIDOS_COM' then
    if jsonb_typeof(new.data) <> 'array' then return new; end if;
    select coalesce(jsonb_agg(x.e), '[]'::jsonb) into fresh from (
      select jsonb_build_object('id', e->>'id', 'by', e->>'by', 'byName', e->>'byName', 'title', e->>'title', 'brands', e->'brands', 'date', e->>'date',
               'ev', case when coalesce(e->>'st', '') = 'Publicado' then 'pub' else 'nuevo' end) e
      from jsonb_array_elements(new.data) e
      where (coalesce(e->>'st', '') = 'Enviado' and coalesce(e->>'id', '') not in (
              select coalesce(o->>'id', '') from jsonb_array_elements(case when tg_op = 'UPDATE' and jsonb_typeof(old.data) = 'array' then old.data else '[]'::jsonb end) o))
         or (coalesce(e->>'st', '') = 'Publicado' and coalesce(e->>'id', '') not in (
              select coalesce(o->>'id', '') from jsonb_array_elements(case when tg_op = 'UPDATE' and jsonb_typeof(old.data) = 'array' then old.data else '[]'::jsonb end) o
              where coalesce(o->>'st', '') = 'Publicado'))
      limit 10) x;
    if jsonb_array_length(fresh) = 0 then return new; end if;
    select secret into s from public.push_config where id = 1;
    perform net.http_post(
      url := private.chat_push_url(),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', s),
      body := jsonb_build_object('key', new.key, 'items', fresh)
    );
    return new;
  end if;
  if new.key not like 'thread:%' and new.key not like 'chat:%' then return new; end if;
  n_new := coalesce(jsonb_array_length(case when jsonb_typeof(new.data->'msgs') = 'array' then new.data->'msgs' end), 0);
  n_old := case when tg_op = 'UPDATE' then coalesce(jsonb_array_length(case when jsonb_typeof(old.data->'msgs') = 'array' then old.data->'msgs' end), 0) else 0 end;
  if n_new <= n_old then return new; end if;
  select secret into s from public.push_config where id = 1;
  perform net.http_post(
    url := private.chat_push_url(),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', s),
    body := jsonb_build_object('key', new.key, 'from', n_old)
  );
  return new;
exception when others then return new; -- un aviso que falla nunca frena el guardado
end $$;
revoke execute on function private.chat_push_notify() from public, anon, authenticated;
