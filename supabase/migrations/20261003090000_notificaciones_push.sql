-- Notificaciones push del Chat Retail MKT (llegan al celular o a la compu aunque la app esté cerrada).
-- push_subs: los dispositivos donde cada persona activó las notificaciones (cada uno ve y borra solo los suyos).
-- push_config: claves VAPID y secreto interno; sin políticas → nadie la lee desde la app, solo el servidor.
create extension if not exists pg_net with schema extensions;

create table if not exists public.push_subs (
  endpoint text primary key,
  person_id text not null,
  sub jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
create policy "push_subs: ver los mios" on public.push_subs for select to authenticated using (person_id = (select private.my_person_id()));
create policy "push_subs: agregar los mios" on public.push_subs for insert to authenticated with check (person_id = (select private.my_person_id()));
create policy "push_subs: actualizar los mios" on public.push_subs for update to authenticated using (person_id = (select private.my_person_id())) with check (person_id = (select private.my_person_id()));
create policy "push_subs: borrar los mios" on public.push_subs for delete to authenticated using (person_id = (select private.my_person_id()));
revoke all on public.push_subs from anon;

create table if not exists public.push_config (
  id int primary key default 1 check (id = 1),
  secret text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  vapid_public text,
  vapid_private text
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;
insert into public.push_config (id) values (1) on conflict (id) do nothing;

create or replace function private.chat_push_url() returns text language sql immutable set search_path = '' as $$ select 'https://idcdfmeeggmtkudkkzmu.supabase.co/functions/v1/chat-push' $$;

-- Cuando llega un mensaje nuevo (crece la lista msgs de thread:* o chat:*), se avisa a la función chat-push.
create or replace function private.chat_push_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n_new int; n_old int; s text;
begin
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
exception when others then return new; -- un aviso que falla nunca frena el guardado del mensaje
end $$;
revoke execute on function private.chat_push_notify() from public, anon, authenticated;

drop trigger if exists chat_push on public.app_state;
create trigger chat_push after insert or update of data on public.app_state
  for each row execute function private.chat_push_notify();
