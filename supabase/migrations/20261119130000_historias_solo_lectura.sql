-- v364 · s:META_STORIES (historias de Instagram) queda de solo lectura para la app, como los demás datos de Meta: la escribe
-- únicamente api/_lib/historias.js con ingest_meta (security definer). s:STORY_IMGS (las imágenes del top guardadas en Drive) sí la
-- escribe la app y sigue las reglas de siempre (private.can_access_state).
alter policy "app_state: datos de meta solo lectura (crear)" on public.app_state
  with check (key <> all (array['s:META_FOLLOWERS', 's:META_DEMO', 's:META_POSTS', 's:META_CREATIVES', 's:META_STORIES']));
alter policy "app_state: datos de meta solo lectura (modificar)" on public.app_state
  using (key <> all (array['s:META_FOLLOWERS', 's:META_DEMO', 's:META_POSTS', 's:META_CREATIVES', 's:META_STORIES']));
