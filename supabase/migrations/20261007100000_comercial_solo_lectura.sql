-- Comercial (s:COMERCIAL): las ofertas publicadas de cada quincena. Las escribe solo la función "integraciones"
-- (con la clave de servicio) leyendo los Excel de Drive; la app solo las lee.
create policy "app_state: comercial solo lectura (crear)" on public.app_state
  as restrictive for insert to authenticated with check (key <> 's:COMERCIAL');
create policy "app_state: comercial solo lectura (modificar)" on public.app_state
  as restrictive for update to authenticated using (key <> 's:COMERCIAL');
