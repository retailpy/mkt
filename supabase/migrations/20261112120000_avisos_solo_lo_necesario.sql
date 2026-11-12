-- v355 · Menos egress: la función chat-push (notificaciones al celular) leía la lista entera de pedidos (s:jobs, ~415 KB)
-- y de publicaciones (s:posts, ~330 KB) en cada aviso para buscar uno solo (~140 veces por día). Con esta función lee
-- solo los elementos que necesita (por id). Solo la puede usar el servidor (service_role); la app no.
create or replace function public.state_items(p_key text, p_ids text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(e.v order by e.n), '[]'::jsonb)
  from public.app_state s,
       jsonb_array_elements(case when jsonb_typeof(s.data) = 'array' then s.data else '[]'::jsonb end) with ordinality as e(v, n)
  where s.key = p_key
    and p_key in ('s:jobs', 's:posts', 's:CHANNEL_POSTS', 's:SUGGESTIONS')
    and e.v ->> 'id' = any (p_ids);
$$;

revoke all on function public.state_items(text, text[]) from public;
revoke all on function public.state_items(text, text[]) from anon, authenticated;
grant execute on function public.state_items(text, text[]) to service_role;
