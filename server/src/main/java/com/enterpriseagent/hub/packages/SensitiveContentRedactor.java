package com.enterpriseagent.hub.packages;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

import org.springframework.stereotype.Component;

@Component
public class SensitiveContentRedactor {
    private static final List<Pattern> PATTERNS = List.of(
            Pattern.compile("(?i)(api[_-]?key\\s*[:=]\\s*)([A-Za-z0-9_\\-]{16,})"),
            Pattern.compile("(?i)(token\\s*[:=]\\s*)([A-Za-z0-9_\\-.]{20,})"),
            Pattern.compile("(?i)(password\\s*[:=]\\s*)([^,\\s]{8,})"),
            Pattern.compile("-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----[\\s\\S]*?-----END (RSA |EC |OPENSSH )?PRIVATE KEY-----"));

    public RedactionResult redact(String content) {
        String redacted = content;
        int count = 0;
        for (Pattern pattern : PATTERNS) {
            var matcher = pattern.matcher(redacted);
            StringBuffer buffer = new StringBuffer();
            while (matcher.find()) {
                count++;
                if (matcher.groupCount() >= 2) {
                    matcher.appendReplacement(buffer, java.util.regex.Matcher.quoteReplacement(matcher.group(1) + "***"));
                } else {
                    matcher.appendReplacement(buffer, "***REDACTED_PRIVATE_KEY***");
                }
            }
            matcher.appendTail(buffer);
            redacted = buffer.toString();
        }
        return new RedactionResult(redacted, count);
    }

    public List<RiskFinding> findSecrets(String path, String content) {
        List<RiskFinding> findings = new ArrayList<>();
        RedactionResult redacted = redact(content);
        if (redacted.redactionCount() > 0) {
            findings.add(new RiskFinding("POSSIBLE_SECRET", path, "疑似敏感信息，已脱敏", "HIGH", sample(redacted.content())));
        }
        return findings;
    }

    private String sample(String content) {
        String compact = content.replaceAll("\\s+", " ").trim();
        return compact.length() > 120 ? compact.substring(0, 120) : compact;
    }

    public record RedactionResult(String content, int redactionCount) {}
}
