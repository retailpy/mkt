-- Registro de los avisos de Meta al webhook de Instagram (sin el texto de los mensajes): cuándo llegó, si la firma
-- estaba bien, de qué cuenta venía y qué pasó. Sirve para ver dónde se corta si los mensajes no aparecen.
-- s:META_DM_LOG = { events: [ { at, kind, ... } ] } (los últimos 40).
create or replace function public.log_dm(p_secret text, p_ev jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare d jsonb; ev jsonb;
begin
  if not exists (
    select 1 from private.ingest_keys
    where name = 'meta' and key_hash = encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex')
  ) then
    raise exception 'no autorizado';
  end if;
  if jsonb_typeof(p_ev) <> 'object' or length(p_ev::text) > 4000 then raise exception 'datos inválidos'; end if;
  insert into public.app_state (key, data, updated_by) values ('s:META_DM_LOG', '{"events":[]}'::jsonb, null) on conflict (key) do nothing;
  select data into d from public.app_state where key = 's:META_DM_LOG' for update;
  ev := p_ev || jsonb_build_object('at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  select coalesce(jsonb_agg(x.e order by x.n), '[]'::jsonb) into d from (
    select e, n from jsonb_array_elements(jsonb_build_array(ev) || coalesce(d->'events', '[]'::jsonb)) with ordinality t(e, n) order by n limit 40) x;
  update public.app_state set data = jsonb_build_object('events', d), version = version + 1, updated_at = now(), updated_by = null
  where key = 's:META_DM_LOG';
end $$;
revoke all on function public.log_dm(text, jsonb) from public;
grant execute on function public.log_dm(text, jsonb) to anon, authenticated;

create policy "app_state: registro de instagram solo lectura (crear)" on public.app_state
  as restrictive for insert to authenticated with check (key <> 's:META_DM_LOG');
create policy "app_state: registro de instagram solo lectura (modificar)" on public.app_state
  as restrictive for update to authenticated using (key <> 's:META_DM_LOG');

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
    when p_key in ('s:META_INBOX', 's:RECLAMOS', 's:META_DM', 's:META_DM_LOG') then exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role in ('Admin total', 'Admin', 'CM'))
    else p_key like 's:%'
  end
$function$;
