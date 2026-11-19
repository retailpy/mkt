-- v362 · Historias de Instagram (s:META_STORIES), que guarda la función de Vercel api/historias.js varias veces por día.
-- ingest_meta y read_meta aceptan la clave nueva. Solo en esta clave, una clave del objeto que llega con null se BORRA
-- (así se sacan las historias viejas sin reescribir toda la fila); en las demás claves todo sigue igual que antes.
-- La app la lee con las reglas de siempre (private.can_access_state: cualquier clave s:% para el equipo).
create or replace function public.ingest_meta(p_key text, p_secret text, p_data jsonb)
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v bigint; drop_keys text[] := '{}';
begin
  if p_key not in ('s:META_FOLLOWERS', 's:META_DEMO', 's:META_POSTS', 's:META_CREATIVES', 's:META_INBOX', 's:META_REFS', 's:META_STORIES') then
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
  if p_key = 's:META_STORIES' then
    select coalesce(array_agg(k), '{}') into drop_keys from jsonb_each(p_data) as e(k, val) where jsonb_typeof(val) = 'null';
    p_data := p_data - drop_keys;
  end if;

  insert into public.app_state as s (key, data, updated_by) values (p_key, p_data, null)
  on conflict (key) do update
    set data = (s.data || excluded.data) - drop_keys, version = s.version + 1, updated_at = now(), updated_by = null
  returning s.version into v;
  return v;
end $function$;

create or replace function public.read_meta(p_key text, p_secret text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if p_key not in ('s:META_POSTS', 's:META_INBOX', 's:META_STORIES') then
    raise exception 'clave no permitida';
  end if;
  if not exists (
    select 1 from private.ingest_keys
    where name = 'meta' and key_hash = encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex')
  ) then
    raise exception 'no autorizado';
  end if;
  return (select data from public.app_state where key = p_key);
end $function$;
