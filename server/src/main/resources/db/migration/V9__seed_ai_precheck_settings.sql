insert into settings (key, value, version)
values (
  'ai.precheck',
  '{"enabled":false,"failurePolicy":"CONTINUE_WITH_UNAVAILABLE","timeoutMs":30000,"promptVersion":"m4-default"}'::jsonb,
  1
)
on conflict (key) do nothing;
