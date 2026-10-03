-- Claves de las integraciones del chat (GIPHY y el script de Google Drive para los stickers).
-- Sin políticas: la app no la puede leer; solo la función "integraciones" (con la clave de servicio).
-- Admin total las carga desde Configuración → Integraciones.
create table if not exists public.integration_config (
  id int primary key default 1 check (id = 1),
  giphy_key text,
  sticker_url text,
  sticker_secret text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  updated_at timestamptz not null default now()
);
alter table public.integration_config enable row level security;
revoke all on public.integration_config from anon, authenticated;
insert into public.integration_config (id) values (1) on conflict (id) do nothing;
