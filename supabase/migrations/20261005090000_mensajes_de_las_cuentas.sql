-- Mensajes directos reales de las cuentas (Instagram y Facebook/Messenger de cada marca): s:META_INBOX.
-- Los escribe la función /api/mensajes (con INGEST_KEY); la app solo los lee, y solo Admin total, Admin y CM.

create or replace function public.ingest_meta(p_key text, p_secret text, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  if p_key not in ('s:META_FOLLOWERS', 's:META_DEMO', 's:META_POSTS', 's:META_CREATIVES', 's:META_INBOX') then
    raise exception 'clave no permitida';
  end if;
  if jsonb_typeof(p_data) <> 'object' then
    raise exception 'datos inválidos';
  end if;
  if not exists (
    select 1 from private.ingest_keys
    where name = 'meta' and key_hash = encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex')
  ) then
    raise exception 'no autorizado';
  end if;

  insert into public.app_state as s (key, data, updated_by) values (p_key, p_data, null)
  on conflict (key) do update
    set data = s.data || excluded.data, version = s.version + 1, updated_at = now(), updated_by = null
  returning s.version into v;
  return v;
end $$;

-- La app no puede crear ni modificar esta clave (además de las políticas que ya protegen a las otras de Meta).
create policy "app_state: mensajes de las cuentas solo lectura (crear)" on public.app_state
  as restrictive for insert to authenticated with check (key <> 's:META_INBOX');
create policy "app_state: mensajes de las cuentas solo lectura (modificar)" on public.app_state
  as restrictive for update to authenticated using (key <> 's:META_INBOX');

-- Quién puede leer los mensajes de las cuentas: Admin total, Admin y CM.
create or replace function private.can_access_state(p_key text, p_data jsonb)
 returns boolean language sql stable security definer set search_path to '' as $function$
  select case
    when private.my_person_id() is null then false
    when p_key like 'notes:%' or p_key like 'prompts:%' then split_part(p_key, ':', 2) = private.my_person_id()
    when p_key like 'thread:%' then private.my_person_id() in (p_data->>'a', p_data->>'b')
    when p_key like 'chat:%' then exists (
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
    when p_key = 's:META_INBOX' then exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role in ('Admin total', 'Admin', 'CM'))
    else p_key like 's:%'
  end
$function$;
