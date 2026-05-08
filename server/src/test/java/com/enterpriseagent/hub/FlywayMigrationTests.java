package com.enterpriseagent.hub;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;

import javax.sql.DataSource;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class FlywayMigrationTests extends PostgresIntegrationTestBase {
    @Autowired
    private DataSource dataSource;

    @Test
    void foundationMigrationCreatesRequiredTablesColumnsAndIndexes() throws Exception {
        try (Connection connection = dataSource.getConnection()) {
            assertThat(exists(connection, "select to_regclass('public.audit_logs') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.settings') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.settings_history') is not null")).isTrue();
            assertThat(exists(connection, "select exists (select 1 from information_schema.columns where table_name = 'settings' and column_name = 'version' and is_nullable = 'NO')")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.idx_audit_request_id') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.idx_audit_created_at') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.idx_audit_object') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.uk_settings_key') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.departments') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.users') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.sessions') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.login_attempts') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.password_reset_tokens') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.idempotency_records') is not null")).isTrue();
            assertThat(exists(connection, "select exists (select 1 from information_schema.columns where table_name = 'users' and column_name = 'password_hash' and is_nullable = 'NO')")).isTrue();
            assertThat(exists(connection, "select exists (select 1 from information_schema.columns where table_name = 'sessions' and column_name = 'token_hash' and is_nullable = 'NO')")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.uk_sessions_token_hash') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.uk_password_reset_token_hash') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.uk_idempotency_actor_operation_key') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.extensions') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.extension_versions') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.extension_authorization_scopes') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.stars') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.metric_period_aggregates') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.submissions') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.submission_revisions') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.system_prechecks') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.reviews') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.notifications') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.outbox_events') is not null")).isTrue();
            assertThat(exists(connection, "select exists (select 1 from information_schema.columns where table_name = 'outbox_events' and column_name = 'retry_count')")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.temp_uploads') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.package_objects') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.package_files') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.package_previews') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.download_tickets') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.uk_download_ticket_hash') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.idx_package_objects_hash') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.local_events') is not null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.uk_local_event_idempotency') is not null")).isTrue();
            assertThat(exists(connection, "select exists (select 1 from information_schema.columns where table_name = 'local_events' and column_name = 'payload_summary' and is_nullable = 'NO')")).isTrue();
        }
    }

    private boolean exists(Connection connection, String sql) throws Exception {
        try (var statement = connection.prepareStatement(sql); var resultSet = statement.executeQuery()) {
            resultSet.next();
            return resultSet.getBoolean(1);
        }
    }
}
