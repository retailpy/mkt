-- v326 · Oficina de Agentes y Cronograma de Acciones: solo Admin total y Admin.
--   s:AGENTS      entrenamiento, skills y correcciones de los agentes (SofIA, MatIAs, ClaudIA)
--   s:AGENT_CHAT  las charlas con los agentes
--   s:CRONOGRAMA  el cronograma de comunicación de acciones (medios y fechas de cada acción)
-- Las leen y guardan solo Admin total y Admin (activos); el resto del equipo ni las baja.
-- Además, el cronograma lo cambia solo Admin total (Admin lo mira).
-- La función es la misma de 20261030120000_checks_comercial_por_persona.sql con una línea más.

create or replace function private.can_access_state(p_key text, p_data jsonb)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select case
    when private.my_person_id() is null then false
    when private.is_revisor() then p_key in ('s:PEOPLE', 's:APP_FLAGS', 's:PRESENCE', 's:INBOX_DONE', 's:META_INBOX', 's:META_DM', 's:META_DM_LOG', 's:META_IG_ACT', 's:META_POSTS')
    when private.is_comercial() then p_key in ('s:PEOPLE', 's:APP_FLAGS', 's:PRESENCE', 's:PEDIDOS_COM', 's:COMERCIAL', 's:META_FOLLOWERS', 's:META_DEMO', 's:META_POSTS')
    when p_key like 'notes:%' or p_key like 'prompts:%' or p_key like 'comchk:%' then split_part(p_key, ':', 2) = private.my_person_id()
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
    when p_key = 's:INFLUENCERS' then exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role in ('Admin total', 'CM'))
    when p_key in ('s:META_INBOX', 's:RECLAMOS', 's:ESCRACHES', 's:META_DM', 's:META_DM_LOG', 's:META_IG_ACT') then exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role in ('Admin total', 'Admin', 'CM'))
    when p_key in ('s:AGENTS', 's:AGENT_CHAT', 's:CRONOGRAMA') then exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role in ('Admin total', 'Admin'))
    else p_key like 's:%'
  end
$function$;

drop policy if exists "app_state: cronograma solo admin total (modificar)" on public.app_state;
create policy "app_state: cronograma solo admin total (modificar)" on public.app_state as restrictive for update
  using (key <> 's:CRONOGRAMA' or private.is_admin_total())
  with check (key <> 's:CRONOGRAMA' or private.is_admin_total());
drop policy if exists "app_state: cronograma solo admin total (crear)" on public.app_state;
create policy "app_state: cronograma solo admin total (crear)" on public.app_state as restrictive for insert
  with check (key <> 's:CRONOGRAMA' or private.is_admin_total());
