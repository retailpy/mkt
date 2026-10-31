-- v315 · "En vivo" liviano (menos egress de Supabase).
-- Antes, public.app_state estaba publicada en Realtime: cada cambio mandaba la fila ENTERA (hasta ~700 KB, por ejemplo
-- s:META_POSTS) a cada app abierta que la podía leer, y además la app la volvía a pedir. Era buena parte del egress.
-- Ahora una tabla chica, public.app_state_ver (solo clave y versión), se mantiene sola con un trigger y es la única que
-- se publica: la app recibe "cambió tal clave, versión N" y baja solo lo que necesita (o lo deja para cuando vuelva
-- alguien, si nadie la está usando). La app vieja (sin actualizar) sigue andando con su revisión cada 10 s.

create table if not exists public.app_state_ver (
  key text primary key,
  version bigint not null
);
alter table public.app_state_ver enable row level security;

-- Cada uno recibe el aviso solo de las claves que puede leer en app_state: la consulta de adentro pasa por las mismas
-- reglas (RLS) de app_state, incluida la de las charlas privadas y los grupos de chat.
drop policy if exists "app_state_ver: leer" on public.app_state_ver;
create policy "app_state_ver: leer" on public.app_state_ver for select to authenticated
  using (exists (select 1 from public.app_state s where s.key = app_state_ver.key));

revoke all on public.app_state_ver from anon;
revoke insert, update, delete, truncate on public.app_state_ver from authenticated;
grant select on public.app_state_ver to authenticated;

create or replace function private.app_state_ver_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('DELETE', 'UPDATE') and (tg_op = 'DELETE' or old.key is distinct from new.key) then
    delete from public.app_state_ver where key = old.key;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  insert into public.app_state_ver (key, version) values (new.key, new.version)
  on conflict (key) do update set version = excluded.version
    where public.app_state_ver.version is distinct from excluded.version;
  return new;
end $$;
revoke all on function private.app_state_ver_sync() from public, anon, authenticated;

drop trigger if exists app_state_ver_sync on public.app_state;
create trigger app_state_ver_sync after insert or update or delete on public.app_state
  for each row execute function private.app_state_ver_sync();

-- Lo que ya existe.
insert into public.app_state_ver (key, version)
select key, version from public.app_state
on conflict (key) do update set version = excluded.version;

-- Realtime: se publica la tabla chica y deja de publicarse la grande.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_state_ver') then
    alter publication supabase_realtime add table public.app_state_ver;
  end if;
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_state') then
    alter publication supabase_realtime drop table public.app_state;
  end if;
end $$;
