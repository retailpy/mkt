-- Chat: los mensajes de cada grupo van en app_state con clave chat:<id_grupo> y solo los leen/escriben sus integrantes.
-- Integrante = el grupo es para todos (all), o la persona está en members, o su rol está en roles (definido en s:CHAT_GROUPS).
-- Encuestas y sugerencias: solo Admin total.
create or replace function private.can_access_state(p_key text, p_data jsonb)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select case
    when private.my_person_id() is null then false
    when p_key like 'notes:%' or p_key like 'prompts:%' then split_part(p_key, ':', 2) = private.my_person_id()
    when p_key like 'thread:%' then private.my_person_id() in (p_data->>'a', p_data->>'b')
    when p_key like 'chat:%' then exists (
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
    else p_key like 's:%'
  end
$function$;

-- Los grupos (nombre, imagen, integrantes, archivar) solo los administra Admin total.
create policy "app_state: grupos de chat (crear) solo admin total" on public.app_state
  as restrictive for insert to authenticated
  with check (key <> 's:CHAT_GROUPS' or private.is_admin_total());
create policy "app_state: grupos de chat (modificar) solo admin total" on public.app_state
  as restrictive for update to authenticated
  using (key <> 's:CHAT_GROUPS' or private.is_admin_total())
  with check (key <> 's:CHAT_GROUPS' or private.is_admin_total());

-- Los cuatro grupos iniciales (se pueden editar, archivar o sumar otros desde la app).
insert into public.app_state (key, data) values ('s:CHAT_GROUPS', '[
  {"id":"cm","name":"Community Managers","icon":"📣","color":"#a855f7","roles":["CM","Admin total","Admin"],"members":[],"all":false,"archived":false},
  {"id":"diseno","name":"Diseño Gráfico","icon":"🎨","color":"#06b6d4","roles":["Diseñador","Admin total","Admin"],"members":[],"all":false,"archived":false},
  {"id":"equipo","name":"Equipo","icon":"👥","color":"#10b981","roles":[],"members":[],"all":true,"archived":false},
  {"id":"marketing","name":"Marketing General","icon":"📢","color":"#f59e0b","roles":[],"members":[],"all":true,"archived":false}
]'::jsonb) on conflict (key) do nothing;
