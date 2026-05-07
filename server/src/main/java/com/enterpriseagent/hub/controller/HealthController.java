package com.enterpriseagent.hub.controller;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.OffsetDateTime;
import java.util.Arrays;

import javax.sql.DataSource;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.info.BuildProperties;
import org.springframework.core.env.Environment;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.enterpriseagent.hub.common.api.ApiResponse;

@RestController
@RequestMapping("/api")
public class HealthController {
    private final DataSource dataSource;
    private final Environment environment;
    private final String appName;
    private final String configuredVersion;
    private final BuildProperties buildProperties;

    public HealthController(DataSource dataSource, Environment environment,
            @Value("${spring.application.name:enterprise-agent-hub-server}") String appName,
            @Value("${info.app.version:0.1.0-SNAPSHOT}") String configuredVersion,
            org.springframework.beans.factory.ObjectProvider<BuildProperties> buildProperties) {
        this.dataSource = dataSource;
        this.environment = environment;
        this.appName = appName;
        this.configuredVersion = configuredVersion;
        this.buildProperties = buildProperties.getIfAvailable();
    }

    @GetMapping("/health")
    public ApiResponse<HealthStatus> health() {
        DatabaseStatus database = checkDatabase();
        String serviceStatus = database.up() ? "UP" : "DOWN";
        String version = buildProperties == null ? configuredVersion : buildProperties.getVersion();
        return ApiResponse.success(new HealthStatus(serviceStatus, appName, version,
                Arrays.asList(environment.getActiveProfiles()), OffsetDateTime.now(), database));
    }

    private DatabaseStatus checkDatabase() {
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement("select 1");
                ResultSet resultSet = statement.executeQuery()) {
            return new DatabaseStatus(resultSet.next(), "PostgreSQL connection is healthy");
        } catch (Exception exception) {
            return new DatabaseStatus(false, "PostgreSQL connection failed");
        }
    }

    public record HealthStatus(String status, String appName, String version, Iterable<String> profiles,
            OffsetDateTime time, DatabaseStatus database) {
    }

    public record DatabaseStatus(boolean up, String message) {
    }
}
