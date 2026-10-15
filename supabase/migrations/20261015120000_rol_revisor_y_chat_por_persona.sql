-- Rol "Revisor" (para la revisión de Meta) y Chat Retail MKT por persona.
-- Revisor: solo lo que Meta tiene que revisar (Mensajes de las cuentas, Menciones y contestar). Sin chat, sin pedidos,
-- sin datos del equipo, sin material. Lee solo estas claves y escribe solo INBOX_DONE (marcar contestado) y PRESENCE.
-- Chat por persona: si en Usuarios y permisos se le apaga el chat a alguien (PEOPLE[].noChat), la base no le deja leer
-- ni escribir las charlas, aunque sea Admin total.

alter table public.members drop constraint members_role_check;
alter table public.members add constraint members_role_check check (role = any (array['Admin total', 'Admin', 'Diseñador', 'CM', 'Revisor']));

create or replace function private.is_revisor()
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select exists (select 1 from public.members where user_id = auth.uid() and active and role = 'Revisor')
$function$;

create or replace function private.no_chat()
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select private.is_revisor() or exists (
    select 1
    from public.app_state s
    cross join lateral jsonb_array_elements(case when jsonb_typeof(s.data) = 'array' then s.data else '[]'::jsonb end) e
    where s.key = 's:PEOPLE'
      and e->>'id' = private.my_person_id()
      and coalesce((e->>'noChat')::boolean, false)
  )
$function$;

create or replace function private.can_access_state(p_key text, p_data jsonb)
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select case
    when private.my_person_id() is null then false
    when private.is_revisor() then p_key in ('s:PEOPLE', 's:APP_FLAGS', 's:PRESENCE', 's:INBOX_DONE', 's:META_INBOX', 's:META_DM', 's:META_DM_LOG', 's:META_IG_ACT', 's:META_POSTS')
    when p_key like 'notes:%' or p_key like 'prompts:%' then split_part(p_key, ':', 2) = private.my_person_id()
    when p_key like 'thread:%' then not private.no_chat() and private.my_person_id() in (p_data->>'a', p_data->>'b')
    when p_key like 'chat:%' then not private.no_chat() and exists (
      select 1
      from public.app_state g
      cross join lateral jsonb_array_elements(case when jsonb_typeof(g.data) = 'array' then g.data else '[]'::jsonb end) e
      where g.key = 's:CHAT_GROUPS'
        and e->>'id' = substr(p_key, 6)
        and (
          coalesce((e->>'all')::boolean, false)
          or coalesce(e->'members', '[]'::jsonb) ? private.my_person_id()
          or exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and coalesce(e->'roles', '[]'::jsonb) ? m.role)
        )
    )
    when p_key in ('s:SUGGESTIONS', 's:SURVEYS') then private.is_admin_total()
    when p_key in ('s:META_INBOX', 's:RECLAMOS', 's:META_DM', 's:META_DM_LOG', 's:META_IG_ACT') then exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role in ('Admin total', 'Admin', 'CM'))
    else p_key like 's:%'
  end
$function$;

-- El Revisor solo puede guardar “contestado” y su presencia (restrictivas: se suman a las demás reglas).
drop policy if exists "app_state: revisor solo marca contestado (modificar)" on public.app_state;
create policy "app_state: revisor solo marca contestado (modificar)" on public.app_state as restrictive for update
  using (not private.is_revisor() or key in ('s:INBOX_DONE', 's:PRESENCE'))
  with check (not private.is_revisor() or key in ('s:INBOX_DONE', 's:PRESENCE'));
drop policy if exists "app_state: revisor solo marca contestado (crear)" on public.app_state;
create policy "app_state: revisor solo marca contestado (crear)" on public.app_state as restrictive for insert
  with check (not private.is_revisor() or key in ('s:INBOX_DONE', 's:PRESENCE'));

-- Material adjunto de los pedidos: el Revisor no lo ve ni sube.
drop policy if exists "material: el revisor no entra (ver)" on storage.objects;
create policy "material: el revisor no entra (ver)" on storage.objects as restrictive for select
  using (bucket_id <> 'material' or not private.is_revisor());
drop policy if exists "material: el revisor no entra (subir)" on storage.objects;
create policy "material: el revisor no entra (subir)" on storage.objects as restrictive for insert
  with check (bucket_id <> 'material' or not private.is_revisor());
