package com.enterpriseagent.hub.notification;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.enterpriseagent.hub.extension.ExtensionJson;

@Service
public class NotificationOutboxConsumer {
    private static final Logger log = LoggerFactory.getLogger(NotificationOutboxConsumer.class);
    private final JdbcTemplate jdbc;
    private final ExtensionJson json;
    private final TransactionTemplate transactions;

    public NotificationOutboxConsumer(JdbcTemplate jdbc, ExtensionJson json, TransactionTemplate transactions) {
        this.jdbc = jdbc;
        this.json = json;
        this.transactions = transactions;
    }

    public void processPending() {
        var events = jdbc.queryForList("""
                select id, payload::text as payload from outbox_events
                where event_type = 'NOTIFICATION_REQUESTED'
                  and status in ('NEW', 'FAILED')
                  and (next_retry_at is null or next_retry_at <= now())
                order by created_at asc limit 20
                """);
        for (Map<String, Object> event : events) {
            processEvent(event);
        }
    }

    private void processEvent(Map<String, Object> event) {
        UUID eventId = (UUID) event.get("id");
        try {
            transactions.executeWithoutResult(status -> {
                int claimed = jdbc.update("""
                        update outbox_events
                        set status = 'PROCESSING', updated_at = now()
                        where id = ?
                          and status in ('NEW', 'FAILED')
                          and (next_retry_at is null or next_retry_at <= now())
                        """, eventId);
                if (claimed == 0) {
                    return;
                }
                createNotification((String) event.get("payload"));
                jdbc.update("update outbox_events set status = 'DONE', updated_at = now(), last_error = null where id = ?",
                        eventId);
            });
        } catch (RuntimeException exception) {
            recordFailure(eventId, exception);
        }
    }

    private void recordFailure(UUID eventId, RuntimeException exception) {
        try {
            transactions.executeWithoutResult(status -> jdbc.update("""
                    update outbox_events set status = 'FAILED', retry_count = retry_count + 1,
                      next_retry_at = ?, last_error = ?, updated_at = now() where id = ?
                    """, OffsetDateTime.now().plusMinutes(1), safeError(exception), eventId));
        } catch (RuntimeException failureRecordingException) {
            log.warn("Unable to record notification outbox failure for event {}", eventId, failureRecordingException);
        }
    }

    private void createNotification(String payloadJson) {
        Map<String, Object> envelope = json.readMap(payloadJson);
        Object dataObject = envelope.get("data");
        Map<String, Object> data = dataObject instanceof Map<?, ?> map ? toStringKeyMap(map) : Map.of();
        UUID userId = UUID.fromString(String.valueOf(data.get("userId")));
        String type = String.valueOf(data.getOrDefault("type", "REVIEW_DECISION"));
        String title = String.valueOf(data.getOrDefault("title", "审核通知"));
        String summary = String.valueOf(data.getOrDefault("summary", "审核状态已更新"));
        String objectType = String.valueOf(data.getOrDefault("objectType", "submission"));
        String objectId = String.valueOf(data.getOrDefault("objectId", ""));
        jdbc.update("""
                insert into notifications (id, user_id, type, title, summary, object_type, object_id, payload)
                values (?, ?, ?, ?, ?, ?, ?, ?::jsonb)
                """, UUID.randomUUID(), userId, type, title, summary, objectType, objectId, payloadJson);
    }

    private String safeError(RuntimeException exception) {
        String message = exception.getMessage() == null ? exception.getClass().getSimpleName() : exception.getMessage();
        return message.length() > 500 ? message.substring(0, 500) : message;
    }

    private Map<String, Object> toStringKeyMap(Map<?, ?> input) {
        return input.entrySet().stream()
                .collect(java.util.stream.Collectors.toMap(
                        entry -> String.valueOf(entry.getKey()),
                        Map.Entry::getValue,
                        (left, right) -> right,
                        java.util.LinkedHashMap::new));
    }
}
