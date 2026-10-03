-- Cualquier persona del equipo puede crear grupos de chat (nombre + integrantes).
-- Cada uno edita o borra solo los grupos que creó (owner); Admin total puede todos. Lo controla un trigger,
-- porque todos los grupos viven en la misma fila (s:CHAT_GROUPS).
-- También: el grupo "Equipo" pasa a llamarse "Team MKT".
create or replace function private.chat_groups_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me text; o jsonb; n jsonb;
begin
  if new.key <> 's:CHAT_GROUPS' or auth.uid() is null or private.is_admin_total() then return new; end if;
  me := private.my_person_id();
  if me is null or jsonb_typeof(new.data) <> 'array' then raise exception 'no autorizado'; end if;
  -- Los grupos que no son tuyos quedan exactamente igual.
  for o in select e from jsonb_array_elements(case when jsonb_typeof(old.data) = 'array' then old.data else '[]'::jsonb end) e loop
    if coalesce(o->>'owner', '') <> me then
      select e into n from jsonb_array_elements(new.data) e where e->>'id' = o->>'id' limit 1;
      if n is null or n <> o then raise exception 'Solo podés cambiar los grupos que creaste'; end if;
    end if;
  end loop;
  -- Un grupo nuevo es tuyo y te incluye.
  for n in select e from jsonb_array_elements(new.data) e loop
    if not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(old.data) = 'array' then old.data else '[]'::jsonb end) e where e->>'id' = n->>'id') then
      if n->>'owner' is distinct from me or not (coalesce(n->'members', '[]'::jsonb) ? me) then raise exception 'Grupo nuevo inválido'; end if;
    end if;
  end loop;
  return new;
end $$;
revoke execute on function private.chat_groups_guard() from public, anon, authenticated;
create trigger chat_groups_guard before update of data on public.app_state
  for each row execute function private.chat_groups_guard();

-- La regla anterior (solo Admin total modifica s:CHAT_GROUPS) queda reemplazada por el trigger.
alter policy "app_state: grupos de chat (modificar) solo admin total" on public.app_state
  using (true) with check (true);

update public.app_state set data = (
  select jsonb_agg(case when e->>'id' = 'equipo' and e->>'name' = 'Equipo' then jsonb_set(e, '{name}', '"Team MKT"') else e end order by ord)
  from jsonb_array_elements(data) with ordinality as t(e, ord)
), version = version + 1, updated_at = now()
where key = 's:CHAT_GROUPS' and jsonb_typeof(data) = 'array';
