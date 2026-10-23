-- Pedidos Comercial · mensajes (v244).
-- Cada pedido de s:PEDIDOS_COM puede tener msgs[] (ida y vuelta entre Admin total y el comprador que lo cargó).
-- El aviso push: cuando un pedido tiene más mensajes que antes, se manda el último a chat-push (ev 'msg'):
-- si lo escribió el comprador, a Admin total; si no, al comprador.
-- Lo demás de chat_push_notify queda igual que en 20261023120000.

create or replace function private.chat_push_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n_new int; n_old int; s text; fresh jsonb; hoy text;
begin
  if new.key = 's:NOTIFS' then
    if tg_op <> 'UPDATE' or jsonb_typeof(new.data) <> 'array' then return new; end if;
    select coalesce(jsonb_agg(x.e), '[]'::jsonb) into fresh from (
      select e from jsonb_array_elements(new.data) e
      where ((e->>'type' in ('nuevo', 'pub', 'listo', 'fix', 'approved', 'nota') and coalesce(e->>'to', '') not in ('', 'admin'))
          or (e->>'type' in ('review', 'nota', 'sug', 'drive') and e->>'to' = 'admin'))
        and not coalesce((e->>'read')::boolean, false)
        and coalesce(e->>'date', '') >= to_char((now() at time zone 'America/Asuncion') - interval '1 day', 'YYYY-MM-DD')
        and concat_ws('|', e->>'id', e->>'to', e->>'type', e->>'job', e->>'post') not in (
          select concat_ws('|', o->>'id', o->>'to', o->>'type', o->>'job', o->>'post')
          from jsonb_array_elements(case when jsonb_typeof(old.data) = 'array' then old.data else '[]'::jsonb end) o)
      limit 20) x;
    if jsonb_array_length(fresh) = 0 then return new; end if;
    select secret into s from public.push_config where id = 1;
    perform net.http_post(
      url := private.chat_push_url(),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', s),
      body := jsonb_build_object('key', new.key, 'items', fresh)
    );
    return new;
  end if;
  if new.key = 's:AVISOS' then
    if tg_op <> 'UPDATE' or jsonb_typeof(new.data) <> 'array' then return new; end if;
    hoy := to_char(now() at time zone 'America/Asuncion', 'YYYY-MM-DD');
    select coalesce(jsonb_agg(x.e), '[]'::jsonb) into fresh from (
      select e from jsonb_array_elements(new.data) e
      where coalesce(e->>'from', '') <= hoy and coalesce(e->>'until', '') >= hoy
        and coalesce(e->>'id', '') not in (
          select coalesce(o->>'id', '')
          from jsonb_array_elements(case when jsonb_typeof(old.data) = 'array' then old.data else '[]'::jsonb end) o)
      limit 10) x;
    if jsonb_array_length(fresh) = 0 then return new; end if;
    select secret into s from public.push_config where id = 1;
    perform net.http_post(
      url := private.chat_push_url(),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', s),
      body := jsonb_build_object('key', new.key, 'items', fresh)
    );
    return new;
  end if;
  if new.key = 's:PEDIDOS_COM' then
    if jsonb_typeof(new.data) <> 'array' then return new; end if;
    select coalesce(jsonb_agg(x.e), '[]'::jsonb) into fresh from ((
      select jsonb_build_object('id', e->>'id', 'by', e->>'by', 'byName', e->>'byName', 'title', e->>'title', 'brands', e->'brands', 'date', e->>'date',
               'ev', case when coalesce(e->>'st', '') = 'Publicado' then 'pub' else 'nuevo' end) e
      from jsonb_array_elements(new.data) e
      where (coalesce(e->>'st', '') = 'Enviado' and coalesce(e->>'id', '') not in (
              select coalesce(o->>'id', '') from jsonb_array_elements(case when tg_op = 'UPDATE' and jsonb_typeof(old.data) = 'array' then old.data else '[]'::jsonb end) o))
         or (coalesce(e->>'st', '') = 'Publicado' and coalesce(e->>'id', '') not in (
              select coalesce(o->>'id', '') from jsonb_array_elements(case when tg_op = 'UPDATE' and jsonb_typeof(old.data) = 'array' then old.data else '[]'::jsonb end) o
              where coalesce(o->>'st', '') = 'Publicado'))
      limit 10)
      union all
      (select jsonb_build_object('id', e->>'id', 'by', e->>'by', 'byName', e->>'byName', 'title', e->>'title', 'ev', 'msg', 'm', e->'msgs'->-1) e
      from jsonb_array_elements(new.data) e
      where jsonb_typeof(e->'msgs') = 'array' and jsonb_array_length(e->'msgs') > coalesce((
        select max(jsonb_array_length(o->'msgs'))
        from jsonb_array_elements(case when tg_op = 'UPDATE' and jsonb_typeof(old.data) = 'array' then old.data else '[]'::jsonb end) o
        where o->>'id' = e->>'id' and jsonb_typeof(o->'msgs') = 'array'), 0)
      limit 10)) x;
    if jsonb_array_length(fresh) = 0 then return new; end if;
    select secret into s from public.push_config where id = 1;
    perform net.http_post(
      url := private.chat_push_url(),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', s),
      body := jsonb_build_object('key', new.key, 'items', fresh)
    );
    return new;
  end if;
  if new.key not like 'thread:%' and new.key not like 'chat:%' then return new; end if;
  n_new := coalesce(jsonb_array_length(case when jsonb_typeof(new.data->'msgs') = 'array' then new.data->'msgs' end), 0);
  n_old := case when tg_op = 'UPDATE' then coalesce(jsonb_array_length(case when jsonb_typeof(old.data->'msgs') = 'array' then old.data->'msgs' end), 0) else 0 end;
  if n_new <= n_old then return new; end if;
  select secret into s from public.push_config where id = 1;
  perform net.http_post(
    url := private.chat_push_url(),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', s),
    body := jsonb_build_object('key', new.key, 'from', n_old)
  );
  return new;
exception when others then return new; -- un aviso que falla nunca frena el guardado
end $$;
revoke execute on function private.chat_push_notify() from public, anon, authenticated;
