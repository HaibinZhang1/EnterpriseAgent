create table submissions (
  id uuid primary key,
  type varchar(64) not null,
  extension_type varchar(32) not null,
  target_extension_id varchar(128) not null,
  submitter_id uuid not null,
  submitter_department_id uuid not null,
  status varchar(32) not null,
  review_owner_type varchar(32) not null,
  review_owner_department_id uuid,
  current_revision_id uuid,
  effective_revision_id uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_submissions_submitter foreign key (submitter_id) references users(id),
  constraint fk_submissions_submitter_department foreign key (submitter_department_id) references departments(id),
  constraint ck_submissions_type check (type in ('FIRST_PUBLISH', 'VERSION_UPDATE', 'METADATA_CHANGE', 'SCOPE_EXPANSION', 'SCOPE_REDUCTION', 'VISIBILITY_EXPANSION', 'VISIBILITY_REDUCTION', 'RELIST', 'ARCHIVE')),
  constraint ck_submissions_extension_type check (extension_type in ('SKILL', 'MCP_SERVER', 'PLUGIN')),
  constraint ck_submissions_status check (status in ('CREATED', 'VALIDATING', 'AI_PRECHECKING', 'PENDING_REVIEW', 'IN_REVIEW', 'CHANGES_REQUESTED', 'REJECTED', 'APPROVED', 'WITHDRAWN')),
  constraint ck_submissions_review_owner_type check (review_owner_type in ('DEPARTMENT_ADMIN', 'SYSTEM_ADMIN'))
);

create index idx_submissions_status_created_at on submissions(status, created_at desc);
create index idx_submissions_submitter on submissions(submitter_id, created_at desc);
create index idx_submissions_review_owner on submissions(review_owner_type, review_owner_department_id, status);

create table submission_revisions (
  id uuid primary key,
  submission_id uuid not null,
  revision_no integer not null,
  payload_snapshot jsonb not null,
  package_snapshot jsonb not null,
  submitted_by uuid not null,
  created_at timestamptz not null default now(),
  constraint fk_submission_revisions_submission foreign key (submission_id) references submissions(id),
  constraint fk_submission_revisions_submitter foreign key (submitted_by) references users(id),
  constraint uk_submission_revision unique (submission_id, revision_no)
);

create index idx_submission_revisions_submission_created_at on submission_revisions(submission_id, created_at desc);

create table system_prechecks (
  id uuid primary key,
  submission_id uuid not null,
  revision_id uuid not null,
  rule_status varchar(32) not null,
  rule_result jsonb not null,
  ai_status varchar(32) not null,
  ai_result_summary jsonb not null,
  ai_model varchar(128),
  ai_prompt_version varchar(64),
  created_at timestamptz not null default now(),
  constraint fk_system_prechecks_submission foreign key (submission_id) references submissions(id),
  constraint fk_system_prechecks_revision foreign key (revision_id) references submission_revisions(id),
  constraint ck_system_prechecks_rule_status check (rule_status in ('PASSED', 'WARNING', 'FAILED')),
  constraint ck_system_prechecks_ai_status check (ai_status in ('DISABLED', 'PENDING', 'PASSED', 'WARNING', 'FAILED', 'UNAVAILABLE'))
);

create index idx_system_prechecks_submission_revision on system_prechecks(submission_id, revision_id);

create table reviews (
  id uuid primary key,
  submission_id uuid not null,
  revision_id uuid not null,
  reviewer_id uuid not null,
  reviewer_snapshot jsonb not null,
  decision varchar(32) not null,
  comment text,
  reason_codes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint fk_reviews_submission foreign key (submission_id) references submissions(id),
  constraint fk_reviews_revision foreign key (revision_id) references submission_revisions(id),
  constraint fk_reviews_reviewer foreign key (reviewer_id) references users(id),
  constraint ck_reviews_decision check (decision in ('APPROVE', 'REQUEST_CHANGES', 'REJECT'))
);

create unique index uk_reviews_submission_revision on reviews(submission_id, revision_id);
create index idx_reviews_reviewer_created_at on reviews(reviewer_id, created_at desc);

create table notifications (
  id uuid primary key,
  user_id uuid not null,
  type varchar(64) not null,
  title varchar(200) not null,
  summary text,
  object_type varchar(64),
  object_id varchar(128),
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint fk_notifications_user foreign key (user_id) references users(id)
);

create index idx_notifications_user_created_at on notifications(user_id, created_at desc);
create index idx_notifications_user_unread on notifications(user_id, created_at desc) where read_at is null;

create table extension_ownership_history (
  id uuid primary key,
  extension_pk uuid not null,
  before_owner_department_id uuid,
  after_owner_department_id uuid,
  before_maintainer_id uuid,
  after_maintainer_id uuid,
  reason text,
  changed_by uuid,
  created_at timestamptz not null default now(),
  constraint fk_extension_ownership_history_extension foreign key (extension_pk) references extensions(id)
);

create table outbox_events (
  id uuid primary key,
  event_type varchar(128) not null,
  aggregate_type varchar(64) not null,
  aggregate_id uuid not null,
  payload jsonb not null,
  status varchar(32) not null,
  retry_count integer not null default 0,
  next_retry_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_outbox_events_status check (status in ('NEW', 'PROCESSING', 'DONE', 'FAILED'))
);

create index idx_outbox_events_status_next_retry on outbox_events(status, next_retry_at, created_at);
create index idx_outbox_events_aggregate on outbox_events(aggregate_type, aggregate_id);
