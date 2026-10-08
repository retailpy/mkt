-- Comentarios, comentarios en vivo, etiquetas y menciones de Instagram de cada marca. Los escriben el webhook de Meta
-- (/api/webhook-meta, al momento) y la lectura programada (/api/interacciones, dos veces por día y con "Actualizar").
-- s:META_IG_ACT = { "Superseis": { handle, pulled, live, err, diag, posts:{ <id>: { link, cap, img } },
--                                  items:[ { id, kind, who, t, ts, m, media, answered, … } ] }, updated }
-- kind: comment (en una publicación de la marca) · live (en un vivo) · mention (@marca en un comentario o publicación)
--       · tag (etiquetaron a la marca en una foto) · story (mencionaron a la marca en su historia).
-- Se suman por id sin borrar lo anterior (un ítem con "upd": true solo cambia uno que ya está, por ejemplo answered).
-- "posts" (las publicaciones donde están los comentarios, por id "m") se suman y quedan solo las que usa algún ítem.
-- Quedan los últimos 35 días y hasta 250 por marca (la fila se descarga entera en cada cambio: tiene que ser liviana).
create or replace function public.ingest_ig_act(p_secret text, p_brand text, p_items jsonb, p_info jsonb default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v bigint; d jsonb; b jsonb; items jsonb; posts jsonb; it jsonb; cur jsonb;
begin
  if not exists (
    select 1 from private.ingest_keys
    where name = 'meta' and key_hash = encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex')
  ) then
    raise exception 'no autorizado';
  end if;
  if coalesce(p_brand, '') !~ '^[A-Za-z]{2,20}$' or jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 500 or length(coalesce(p_items, '[]'::jsonb)::text) > 600000
     or (p_info is not null and (jsonb_typeof(p_info) <> 'object' or length(p_info::text) > 20000)) then
    raise exception 'datos inválidos';
  end if;
  insert into public.app_state (key, data, updated_by) values ('s:META_IG_ACT', '{}'::jsonb, null) on conflict (key) do nothing;
  select data into d from public.app_state where key = 's:META_IG_ACT' for update;
  if jsonb_typeof(d) <> 'object' then d := '{}'::jsonb; end if;
  b := coalesce(d -> p_brand, '{}'::jsonb);
  if jsonb_typeof(b) <> 'object' then b := '{}'::jsonb; end if;
  select coalesce(jsonb_object_agg(e->>'id', e), '{}'::jsonb) into items
  from jsonb_array_elements(case when jsonb_typeof(b->'items') = 'array' then b->'items' else '[]'::jsonb end) e
  where jsonb_typeof(e) = 'object' and coalesce(e->>'id', '') <> '';
  for it in select x from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x loop
    if jsonb_typeof(it) <> 'object' or coalesce(it->>'id', '') !~ '^[0-9A-Za-z_:.-]{2,120}$' then continue; end if;
    cur := items -> (it->>'id');
    if cur is null then
      if coalesce(it->>'upd', '') = 'true' or coalesce(it->>'ts', '') = ''
         or coalesce(it->>'kind', '') not in ('comment', 'live', 'mention', 'tag', 'story') then continue; end if;
      items := items || jsonb_build_object(it->>'id', it - 'upd');
    else
      items := items || jsonb_build_object(it->>'id', cur || jsonb_strip_nulls(it - 'upd'));
    end if;
  end loop;
  select coalesce(jsonb_agg(x.e order by x.e->>'ts' desc), '[]'::jsonb) into items from (
    select e from jsonb_each(items) t(k, e)
    where coalesce(e->>'ts', '') >= to_char(now() - interval '35 days', 'YYYY-MM-DD')
    order by e->>'ts' desc limit 250) x;
  select coalesce(jsonb_object_agg(p.k, p.val), '{}'::jsonb) into posts
  from jsonb_each(case when jsonb_typeof(b->'posts') = 'object' then b->'posts' else '{}'::jsonb end
                  || case when jsonb_typeof(p_info->'posts') = 'object' then p_info->'posts' else '{}'::jsonb end) p(k, val)
  where p.k in (select e->>'m' from jsonb_array_elements(items) e where e->>'m' is not null);
  b := b || (coalesce(p_info, '{}'::jsonb) - 'posts') || jsonb_build_object('items', items, 'posts', posts);
  d := d || jsonb_build_object(p_brand, b, 'updated', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  update public.app_state set data = d, version = version + 1, updated_at = now(), updated_by = null
  where key = 's:META_IG_ACT' returning version into v;
  return v;
end $$;
revoke all on function public.ingest_ig_act(text, text, jsonb, jsonb) from public;
grant execute on function public.ingest_ig_act(text, text, jsonb, jsonb) to anon, authenticated;

create policy "app_state: comentarios de instagram solo lectura (crear)" on public.app_state
  as restrictive for insert to authenticated with check (key <> 's:META_IG_ACT');
create policy "app_state: comentarios de instagram solo lectura (modificar)" on public.app_state
  as restrictive for update to authenticated using (key <> 's:META_IG_ACT');

-- Los ven las mismas personas que los mensajes de las cuentas (Admin total, Admin y CM).
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
    when p_key in ('s:META_INBOX', 's:RECLAMOS', 's:META_DM', 's:META_DM_LOG', 's:META_IG_ACT') then exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role in ('Admin total', 'Admin', 'CM'))
    else p_key like 's:%'
  end
$function$;
