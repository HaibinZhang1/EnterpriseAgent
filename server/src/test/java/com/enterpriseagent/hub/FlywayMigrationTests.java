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
            assertThat(exists(connection, "select to_regclass('public.extensions') is null")).isTrue();
            assertThat(exists(connection, "select to_regclass('public.submissions') is null")).isTrue();
        }
    }

    private boolean exists(Connection connection, String sql) throws Exception {
        try (var statement = connection.prepareStatement(sql); var resultSet = statement.executeQuery()) {
            resultSet.next();
            return resultSet.getBoolean(1);
        }
    }
}
