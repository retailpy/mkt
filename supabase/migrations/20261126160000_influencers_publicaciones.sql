-- v428 · Influencers (Community Manager): lo que cada influencer tiene que subir por mes y si lo subió.
--   s:INFLU_PLAN   la lista de influencers con sus redes y lo que suben por mes (la carga la app; Admin total la edita)
--   s:INFLU_MARKS  lo que se marcó a mano (subido, link, vistas) y lo que Admin total verificó (la carga la app)
--   s:META_INFLU   las publicaciones de Instagram de cada influencer que nombran a una marca, con me gusta y comentarios.
--                  La escribe solo /api/referentes?set=influ (Business Discovery) con ingest_meta: para la app es de solo lectura.
-- La función de Vercel lee las tres con read_meta (la lista de usuarios de Instagram, los links cargados a mano y lo que ya
-- guardó). En s:META_INFLU, como en s:META_STORIES, una clave en null se borra (los meses viejos). Lo demás queda igual.

create or replace function public.ingest_meta(p_key text, p_secret text, p_data jsonb)
 returns bigint language plpgsql security definer set search_path to ''
as $function$
declare v bigint; drop_keys text[] := '{}';
begin
  if p_key not in ('s:META_FOLLOWERS', 's:META_DEMO', 's:META_POSTS', 's:META_CREATIVES', 's:META_INBOX', 's:META_REFS', 's:META_STORIES', 's:META_INFLU') then
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
  if p_key in ('s:META_STORIES', 's:META_INFLU') then
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
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
begin
  if p_key not in ('s:META_POSTS', 's:META_INBOX', 's:META_STORIES', 's:META_INFLU', 's:INFLU_PLAN', 's:INFLU_MARKS') then
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

alter policy "app_state: datos de meta solo lectura (crear)" on public.app_state
  with check (key <> all (array['s:META_FOLLOWERS', 's:META_DEMO', 's:META_POSTS', 's:META_CREATIVES', 's:META_STORIES', 's:META_INFLU']));
alter policy "app_state: datos de meta solo lectura (modificar)" on public.app_state
  using (key <> all (array['s:META_FOLLOWERS', 's:META_DEMO', 's:META_POSTS', 's:META_CREATIVES', 's:META_STORIES', 's:META_INFLU']));
