create table departments (
  id uuid primary key,
  name varchar(100) not null,
  parent_id uuid,
  status varchar(32) not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_departments_status check (status in ('ACTIVE', 'DISABLED', 'DELETED')),
  constraint fk_departments_parent foreign key (parent_id) references departments(id)
);

create index idx_departments_parent on departments(parent_id);
create index idx_departments_status on departments(status);
create unique index uk_departments_parent_name_active
  on departments(coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where status <> 'DELETED';

create table users (
  id uuid primary key,
  name varchar(100) not null,
  phone varchar(32) not null,
  password_hash varchar(255) not null,
  password_algo varchar(32) not null,
  password_changed_at timestamptz not null,
  must_change_password boolean not null default false,
  department_id uuid not null,
  role varchar(32) not null,
  status varchar(32) not null default 'ACTIVE',
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_users_department foreign key (department_id) references departments(id),
  constraint ck_users_role check (role in ('NORMAL_USER', 'DEPARTMENT_ADMIN', 'SYSTEM_ADMIN')),
  constraint ck_users_status check (status in ('ACTIVE', 'FROZEN', 'DELETED'))
);

create unique index uk_users_phone on users(phone) where status <> 'DELETED';
create index idx_users_department on users(department_id);
create index idx_users_role_status on users(role, status);
create index idx_users_locked_until on users(locked_until);

create table sessions (
  id uuid primary key,
  user_id uuid not null,
  device_id varchar(128),
  token_hash varchar(255) not null,
  client_type varchar(32) not null,
  expires_at timestamptz not null,
  idle_expires_at timestamptz,
  revoked_at timestamptz,
  revoke_reason varchar(128),
  last_accessed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint fk_sessions_user foreign key (user_id) references users(id),
  constraint ck_sessions_client_type check (client_type in ('DESKTOP', 'ADMIN_WEB'))
);

create index idx_sessions_user_active on sessions(user_id, expires_at) where revoked_at is null;
create unique index uk_sessions_token_hash on sessions(token_hash);

create table login_attempts (
  id uuid primary key,
  phone varchar(32) not null,
  user_id uuid,
  ip varchar(64),
  user_agent text,
  result varchar(32) not null,
  failure_reason varchar(128),
  created_at timestamptz not null default now(),
  constraint fk_login_attempts_user foreign key (user_id) references users(id),
  constraint ck_login_attempts_result check (result in ('SUCCESS', 'FAILED'))
);

create index idx_login_attempts_phone_created_at on login_attempts(phone, created_at desc);
create index idx_login_attempts_phone_ip_result_created_at on login_attempts(phone, ip, result, created_at desc);
create index idx_login_attempts_user_created_at on login_attempts(user_id, created_at desc);

create table password_reset_tokens (
  id uuid primary key,
  user_id uuid not null,
  token_hash varchar(255) not null,
  purpose varchar(32) not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint fk_password_reset_tokens_user foreign key (user_id) references users(id),
  constraint fk_password_reset_tokens_created_by foreign key (created_by) references users(id),
  constraint ck_password_reset_tokens_purpose check (purpose in ('ADMIN_RESET', 'USER_CHANGE_REQUIRED'))
);

create unique index uk_password_reset_token_hash on password_reset_tokens(token_hash);
create index idx_password_reset_user_active on password_reset_tokens(user_id, expires_at)
  where used_at is null and revoked_at is null;
