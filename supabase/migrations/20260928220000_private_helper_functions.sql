-- Las funciones auxiliares de las reglas de acceso no necesitan estar en la API: van a un esquema privado.
create schema if not exists private;
grant usage on schema private to authenticated;
alter function public.my_person_id() set schema private;
alter function public.is_admin_total() set schema private;
alter function public.can_access_state(text, jsonb) set schema private;
create or replace function private.can_access_state(p_key text, p_data jsonb) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when private.my_person_id() is null then false
    when p_key like 'notes:%' or p_key like 'prompts:%' then split_part(p_key, ':', 2) = private.my_person_id()
    when p_key like 'thread:%' then private.my_person_id() in (p_data->>'a', p_data->>'b')
    else p_key like 's:%'
  end
$$;
