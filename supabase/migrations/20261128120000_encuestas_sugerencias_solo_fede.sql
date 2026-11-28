-- v451 · Encuestas y Sugerencias (s:SURVEYS, s:SUGGESTIONS): solo Fede (antes, cualquier Admin total). s:DRAFTS sigue para Admin total.
-- Parte de la función que estaba en la base (28/11/2026); solo cambia esa línea.
CREATE OR REPLACE FUNCTION private.can_access_state(p_key text, p_data jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when private.my_person_id() is null then false
    when private.is_revisor() then p_key in ('s:PEOPLE', 's:APP_FLAGS', 's:PRESENCE', 's:INBOX_DONE', 's:META_INBOX', 's:META_DM', 's:META_DM_LOG', 's:META_IG_ACT', 's:META_POSTS')
    when private.is_comercial() then p_key in ('s:PEOPLE', 's:APP_FLAGS', 's:PRESENCE', 's:PEDIDOS_COM', 's:COMERCIAL', 's:META_FOLLOWERS', 's:META_DEMO', 's:META_POSTS', 's:CAMP_FOLDERS', 's:APP_VIDEO')
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
    when p_key in ('s:SUGGESTIONS', 's:SURVEYS') then private.is_admin_total() and private.my_person_id() = 'fede'
    when p_key = 's:DRAFTS' then private.is_admin_total()
    when p_key = 's:INFLUENCERS' then exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role in ('Admin total', 'CM'))
    when p_key in ('s:META_INBOX', 's:RECLAMOS', 's:ESCRACHES', 's:META_DM', 's:META_DM_LOG', 's:META_IG_ACT') then exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role in ('Admin total', 'Admin', 'CM'))
    when p_key in ('s:AGENTS', 's:AGENT_CHAT', 's:CRONOGRAMA', 's:RESUMEN_EJEC') then exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role in ('Admin total', 'Admin'))
    when p_key = 's:SEGUIMIENTO' then private.is_admin_total() or (
      exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role = 'Admin')
      and exists (
        select 1 from public.app_state a
        where a.key = 's:SEG_ACCESS' and jsonb_typeof(a.data) = 'array' and a.data ? private.my_person_id()
      )
    )
    when p_key in ('s:ADM_JOBS', 's:ADM_EVENTS', 's:ADM_FOTOS') then exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role in ('Admin total', 'Admin', 'Administración'))
    else p_key like 's:%'
  end
$function$;
