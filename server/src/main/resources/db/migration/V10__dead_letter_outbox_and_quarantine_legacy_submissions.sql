alter table outbox_events drop constraint ck_outbox_events_status;

alter table outbox_events
  add constraint ck_outbox_events_status
  check (status in ('NEW', 'PROCESSING', 'DONE', 'FAILED', 'DEAD_LETTER'));

comment on constraint ck_outbox_events_status on outbox_events is
  'DEAD_LETTER is a terminal quarantine state for poison payloads after bounded retry attempts.';

with current_snapshots as (
  select s.id as submission_id,
         r.payload_snapshot,
         r.package_snapshot,
         nullif(r.payload_snapshot #>> '{data,visibilityMode}', '') as visibility_mode,
         nullif(r.payload_snapshot #>> '{data,authorizationScope,scopeType}', '') as scope_type,
         nullif(r.package_snapshot #>> '{data,packageId}', '') as package_id
    from submissions s
    join submission_revisions r on r.id = s.current_revision_id
   where s.status in ('CREATED', 'VALIDATING', 'AI_PRECHECKING', 'PENDING_REVIEW', 'IN_REVIEW')
)
update submissions s
   set status = 'CHANGES_REQUESTED',
       updated_at = now()
  from current_snapshots snapshot
 where s.id = snapshot.submission_id
   and (
     snapshot.visibility_mode is null
     or snapshot.visibility_mode not in ('PUBLIC_TO_ALL_LOGGED_IN', 'AUTHORIZED_ONLY')
     or snapshot.scope_type is null
     or snapshot.scope_type not in ('ALL_EMPLOYEES', 'DEPARTMENT', 'DEPARTMENT_TREE', 'SELECTED_DEPARTMENTS')
     or (
       snapshot.scope_type <> 'ALL_EMPLOYEES'
       and case
         when jsonb_typeof(snapshot.payload_snapshot #> '{data,authorizationScope,departments}') = 'array'
         then jsonb_array_length(snapshot.payload_snapshot #> '{data,authorizationScope,departments}') = 0
         else true
       end
     )
     or snapshot.package_id is null
     or case
       when snapshot.package_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       then not exists (select 1 from package_objects po where po.id = snapshot.package_id::uuid)
       else true
     end
   );
