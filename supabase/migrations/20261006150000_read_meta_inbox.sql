-- La función de Mensajes (Vercel) también lee lo que guardó la vez anterior: si Meta tarda y una red no se llega
-- a leer, quedan esas conversaciones en vez de perderse. Misma clave que para guardar; solo s:META_POSTS y s:META_INBOX.
create or replace function public.read_meta(p_key text, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if p_key not in ('s:META_POSTS', 's:META_INBOX') then
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
