create table audit_logs (
  id uuid primary key,
  request_id varchar(64) not null,
  actor_id uuid,
  actor_snapshot jsonb,
  actor_department_snapshot jsonb,
  object_type varchar(64) not null,
  object_id varchar(128),
  object_name_snapshot varchar(255),
  action varchar(128) not null,
  result varchar(32) not null,
  reason text,
  before_summary jsonb,
  after_summary jsonb,
  ip varchar(64),
  user_agent text,
  client_version varchar(64),
  device_id varchar(128),
  created_at timestamptz not null default now()
);

create index idx_audit_request_id on audit_logs(request_id);
create index idx_audit_actor on audit_logs(actor_id, created_at desc);
create index idx_audit_object on audit_logs(object_type, object_id, created_at desc);
create index idx_audit_created_at on audit_logs(created_at desc);
create index idx_audit_device on audit_logs(device_id, created_at desc);

create table settings (
  key varchar(128) primary key,
  value jsonb not null,
  version int not null default 1,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create unique index uk_settings_key on settings(key);

create table settings_history (
  id uuid primary key,
  key varchar(128) not null,
  before_value jsonb,
  after_value jsonb not null,
  before_version int,
  after_version int not null,
  reason text not null,
  updated_by uuid,
  actor_snapshot jsonb,
  created_at timestamptz not null default now()
);

create index idx_settings_history_key_created_at on settings_history(key, created_at desc);
