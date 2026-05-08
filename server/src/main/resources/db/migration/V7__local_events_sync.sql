create table local_events (
  id uuid primary key,
  user_id uuid not null,
  device_id varchar(128) not null,
  extension_pk uuid,
  extension_business_id varchar(128),
  version varchar(64),
  event_type varchar(64) not null,
  idempotency_key varchar(512) not null,
  result varchar(32),
  error_code varchar(64),
  payload_summary jsonb not null default '{}'::jsonb,
  occurred_at timestamptz,
  synced_at timestamptz not null default now(),
  constraint fk_local_events_user foreign key (user_id) references users(id),
  constraint fk_local_events_extension foreign key (extension_pk) references extensions(id)
);

create unique index uk_local_event_idempotency on local_events(device_id, idempotency_key);
create index idx_local_events_extension on local_events(extension_pk, synced_at desc);
create index idx_local_events_user_synced on local_events(user_id, synced_at desc);
