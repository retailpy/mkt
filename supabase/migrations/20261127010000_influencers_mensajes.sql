-- v435 · Influencers: la búsqueda de Instagram (/api/referentes?set=influ) lee también los mensajes de Instagram (s:META_DM)
-- para reconocer los reels y publicaciones que los influencers le mandan a la marca por mensaje (el webhook guarda el número
-- del reel o el link). Solo se agrega 's:META_DM' a la lista de read_meta; lo demás queda igual.
create or replace function public.read_meta(p_key text, p_secret text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
begin
  if p_key not in ('s:META_POSTS', 's:META_INBOX', 's:META_STORIES', 's:META_INFLU', 's:INFLU_PLAN', 's:INFLU_MARKS', 's:META_DM') then
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
