package com.enterpriseagent.hub.settings;

import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.enterpriseagent.hub.extension.ExtensionJson;

@Service
public class SettingsQueryService {
    private final JdbcTemplate jdbc;
    private final ExtensionJson json;

    public SettingsQueryService(JdbcTemplate jdbc, ExtensionJson json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public AiPrecheckSettings aiPrecheckSettings() {
        var rows = jdbc.queryForList("select value::text as value from settings where key = 'ai.precheck'");
        if (rows.isEmpty()) {
            return AiPrecheckSettings.defaults();
        }
        try {
            Map<String, Object> value = json.readMap((String) rows.get(0).get("value"));
            return new AiPrecheckSettings(
                    Boolean.TRUE.equals(value.get("enabled")),
                    number(value.get("timeoutMs"), 30000),
                    String.valueOf(value.getOrDefault("failurePolicy", "CONTINUE_WITH_UNAVAILABLE")),
                    (String) value.get("model"),
                    String.valueOf(value.getOrDefault("promptVersion", "m4-default")));
        } catch (RuntimeException exception) {
            return AiPrecheckSettings.defaults();
        }
    }

    private int number(Object value, int fallback) {
        if (value instanceof Number number) {
            return number.intValue();
        }
        return fallback;
    }
}
