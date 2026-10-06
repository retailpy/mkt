-- Usuario de ingreso (ej. "Alesme"): se entra con él en vez del email. Único sin importar mayúsculas.
-- Solo lo lee la función admin-users (con la clave de servicio); la app no expone los emails.
alter table public.members add column if not exists username text;
create unique index if not exists members_username_lower on public.members (lower(username));
