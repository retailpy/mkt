-- Avisos push de todo (v228): además de los mensajes del chat y de los avisos de trabajo de antes, el trigger chat_push
-- manda a chat-push los avisos de s:NOTIFS “approved” (Admin total aprobó tu trabajo) y “nota” (comentario en un trabajo,
-- a la persona o a Admin total), “sug” (sugerencia nueva) y “drive” (falló una subida a Google Drive), y los Avisos del
-- equipo nuevos (s:AVISOS) que ya están vigentes hoy. Como antes: solo lo que apareció en ese guardado, sin leer, de hoy o
-- de ayer, como mucho 20 (y 10 avisos del equipo).
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

-- Resumen del día: todas las mañanas a las 7:45 de Paraguay (10:45 UTC; Paraguay está en UTC−3 todo el año) la base llama
-- a chat-push con {key: "daily"} y cada persona recibe un solo aviso con lo de hoy (si tiene algo).
create extension if not exists pg_cron;
create or replace function private.daily_push() returns void
language plpgsql security definer set search_path = '' as $$
declare s text;
begin
  select secret into s from public.push_config where id = 1;
  perform net.http_post(
    url := private.chat_push_url(),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', s),
    body := jsonb_build_object('key', 'daily')
  );
end $$;
revoke execute on function private.daily_push() from public, anon, authenticated;
select cron.schedule('rmh-resumen-del-dia', '45 10 * * *', 'select private.daily_push()');
