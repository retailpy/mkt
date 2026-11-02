-- v320 · Bajar solo lo que cambió (menos egress de Supabase).
-- En los registros del 2/11/2026 casi todo el egress eran colecciones que se bajaban enteras cada vez que alguien
-- cambiaba una sola cosa: s:posts (214 KB, 580 veces por día), s:jobs (269 KB, 169 veces) y s:NOTIFS (195 KB, 137 veces),
-- y las grandes de los servidores (s:META_POSTS, s:META_DM…). Ahora, en cada cambio, un trigger anota en
-- public.app_state_delta SOLO lo que cambió respecto de la versión anterior (unos KB), y la app, si tiene la versión
-- anterior, pide eso en vez de la fila entera. Si falta algún paso (o el cambio es casi todo), la app baja la fila entera
-- como antes: nada depende de que el anotado funcione, y un error del anotado nunca frena un guardado.
--
-- Qué se anota (columna d):
--   listas con id en cada elemento (s:posts, s:jobs, s:NOTIFS…; si un id se repite, la 2.ª vez es [id, 1]):
--     { t:"a", n: largo nuevo, ch: [elementos nuevos o cambiados], co: [en qué vez aparece su id, solo si se repite],
--       rm: [ids borrados],
--       pos:"tail"|"head" + add:[ids nuevos, en orden]  (si el orden es el de antes con lo nuevo al final o al principio)
--       ord:[todos los ids en orden]                     (si el orden cambió de otra forma) }
--   objetos (s:META_POSTS, s:COMERCIAL, s:META_DM…): { t:"o", n: cantidad de claves, ch: {clave: valor nuevo}, rm: [claves borradas] }

create table if not exists public.app_state_delta (
  key text not null,
  version bigint not null,
  d jsonb not null,
  created_at timestamptz not null default now(),
  primary key (key, version)
);
alter table public.app_state_delta enable row level security;

-- Cada uno lee solo los cambios de las claves que puede leer en app_state (las mismas reglas, como app_state_ver).
drop policy if exists "app_state_delta: leer" on public.app_state_delta;
create policy "app_state_delta: leer" on public.app_state_delta for select to authenticated
  using (exists (select 1 from public.app_state s where s.key = app_state_delta.key));

revoke all on public.app_state_delta from anon;
revoke insert, update, delete, truncate on public.app_state_delta from authenticated;
grant select on public.app_state_delta to authenticated;

