-- Rol TV (v266): el usuario de los televisores de la oficina (TV 1 a TV 4).
-- En la app solo ve los botones TV 1 a TV 4 y la Vista TV que Admin total eligió para cada uno (s:TV_SCREENS).
-- La base le deja leer lo compartido del equipo (s:…) como a cualquiera (las Vistas TV lo necesitan), pero sin chat
-- (ni grupos ni conversaciones) y guardar solo su presencia y su perfil.
-- s:TV_SCREENS (qué muestra cada televisor): la lee todo el equipo y la cambia solo Admin total.

alter table public.members drop constraint members_role_check;
alter table public.members add constraint members_role_check check (role = any (array['Admin total', 'Admin', 'Diseñador', 'CM', 'Revisor', 'Comercial', 'TV']));

create or replace function private.is_tv()
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select exists (select 1 from public.members where user_id = auth.uid() and active and role = 'TV')
$function$;

create or replace function private.no_chat()
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select private.is_revisor() or private.is_comercial() or private.is_tv() or exists (
    select 1
    from public.app_state s
    cross join lateral jsonb_array_elements(case when jsonb_typeof(s.data) = 'array' then s.data else '[]'::jsonb end) e
    where s.key = 's:PEOPLE'
      and e->>'id' = private.my_person_id()
      and coalesce((e->>'noChat')::boolean, false)
  )
$function$;

-- TV solo guarda su presencia y su perfil (restrictivas: se suman a las demás reglas).
drop policy if exists "app_state: tv solo su presencia (modificar)" on public.app_state;
create policy "app_state: tv solo su presencia (modificar)" on public.app_state as restrictive for update
  using (not private.is_tv() or key in ('s:PRESENCE', 's:PEOPLE'))
  with check (not private.is_tv() or key in ('s:PRESENCE', 's:PEOPLE'));
drop policy if exists "app_state: tv solo su presencia (crear)" on public.app_state;
create policy "app_state: tv solo su presencia (crear)" on public.app_state as restrictive for insert
  with check (not private.is_tv() or key in ('s:PRESENCE', 's:PEOPLE'));

-- Pantallas TV: solo Admin total la crea o la cambia.
drop policy if exists "app_state: pantallas tv solo admin total (modificar)" on public.app_state;
create policy "app_state: pantallas tv solo admin total (modificar)" on public.app_state as restrictive for update
  using (key <> 's:TV_SCREENS' or private.is_admin_total())
  with check (key <> 's:TV_SCREENS' or private.is_admin_total());
drop policy if exists "app_state: pantallas tv solo admin total (crear)" on public.app_state;
create policy "app_state: pantallas tv solo admin total (crear)" on public.app_state as restrictive for insert
  with check (key <> 's:TV_SCREENS' or private.is_admin_total());
