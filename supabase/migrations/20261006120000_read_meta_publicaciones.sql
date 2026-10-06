-- Solo lectura para las funciones de Meta (Vercel): leen lo que ya guardaron (ej.: el archivo mensual de publicaciones)
-- con la misma clave que usan para guardar. Solo s:META_POSTS.
create or replace function public.read_meta(p_key text, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if p_key not in ('s:META_POSTS') then
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
