create table idempotency_records (
    id uuid primary key,
    actor_id uuid,
    operation varchar(128) not null,
    idempotency_key varchar(128) not null,
    request_hash varchar(64) not null,
    response_snapshot jsonb,
    status varchar(32) not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint ck_idempotency_records_status check (status in ('PROCESSING', 'SUCCEEDED'))
);

create unique index uk_idempotency_actor_operation_key
    on idempotency_records (coalesce(actor_id, '00000000-0000-0000-0000-000000000000'::uuid), operation, idempotency_key);

create index idx_idempotency_records_expiry on idempotency_records (expires_at);
