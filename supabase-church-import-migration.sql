BEGIN;

ALTER TABLE public.churches
  ADD COLUMN IF NOT EXISTS osm_type text;

ALTER TABLE public.churches
  ADD COLUMN IF NOT EXISTS osm_id bigint;

CREATE UNIQUE INDEX IF NOT EXISTS churches_osm_object_unique
  ON public.churches (osm_type, osm_id)
  WHERE osm_type IS NOT NULL AND osm_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS churches_governorate_name_idx
  ON public.churches (governorate, name);

COMMENT ON COLUMN public.churches.osm_type IS
  'OpenStreetMap object type for imported records: node, way, or relation.';

COMMENT ON COLUMN public.churches.osm_id IS
  'OpenStreetMap object ID; combined with osm_type as the stable external identifier.';

COMMIT;
