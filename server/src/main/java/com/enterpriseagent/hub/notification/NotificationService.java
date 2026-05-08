package com.enterpriseagent.hub.notification;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.enterpriseagent.hub.auth.CurrentUser;
import com.enterpriseagent.hub.common.error.BusinessException;
import com.enterpriseagent.hub.common.error.ErrorCode;
import com.enterpriseagent.hub.common.pagination.PageResult;
import com.enterpriseagent.hub.extension.ExtensionJson;

@Service
public class NotificationService {
    private final JdbcTemplate jdbc;
    private final ExtensionJson json;

    public NotificationService(JdbcTemplate jdbc, ExtensionJson json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Transactional(readOnly = true)
    public PageResult<Map<String, Object>> list(CurrentUser actor, int page, int pageSize) {
        var items = jdbc.queryForList("""
                select id, type, title, summary, object_type, object_id, payload::text as payload, read_at, created_at
                from notifications where user_id = ? order by created_at desc
                """, actor.id()).stream().map(this::mapNotification).toList();
        return PageResult.of(items, page, pageSize);
    }

    @Transactional
    public Map<String, Object> markRead(CurrentUser actor, UUID notificationId) {
        var rows = jdbc.queryForList("""
                select id, user_id from notifications where id = ?
                """, notificationId);
        if (rows.isEmpty()) {
            throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "通知不存在");
        }
        if (!actor.id().equals(rows.get(0).get("user_id"))) {
            throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "通知不存在");
        }
        jdbc.update("update notifications set read_at = coalesce(read_at, now()) where id = ?", notificationId);
        return mapNotification(jdbc.queryForList("""
                select id, type, title, summary, object_type, object_id, payload::text as payload, read_at, created_at
                from notifications where id = ?
                """, notificationId).get(0));
    }

    private Map<String, Object> mapNotification(Map<String, Object> row) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", row.get("id"));
        item.put("type", row.get("type"));
        item.put("title", row.get("title"));
        item.put("summary", row.get("summary"));
        item.put("objectType", row.get("object_type"));
        item.put("objectId", row.get("object_id"));
        item.put("payload", json.read((String) row.get("payload")));
        item.put("readAt", row.get("read_at"));
        item.put("createdAt", row.get("created_at"));
        return item;
    }
}
