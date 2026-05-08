create table extensions (
  id uuid primary key,
  extension_id varchar(128) not null,
  type varchar(32) not null,
  name varchar(200) not null,
  description text,
  category varchar(100),
  tags jsonb not null default '[]'::jsonb,
  status varchar(32) not null,
  visibility_mode varchar(64) not null,
  owner_department_id uuid,
  maintainer_id uuid,
  author_id uuid,
  current_version_id uuid,
  current_version varchar(64),
  risk_level varchar(32),
  risk_summary text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uk_extensions_extension_id unique (extension_id),
  constraint ck_extensions_type check (type in ('SKILL', 'MCP_SERVER', 'PLUGIN')),
  constraint ck_extensions_status check (status in ('PUBLISHED', 'DELISTED', 'SECURITY_DELISTED', 'ARCHIVED')),
  constraint ck_extensions_visibility_mode check (visibility_mode in ('PUBLIC_TO_ALL_LOGGED_IN', 'AUTHORIZED_ONLY')),
  constraint fk_extensions_owner_department foreign key (owner_department_id) references departments(id),
  constraint fk_extensions_maintainer foreign key (maintainer_id) references users(id),
  constraint fk_extensions_author foreign key (author_id) references users(id)
);

create index idx_extensions_type_status on extensions(type, status);
create index idx_extensions_visibility_status on extensions(visibility_mode, status);
create index idx_extensions_owner_department on extensions(owner_department_id);
create index idx_extensions_search_name on extensions(lower(name));

create table extension_versions (
  id uuid primary key,
  extension_pk uuid not null,
  version varchar(64) not null,
  status varchar(32) not null,
  payload_snapshot jsonb not null,
  package_snapshot jsonb,
  changelog text,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  constraint fk_extension_versions_extension foreign key (extension_pk) references extensions(id),
  constraint uk_extension_versions_extension_version unique (extension_pk, version),
  constraint ck_extension_versions_status check (status in ('DRAFT', 'PUBLISHED', 'ARCHIVED'))
);

create index idx_extension_versions_extension on extension_versions(extension_pk, created_at desc);
create index idx_extension_versions_status on extension_versions(status);

create table extension_authorization_scopes (
  id uuid primary key,
  extension_pk uuid not null,
  scope_type varchar(64) not null,
  created_at timestamptz not null default now(),
  constraint fk_extension_scopes_extension foreign key (extension_pk) references extensions(id),
  constraint ck_extension_scopes_type check (scope_type in ('ALL_EMPLOYEES', 'DEPARTMENT', 'DEPARTMENT_TREE', 'SELECTED_DEPARTMENTS'))
);

create index idx_extension_scopes_extension on extension_authorization_scopes(extension_pk);

create table extension_authorized_departments (
  id uuid primary key,
  scope_id uuid not null,
  department_id uuid not null,
  include_children boolean not null default false,
  constraint fk_extension_authorized_departments_scope foreign key (scope_id) references extension_authorization_scopes(id) on delete cascade,
  constraint fk_extension_authorized_departments_department foreign key (department_id) references departments(id),
  constraint uk_extension_authorized_departments unique (scope_id, department_id)
);

create index idx_extension_authorized_departments_department on extension_authorized_departments(department_id);

create table mcp_definitions (
  id uuid primary key,
  extension_pk uuid not null,
  access_type varchar(64) not null,
  transport varchar(64) not null,
  config_schema jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint fk_mcp_definitions_extension foreign key (extension_pk) references extensions(id),
  constraint uk_mcp_definitions_extension unique (extension_pk)
);

create table plugin_definitions (
  id uuid primary key,
  extension_pk uuid not null,
  install_mode varchar(64) not null,
  target_tools jsonb not null default '[]'::jsonb,
  manifest jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint fk_plugin_definitions_extension foreign key (extension_pk) references extensions(id),
  constraint uk_plugin_definitions_extension unique (extension_pk),
  constraint ck_plugin_definitions_install_mode check (install_mode in ('MANAGED_PACKAGE', 'CONFIG_PLUGIN', 'MANUAL_DOWNLOAD'))
);

create table stars (
  id uuid primary key,
  user_id uuid not null,
  extension_pk uuid not null,
  starred boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_stars_user foreign key (user_id) references users(id),
  constraint fk_stars_extension foreign key (extension_pk) references extensions(id),
  constraint uk_stars_user_extension unique (user_id, extension_pk)
);

create index idx_stars_extension_starred on stars(extension_pk, starred);

create table activity_events (
  id uuid primary key,
  event_type varchar(64) not null,
  user_id uuid,
  extension_pk uuid,
  idempotency_key varchar(128),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint fk_activity_events_user foreign key (user_id) references users(id),
  constraint fk_activity_events_extension foreign key (extension_pk) references extensions(id)
);

create index idx_activity_events_type_created_at on activity_events(event_type, created_at desc);
create index idx_activity_events_extension_type on activity_events(extension_pk, event_type);
create unique index uk_activity_events_idempotency_key on activity_events(idempotency_key) where idempotency_key is not null;

create table metric_period_aggregates (
  id uuid primary key,
  extension_pk uuid not null,
  metric_type varchar(64) not null,
  period varchar(32) not null,
  value bigint not null default 0,
  calculated_at timestamptz not null default now(),
  constraint fk_metric_period_aggregates_extension foreign key (extension_pk) references extensions(id),
  constraint uk_metric_period_aggregates unique (extension_pk, metric_type, period)
);

create index idx_metric_period_aggregates_metric_period on metric_period_aggregates(metric_type, period, value desc);
