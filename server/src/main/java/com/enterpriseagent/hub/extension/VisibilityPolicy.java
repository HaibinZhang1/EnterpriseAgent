package com.enterpriseagent.hub.extension;

import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;

import com.enterpriseagent.hub.auth.CurrentUser;

@Service
public class VisibilityPolicy {
    private final ScopeEvaluator scopeEvaluator;

    public VisibilityPolicy(ScopeEvaluator scopeEvaluator) {
        this.scopeEvaluator = scopeEvaluator;
    }

    public boolean isVisible(CurrentUser actor, Map<String, Object> extension) {
        if (!"PUBLISHED".equals(String.valueOf(extension.get("status")))) {
            return actor.isAdmin();
        }
        if ("PUBLIC_TO_ALL_LOGGED_IN".equals(String.valueOf(extension.get("visibility_mode")))) {
            return true;
        }
        if (actor.isAdmin()) {
            return true;
        }
        Object author = extension.get("author_id");
        Object maintainer = extension.get("maintainer_id");
        if (actor.id().equals(author) || actor.id().equals(maintainer)) {
            return true;
        }
        return scopeEvaluator.isAuthorized(actor, (UUID) extension.get("id"));
    }

    public boolean isMainOperationAllowed(CurrentUser actor, Map<String, Object> extension) {
        if (!"PUBLISHED".equals(String.valueOf(extension.get("status")))) {
            return false;
        }
        Object extensionPk = extension.get("id");
        return extensionPk instanceof UUID id && scopeEvaluator.isAuthorized(actor, id);
    }
}
