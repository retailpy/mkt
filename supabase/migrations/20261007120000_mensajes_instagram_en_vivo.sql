-- Mensajes de Instagram en vivo: Meta avisa cada mensaje (webhook) a /api/webhook-meta, que lo guarda acá con
-- ingest_dm en s:META_DM = { updated, Marca: { <id del cliente>: { net:"IG", uid, who, ts, msgs:[ { mid, t, me, ts, att } ] } } }.
-- (La lista de conversaciones de Instagram que da Meta corta por tiempo en las cuentas con mucho movimiento.)
-- Cada mensaje se agrega en una sola operación con la fila bloqueada, así dos mensajes a la vez no se pisan.
create or replace function public.ingest_dm(p_secret text, p_brand text, p_conv text, p_info jsonb, p_msg jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v bigint; d jsonb; c jsonb; msgs jsonb;
begin
  if not exists (
    select 1 from private.ingest_keys
    where name = 'meta' and key_hash = encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex')
  ) then
    raise exception 'no autorizado';
  end if;
  if coalesce(p_brand, '') !~ '^[A-Za-z]{2,20}$' or coalesce(p_conv, '') !~ '^[0-9A-Za-z_-]{3,64}$'
     or jsonb_typeof(p_msg) <> 'object' or coalesce(p_msg->>'mid', '') = '' or coalesce(p_msg->>'ts', '') = '' then
    raise exception 'datos inválidos';
  end if;
  insert into public.app_state (key, data, updated_by) values ('s:META_DM', '{}'::jsonb, null) on conflict (key) do nothing;
  select data into d from public.app_state where key = 's:META_DM' for update;
  if jsonb_typeof(d) <> 'object' then d := '{}'::jsonb; end if;
  c := coalesce(d -> p_brand -> p_conv, '{}'::jsonb);
  msgs := coalesce(c -> 'msgs', '[]'::jsonb);
  if not exists (select 1 from jsonb_array_elements(msgs) m where m->>'mid' = p_msg->>'mid') then
    msgs := msgs || jsonb_build_array(p_msg);
  end if;
  -- Los últimos 30 mensajes de la conversación, en orden.
  select coalesce(jsonb_agg(x.m order by x.m->>'ts'), '[]'::jsonb) into msgs
  from (select m from jsonb_array_elements(msgs) m order by m->>'ts' desc limit 30) x;
  c := c || jsonb_strip_nulls(coalesce(p_info, '{}'::jsonb))
         || jsonb_build_object('msgs', msgs, 'ts', (select max(m->>'ts') from jsonb_array_elements(msgs) m));
  d := jsonb_set(d, array[p_brand], coalesce(d -> p_brand, '{}'::jsonb) || jsonb_build_object(p_conv, c));
  -- Conversaciones sin movimiento hace más de 62 días: afuera.
  d := jsonb_set(d, array[p_brand], (
    select coalesce(jsonb_object_agg(e.k, e.val), '{}'::jsonb) from jsonb_each(d -> p_brand) e(k, val)
    where coalesce(e.val->>'ts', '') >= to_char(now() - interval '62 days', 'YYYY-MM-DD')));
  d := d || jsonb_build_object('updated', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  update public.app_state set data = d, version = version + 1, updated_at = now(), updated_by = null
  where key = 's:META_DM' returning version into v;
  return v;
end $$;
revoke all on function public.ingest_dm(text, text, text, jsonb, jsonb) from public;
grant execute on function public.ingest_dm(text, text, text, jsonb, jsonb) to anon, authenticated;

-- La app no puede crear ni modificar esta clave.
create policy "app_state: mensajes de instagram solo lectura (crear)" on public.app_state
  as restrictive for insert to authenticated with check (key <> 's:META_DM');
create policy "app_state: mensajes de instagram solo lectura (modificar)" on public.app_state
  as restrictive for update to authenticated using (key <> 's:META_DM');

-- Quién los puede leer: Admin total, Admin y CM (igual que los demás mensajes de las cuentas).
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
    when p_key in ('s:META_INBOX', 's:RECLAMOS', 's:META_DM') then exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role in ('Admin total', 'Admin', 'CM'))
    else p_key like 's:%'
  end
$function$;