create or replace function private.app_state_delta_make() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  d jsonb; ch jsonb; co jsonb; rm jsonb; nids jsonb; kept jsonb; added jsonb; full_len int;
begin
  -- Una clave que se borra o se vuelve a crear empieza de nuevo: sus anotados viejos ya no sirven.
  if tg_op = 'DELETE' then
    begin delete from public.app_state_delta where key = old.key; exception when others then null; end;
    return old;
  end if;
  if tg_op = 'INSERT' then
    begin delete from public.app_state_delta where key = new.key; exception when others then null; end;
    return new;
  end if;
  begin
    if new.key is distinct from old.key then
      delete from public.app_state_delta where key in (old.key, new.key);
      return new;
    end if;
    if new.version is distinct from old.version + 1 or new.data is null or old.data is null then return new; end if;
    full_len := octet_length(new.data::text);
    if full_len < 8000 then return new; end if; -- chica: no vale la pena

    if jsonb_typeof(old.data) = 'array' and jsonb_typeof(new.data) = 'array' then
      -- Todos los elementos son objetos con id (texto o número); si no, no se anota.
      if exists (select 1 from jsonb_array_elements(old.data) e where jsonb_typeof(e) <> 'object' or coalesce(jsonb_typeof(e->'id'), 'null') not in ('string', 'number'))
        or exists (select 1 from jsonb_array_elements(new.data) e where jsonb_typeof(e) <> 'object' or coalesce(jsonb_typeof(e->'id'), 'null') not in ('string', 'number')) then
        return new;
      end if;
      -- Cada elemento se reconoce por su id; si un id se repite (pasa en s:NOTIFS), la segunda vez es [id, 1], la tercera
      -- [id, 2]… (en el orden de la lista). La app arma la misma marca y así sabe a cuál corresponde cada cambio.
      with o as (select i, e, case when k = 0 then e->'id' else jsonb_build_array(e->'id', k) end as ident
                   from (select i, e, row_number() over (partition by e->'id' order by i) - 1 as k
                           from jsonb_array_elements(old.data) with ordinality x(e, i)) s),
           n as (select i, e, k, case when k = 0 then e->'id' else jsonb_build_array(e->'id', k) end as ident
                   from (select i, e, row_number() over (partition by e->'id' order by i) - 1 as k
                           from jsonb_array_elements(new.data) with ordinality x(e, i)) s)
      select
        (select coalesce(jsonb_agg(n.e order by n.i), '[]'::jsonb) from n left join o on o.ident = n.ident where o.ident is null or o.e <> n.e),
        (select coalesce(jsonb_agg(n.k order by n.i), '[]'::jsonb) from n left join o on o.ident = n.ident where o.ident is null or o.e <> n.e),
        (select coalesce(jsonb_agg(o.ident), '[]'::jsonb) from o where not exists (select 1 from n where n.ident = o.ident)),
        (select coalesce(jsonb_agg(o.ident order by o.i), '[]'::jsonb) from o where exists (select 1 from n where n.ident = o.ident)),
        (select coalesce(jsonb_agg(n.ident order by n.i), '[]'::jsonb) from n where not exists (select 1 from o where o.ident = n.ident)),
        (select coalesce(jsonb_agg(n.ident order by n.i), '[]'::jsonb) from n)
      into ch, co, rm, kept, added, nids;
      -- ch: nuevos o cambiados (el elemento entero, tal cual quedó); co: en qué vez aparece su id (solo si se repite)
      d := jsonb_build_object('t', 'a', 'n', jsonb_array_length(new.data), 'ch', ch, 'rm', rm);
      if exists (select 1 from jsonb_array_elements(co) c where c <> '0'::jsonb) then d := d || jsonb_build_object('co', co); end if;
      -- el orden: el de antes con lo nuevo al final o al principio; si no, la lista completa
      if nids = (kept || added) then d := d || jsonb_build_object('pos', 'tail', 'add', added);
      elsif nids = (added || kept) then d := d || jsonb_build_object('pos', 'head', 'add', added);
      else d := d || jsonb_build_object('ord', nids);
      end if;

    elsif jsonb_typeof(old.data) = 'object' and jsonb_typeof(new.data) = 'object' then
      select coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb) into ch
        from jsonb_each(new.data) n left join jsonb_each(old.data) o on o.key = n.key
        where o.key is null or o.value is distinct from n.value;
      select coalesce(jsonb_agg(o.key), '[]'::jsonb) into rm from jsonb_each(old.data) o where not (new.data ? o.key);
      d := jsonb_build_object('t', 'o', 'n', (select count(*) from jsonb_object_keys(new.data)), 'ch', ch, 'rm', rm);
    else
      return new;
    end if;

    -- Solo si el cambio es bastante más chico que la fila entera.
    if octet_length(d::text) * 2 > full_len then return new; end if;
    insert into public.app_state_delta (key, version, d) values (new.key, new.version, d)
      on conflict (key, version) do update set d = excluded.d, created_at = now();
    -- Se guardan los últimos 40 cambios de cada clave (más atrás, la app baja la fila entera).
    delete from public.app_state_delta where key = new.key and version <= new.version - 40;
  exception when others then
    -- Si algo falla al anotar, el guardado sigue igual (la app bajará la fila entera).
    return new;
  end;
  return new;
end $$;
revoke all on function private.app_state_delta_make() from public, anon, authenticated;

drop trigger if exists app_state_delta_make on public.app_state;
create trigger app_state_delta_make after insert or update or delete on public.app_state
  for each row execute function private.app_state_delta_make();
