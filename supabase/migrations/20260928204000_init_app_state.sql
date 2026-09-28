-- Quién puede entrar: una fila por persona del equipo, ligada a su usuario de Supabase Auth.
create table public.members (
  person_id text primary key,
  email text not null unique,
  role text not null check (role in ('Admin total','Admin','Diseñador','CM')),
  active boolean not null default true,
  user_id uuid unique references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Datos de la app. Claves:
--   s:<colección>      compartido con todo el equipo
--   notes:<persona>    bloc de notas privado
--   prompts:<persona>  historial de prompts privado
--   thread:<id>        conversación privada entre data.a y data.b
create table public.app_state (
  key text primary key,
  data jsonb not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create function public.my_person_id() returns text
language sql stable security definer set search_path = '' as $$
  select person_id from public.members where user_id = auth.uid() and active
$$;

create function public.is_admin_total() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where user_id = auth.uid() and active and role = 'Admin total')
$$;

create function public.can_access_state(p_key text, p_data jsonb) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when public.my_person_id() is null then false
    when p_key like 'notes:%' or p_key like 'prompts:%' then split_part(p_key, ':', 2) = public.my_person_id()
    when p_key like 'thread:%' then public.my_person_id() in (p_data->>'a', p_data->>'b')
    else p_key like 's:%'
  end
$$;

alter table public.members enable row level security;
alter table public.app_state enable row level security;

create policy "members: cada uno ve su fila, Admin total ve todas" on public.members
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin_total()));

create policy "app_state: leer" on public.app_state
  for select to authenticated using (public.can_access_state(key, data));
create policy "app_state: crear" on public.app_state
  for insert to authenticated with check (public.can_access_state(key, data));
create policy "app_state: modificar" on public.app_state
  for update to authenticated using (public.can_access_state(key, data)) with check (public.can_access_state(key, data));

-- Guardado con control de versión: devuelve la versión nueva, o null si otro la cambió antes (conflicto).
create function public.save_state(p_key text, p_data jsonb, p_base bigint) returns bigint
language plpgsql security invoker set search_path = '' as $$
declare v bigint;
begin
  if coalesce(p_base, 0) = 0 then
    insert into public.app_state (key, data) values (p_key, p_data)
    on conflict (key) do nothing returning version into v;
  else
    update public.app_state set data = p_data, version = version + 1, updated_at = now(), updated_by = auth.uid()
    where key = p_key and version = p_base returning version into v;
  end if;
  return v;
end $$;

revoke execute on function public.save_state(text, jsonb, bigint) from public, anon;
grant execute on function public.save_state(text, jsonb, bigint) to authenticated;
revoke execute on function public.my_person_id(), public.is_admin_total(), public.can_access_state(text, jsonb) from public, anon;
grant execute on function public.my_person_id(), public.is_admin_total(), public.can_access_state(text, jsonb) to authenticated;
revoke all on public.members, public.app_state from anon;

alter publication supabase_realtime add table public.app_state;
