package com.enterpriseagent.hub.settings;

import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import com.enterpriseagent.hub.extension.ExtensionJson;

@Service
public class SettingsQueryService {
    private static final Logger log = LoggerFactory.getLogger(SettingsQueryService.class);

    private final JdbcTemplate jdbc;
    private final ExtensionJson json;

    public SettingsQueryService(JdbcTemplate jdbc, ExtensionJson json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public AiPrecheckSettings aiPrecheckSettings() {
        var rows = jdbc.queryForList("select value::text as value from settings where key = 'ai.precheck'");
        if (rows.isEmpty()) {
            log.error("AI precheck settings row is missing");
            return AiPrecheckSettings.invalid("missing ai.precheck settings");
        }
        try {
            Map<String, Object> value = json.readMap((String) rows.get(0).get("value"));
            String failurePolicy = string(value.get("failurePolicy"));
            if (!StringUtils.hasText(failurePolicy)) {
                log.error("AI precheck settings are missing failurePolicy");
                return AiPrecheckSettings.invalid("missing failurePolicy");
            }
            if (!"FAIL_CLOSED".equals(failurePolicy) && !"CONTINUE_WITH_UNAVAILABLE".equals(failurePolicy)) {
                log.error("AI precheck settings contain invalid failurePolicy: {}", failurePolicy);
                return AiPrecheckSettings.invalid("invalid failurePolicy");
            }
            return new AiPrecheckSettings(
                    Boolean.TRUE.equals(value.get("enabled")),
                    number(value.get("timeoutMs"), 30000),
                    failurePolicy,
                    (String) value.get("model"),
                    String.valueOf(value.getOrDefault("promptVersion", "m4-default")),
                    true,
                    null);
        } catch (RuntimeException exception) {
            log.error("AI precheck settings are unreadable", exception);
            return AiPrecheckSettings.invalid("settings parse failed");
        }
    }

    private int number(Object value, int fallback) {
        if (value instanceof Number number) {
            return number.intValue();
        }
        return fallback;
    }

    private String string(Object value) {
        return value == null ? null : String.valueOf(value).trim();
    }
}
