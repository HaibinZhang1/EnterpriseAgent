package com.enterpriseagent.hub.organization;

import java.util.List;
import java.util.UUID;

public record OrganizationSnapshot(String schemaVersion, UUID departmentId, String departmentName, List<String> path) {
    public static OrganizationSnapshot of(UUID departmentId, String departmentName, List<String> path) {
        return new OrganizationSnapshot("1", departmentId, departmentName, path);
    }
}
