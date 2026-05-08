create table temp_uploads (
  id uuid primary key,
  upload_type varchar(64) not null,
  original_filename varchar(255) not null,
  content_type varchar(128),
  temp_path text not null,
  sha256 varchar(64) not null,
  size_bytes bigint not null,
  file_count integer,
  precheck_status varchar(32) not null,
  precheck_result jsonb not null,
  created_by uuid not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  status varchar(32) not null,
  created_at timestamptz not null default now(),
  constraint fk_temp_uploads_created_by foreign key (created_by) references users(id),
  constraint ck_temp_uploads_upload_type check (upload_type in ('SKILL_PACKAGE', 'MCP_MANIFEST', 'PLUGIN_PACKAGE', 'PLUGIN_MANIFEST', 'CLIENT_UPDATE_PACKAGE')),
  constraint ck_temp_uploads_precheck_status check (precheck_status in ('PASSED', 'WARNING', 'FAILED')),
  constraint ck_temp_uploads_status check (status in ('AVAILABLE', 'CONSUMED', 'EXPIRED', 'REJECTED', 'RETRYABLE_FAILED'))
);

create index idx_temp_uploads_created_by on temp_uploads(created_by, created_at desc);
create index idx_temp_uploads_expires on temp_uploads(status, expires_at);
create index idx_temp_uploads_sha256 on temp_uploads(sha256);

create table package_objects (
  id uuid primary key,
  object_type varchar(64) not null,
  object_id uuid,
  extension_pk uuid,
  extension_business_id varchar(128),
  version varchar(64),
  sha256 varchar(64) not null,
  storage_path text not null,
  original_filename varchar(255) not null,
  size_bytes bigint not null,
  uncompressed_size_bytes bigint not null default 0,
  file_count integer not null default 0,
  precheck_status varchar(32) not null,
  risk_level varchar(32) not null,
  risk_summary jsonb not null,
  source_temp_upload_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint fk_package_objects_extension foreign key (extension_pk) references extensions(id),
  constraint fk_package_objects_temp_upload foreign key (source_temp_upload_id) references temp_uploads(id),
  constraint fk_package_objects_created_by foreign key (created_by) references users(id),
  constraint ck_package_objects_object_type check (object_type in ('TEMP_UPLOAD', 'EXTENSION_PACKAGE', 'MCP_MANIFEST', 'PLUGIN_MANIFEST', 'EXTERNAL_PLUGIN_FILE')),
  constraint ck_package_objects_precheck_status check (precheck_status in ('PASSED', 'WARNING', 'FAILED')),
  constraint ck_package_objects_risk_level check (risk_level in ('LOW', 'MEDIUM', 'HIGH'))
);

create index idx_package_objects_hash on package_objects(sha256);
create index idx_package_objects_extension_version on package_objects(extension_pk, version);
create index idx_package_objects_temp_upload on package_objects(source_temp_upload_id);

create table package_files (
  id uuid primary key,
  package_object_id uuid not null,
  relative_path text not null,
  size_bytes bigint not null,
  sha256 varchar(64) not null,
  file_type varchar(32) not null,
  mime_type varchar(128),
  risk_flags jsonb not null default '[]'::jsonb,
  previewable boolean not null default false,
  created_at timestamptz not null default now(),
  constraint fk_package_files_package foreign key (package_object_id) references package_objects(id) on delete cascade,
  constraint uk_package_files_path unique (package_object_id, relative_path)
);

create index idx_package_files_package on package_files(package_object_id);

create table package_previews (
  id uuid primary key,
  package_object_id uuid not null,
  relative_path text not null,
  content text,
  truncated boolean not null default false,
  original_size bigint not null default 0,
  redaction_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint fk_package_previews_package foreign key (package_object_id) references package_objects(id) on delete cascade,
  constraint uk_package_previews_path unique (package_object_id, relative_path)
);

create table download_tickets (
  id uuid primary key,
  ticket_hash varchar(255) unique not null,
  object_type varchar(64) not null,
  object_id uuid not null,
  extension_id uuid,
  extension_business_id varchar(128),
  version varchar(64),
  purpose varchar(32) not null,
  user_id uuid not null,
  device_id varchar(128),
  issued_request_id varchar(64) not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  status varchar(32) not null,
  created_at timestamptz not null default now(),
  constraint fk_download_tickets_user foreign key (user_id) references users(id),
  constraint fk_download_tickets_extension foreign key (extension_id) references extensions(id),
  constraint ck_download_tickets_object_type check (object_type in ('EXTENSION_PACKAGE', 'EXTERNAL_PLUGIN_FILE', 'CLIENT_UPDATE', 'REVIEW_PREVIEW')),
  constraint ck_download_tickets_purpose check (purpose in ('INSTALL', 'UPDATE', 'MANUAL_DOWNLOAD', 'REVIEW_PREVIEW', 'CLIENT_UPDATE', 'ADMIN_EXPORT')),
  constraint ck_download_tickets_status check (status in ('ISSUED', 'USED', 'EXPIRED', 'REVOKED'))
);

create unique index uk_download_ticket_hash on download_tickets(ticket_hash);
create index idx_download_tickets_user_object on download_tickets(user_id, object_type, object_id, purpose);
create index idx_download_tickets_extension_purpose on download_tickets(extension_id, purpose, created_at desc);
create index idx_download_tickets_expiry on download_tickets(status, expires_at);
