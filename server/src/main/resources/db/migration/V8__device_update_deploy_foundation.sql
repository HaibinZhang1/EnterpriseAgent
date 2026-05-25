alter table package_objects drop constraint ck_package_objects_object_type;
alter table package_objects add constraint ck_package_objects_object_type
  check (object_type in ('TEMP_UPLOAD', 'EXTENSION_PACKAGE', 'MCP_MANIFEST', 'PLUGIN_MANIFEST', 'EXTERNAL_PLUGIN_FILE', 'CLIENT_UPDATE_PACKAGE'));

create table client_devices (
  id uuid primary key,
  device_id varchar(128) not null,
  user_id uuid not null,
  department_id uuid not null,
  user_snapshot jsonb not null,
  department_snapshot jsonb not null,
  hostname_hash varchar(128),
  os_version varchar(128),
  arch varchar(32),
  client_version varchar(64),
  install_channel varchar(32),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  status varchar(32) not null,
  recent_update_status varchar(32),
  recent_error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uk_client_devices_device_id unique (device_id),
  constraint fk_client_devices_user foreign key (user_id) references users(id),
  constraint fk_client_devices_department foreign key (department_id) references departments(id),
  constraint ck_client_devices_status check (status in ('ACTIVE', 'INACTIVE', 'BLOCKED'))
);

create index idx_client_devices_user on client_devices(user_id, last_seen_at desc);
create index idx_client_devices_department on client_devices(department_id, last_seen_at desc);
create index idx_client_devices_version on client_devices(client_version, last_seen_at desc);
create index idx_client_devices_last_seen on client_devices(last_seen_at desc);

create table client_device_events (
  id uuid primary key,
  device_id varchar(128) not null,
  user_id uuid not null,
  department_id uuid not null,
  idempotency_key varchar(255) not null,
  event_type varchar(64) not null,
  result varchar(32) not null,
  error_code varchar(128),
  request_id varchar(64) not null,
  local_event_id varchar(128),
  payload_summary jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint uk_client_device_event_idempotency unique (device_id, idempotency_key)
);

create index idx_client_device_events_device_created on client_device_events(device_id, created_at desc);
create index idx_client_device_events_user_created on client_device_events(user_id, created_at desc);
create index idx_client_device_events_department_created on client_device_events(department_id, created_at desc);
create index idx_client_device_events_type_created on client_device_events(event_type, created_at desc);

create table client_versions (
  id uuid primary key,
  version varchar(64) not null,
  build_no varchar(64) not null,
  platform varchar(32) not null,
  arch varchar(32) not null,
  channel varchar(32) not null,
  force_update boolean not null default false,
  min_supported_version varchar(64),
  release_notes text,
  package_object_id uuid,
  package_sha256 varchar(64),
  package_size bigint,
  signature_status varchar(32) not null,
  certificate_summary jsonb not null default '{}'::jsonb,
  status varchar(32) not null,
  created_by uuid not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_client_versions_package foreign key (package_object_id) references package_objects(id),
  constraint fk_client_versions_created_by foreign key (created_by) references users(id),
  constraint uk_client_versions_version_arch_channel unique (version, platform, arch, channel),
  constraint ck_client_versions_version_semver check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$'),
  constraint ck_client_versions_package_sha256 check (package_sha256 is null or package_sha256 ~ '^[0-9a-fA-F]{64}$'),
  constraint ck_client_versions_package_size check (package_size is null or package_size > 0),
  constraint ck_client_versions_signature_status check (signature_status in ('VALID', 'INVALID', 'UNKNOWN')),
  constraint ck_client_versions_status check (status in ('DRAFT', 'PUBLISHED', 'PAUSED', 'WITHDRAWN'))
);

create index idx_client_versions_status on client_versions(status, created_at desc);
create index idx_client_versions_version on client_versions(version);
create index idx_client_versions_package on client_versions(package_object_id);
create index idx_client_versions_check on client_versions(status, signature_status, platform, arch, channel, published_at desc);

create table client_update_events (
  id uuid primary key,
  version_id uuid,
  device_id varchar(128),
  user_id uuid,
  event_type varchar(64) not null,
  result varchar(32) not null,
  error_code varchar(128),
  request_id varchar(64) not null,
  from_version varchar(64),
  to_version varchar(64),
  payload_summary jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint fk_client_update_events_version foreign key (version_id) references client_versions(id),
  constraint fk_client_update_events_user foreign key (user_id) references users(id)
);

create index idx_client_update_events_version_created on client_update_events(version_id, created_at desc);
create index idx_client_update_events_device_created on client_update_events(device_id, created_at desc);
create index idx_client_update_events_user_created on client_update_events(user_id, created_at desc);
create index idx_client_update_events_result_created on client_update_events(result, created_at desc);
