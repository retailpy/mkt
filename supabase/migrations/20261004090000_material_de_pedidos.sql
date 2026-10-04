-- Material adjunto de los pedidos (Diseño y CM): archivos privados, solo para las personas activas del equipo.
insert into storage.buckets (id, name, public, file_size_limit)
values ('material', 'material', false, 15728640) -- 15 MB por archivo
on conflict (id) do nothing;

create policy "material: el equipo lo ve" on storage.objects for select to authenticated
  using (bucket_id = 'material' and private.my_person_id() is not null);
create policy "material: el equipo lo sube" on storage.objects for insert to authenticated
  with check (bucket_id = 'material' and private.my_person_id() is not null);
create policy "material: borra quien lo subió o Admin total" on storage.objects for delete to authenticated
  using (bucket_id = 'material' and (owner_id = auth.uid()::text or private.is_admin_total()));
