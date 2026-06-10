create or replace view public.latest_node_behavior as
select
  lne.id as node_event_id,
  lne.node_id,
  lne.node_name,
  lne.base_id,
  lne.event_type,
  lne.event_data,
  lne.created_at as event_created_at,
  bf.id as behavior_feature_id,
  bf.created_at as behavior_created_at,
  bf.feature_version,
  bf.movement_mode,
  bf.sample_quality,
  bf.sample_count,
  bf.valid_count,
  bf.count_mismatch,
  bf.score_min,
  bf.score_max,
  bf.score_avg,
  bf.score_range,
  bf.score_stddev,
  bf.quiet_ratio,
  bf.active_ratio,
  bf.spike_count,
  bf.inactivity_candidate,
  bf.abnormal_activity_candidate
from public.latest_node_events lne
left join public.behavior_features bf
  on bf.node_event_id = lne.id
  and bf.feature_version = 'phase1_v1';
