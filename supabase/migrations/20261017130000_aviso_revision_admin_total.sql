-- Aviso a Admin total cuando un boceto (o las correcciones, o el trabajo de una CM) queda listo para revisar (v206):
-- el trigger chat_push ahora también manda a chat-push los avisos “review” de s:NOTIFS (to: 'admin'); la función se los
-- manda a cada Admin total (menos a quien lo terminó), para que apruebe o pida cambios. El resto queda igual que en v204.
create or replace function private.chat_push_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n_new int; n_old int; s text; fresh jsonb;
begin
  if new.key = 's:NOTIFS' then
    if tg_op <> 'UPDATE' or jsonb_typeof(new.data) <> 'array' then return new; end if;
    select coalesce(jsonb_agg(x.e), '[]'::jsonb) into fresh from (
      select e from jsonb_array_elements(new.data) e
      where ((e->>'type' in ('nuevo', 'pub', 'listo', 'fix') and coalesce(e->>'to', '') not in ('', 'admin'))
          or (e->>'type' = 'review' and e->>'to' = 'admin'))
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
