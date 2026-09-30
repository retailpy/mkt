-- Carga automática de datos de Meta (seguidores y demográficos) desde las funciones de Vercel.
-- Las funciones usan la clave publicable (rol anon), que no puede tocar app_state.
-- Por eso escriben solo a través de ingest_meta(), que:
--   · exige la clave INGEST_KEY de Vercel (acá se guarda solo su hash sha256),
--   · acepta únicamente las claves s:META_FOLLOWERS y s:META_DEMO,
--   · combina el objeto nuevo con el que ya estaba (nivel superior), así no se pierden meses anteriores.

create extension if not exists pgcrypto with schema extensions;

create table if not exists private.ingest_keys (
  name text primary key,
  key_hash text not null,
  created_at timestamptz not null default now()
);
revoke all on private.ingest_keys from public, anon, authenticated;

create or replace function public.ingest_meta(p_key text, p_secret text, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  if p_key not in ('s:META_FOLLOWERS', 's:META_DEMO') then
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

revoke execute on function public.ingest_meta(text, text, jsonb) from public;
grant execute on function public.ingest_meta(text, text, jsonb) to anon, authenticated;
