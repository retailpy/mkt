-- Publicaciones de Instagram de los supermercados de referencia (Pão de Açúcar, Whole Foods, Waitrose…): s:META_REFS.
-- Las trae la función /api/referentes con Business Discovery (solo cuentas públicas de empresa) y las guarda con INGEST_KEY.
-- La app solo las lee (Tendencias → Visuales de campañas).

create or replace function public.ingest_meta(p_key text, p_secret text, p_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  if p_key not in ('s:META_FOLLOWERS', 's:META_DEMO', 's:META_POSTS', 's:META_CREATIVES', 's:META_INBOX', 's:META_REFS') then
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

create policy "app_state: referentes de instagram solo lectura (crear)" on public.app_state
  as restrictive for insert to authenticated with check (key <> 's:META_REFS');
create policy "app_state: referentes de instagram solo lectura (modificar)" on public.app_state
  as restrictive for update to authenticated using (key <> 's:META_REFS');
