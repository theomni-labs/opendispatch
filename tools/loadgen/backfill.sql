-- Load-test only
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO cases (tenant_id, data_source, created_at, updated_at, external_id, case_number, registered_at,
  city_id, zone_id, sub_zone_id, latitude, longitude, case_type_id, parties_involved, assigned_at, arrived_at,
  closed_at, handling, agent_id, vehicle_id, severity, injury_present, estimated_damage_sar,
  on_scene_completed_at, remote_review_at, channel, extra)
SELECT c.tenant_id, 'SYNTHETIC', c.created_at - s.shift, c.updated_at - s.shift,
  c.external_id || '-bf' || w || '-' || r, c.case_number || '-bf' || w || '-' || r, c.registered_at - s.shift,
  c.city_id, c.zone_id, c.sub_zone_id, c.latitude, c.longitude, c.case_type_id, c.parties_involved,
  c.assigned_at - s.shift, c.arrived_at - s.shift, c.closed_at - s.shift, c.handling, c.agent_id, c.vehicle_id,
  c.severity, c.injury_present, c.estimated_damage_sar, c.on_scene_completed_at - s.shift,
  c.remote_review_at - s.shift, c.channel, c.extra || '{"loadgen_backfill": true}'
FROM cases c
CROSS JOIN generate_series(1, :weeks) w
CROSS JOIN generate_series(1, :copies) r
CROSS JOIN LATERAL (SELECT make_interval(days => 7 * w, mins => 2 * r) AS shift) s
WHERE c.data_source = 'SYNTHETIC' AND c.external_id IS NOT NULL
  AND c.external_id NOT LIKE 'LG-%' AND NOT c.extra ? 'loadgen_backfill';
COMMIT;
ANALYZE cases;
SELECT count(*) AS cases, min(registered_at)::date AS first_day, max(registered_at)::date AS last_day FROM cases;
