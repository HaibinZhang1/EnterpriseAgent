package com.enterpriseagent.hub.submission;

import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import com.enterpriseagent.hub.common.error.BusinessException;
import com.enterpriseagent.hub.common.error.ErrorCode;
import com.enterpriseagent.hub.extension.ScopeType;

@Service
public class RulePrecheckService {
    private final JdbcTemplate jdbc;

    public RulePrecheckService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Map<String, Object> validate(SubmissionRequest request) {
        return validate(request, null);
    }

    public Map<String, Object> validateRevision(SubmissionRequest request, UUID currentSubmissionId) {
        return validate(request, currentSubmissionId);
    }

    private Map<String, Object> validate(SubmissionRequest request, UUID currentSubmissionId) {
        if (request.type() == null || request.extensionType() == null || !StringUtils.hasText(request.extensionId())) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "发布申请缺少必要字段");
        }
        if (!request.extensionId().matches("^[a-z0-9][a-z0-9-]{1,126}[a-z0-9]$")) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "Extension ID 格式不合法");
        }
        if (!StringUtils.hasText(request.version()) || !request.version().matches("^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$")) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "版本号必须为 SemVer");
        }
        validateExtensionState(request, currentSubmissionId);
        if (request.authorizationScope() != null && request.authorizationScope().get("scopeType") != null) {
            try {
                ScopeType.valueOf(String.valueOf(request.authorizationScope().get("scopeType")));
            } catch (IllegalArgumentException exception) {
                throw new BusinessException(ErrorCode.VALIDATION_FAILED, "授权范围类型不合法");
            }
        }
        return Map.of("status", "PASSED", "summary", "规则预审通过");
    }

    private void validateExtensionState(SubmissionRequest request, UUID currentSubmissionId) {
        boolean extensionExists = exists("select exists(select 1 from extensions where extension_id = ?)", request.extensionId());
        if (request.type() == SubmissionType.FIRST_PUBLISH) {
            if (extensionExists || existsPendingSubmission(request.extensionId(), currentSubmissionId)) {
                throw new BusinessException(ErrorCode.VALIDATION_FAILED, "Extension ID 已存在或正在审核中");
            }
            return;
        }
        if (!extensionExists) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "非首次发布必须指向已存在扩展");
        }
        if (request.type() == SubmissionType.VERSION_UPDATE) {
            String currentVersion = jdbc.queryForObject("""
                    select current_version from extensions where extension_id = ?
                    """, String.class, request.extensionId());
            if (compareSemVer(request.version(), currentVersion) <= 0) {
                throw new BusinessException(ErrorCode.VALIDATION_FAILED, "版本更新必须高于当前版本");
            }
            if (exists("""
                    select exists(
                      select 1 from extension_versions v
                      join extensions e on e.id = v.extension_pk
                      where e.extension_id = ? and v.version = ?
                    )
                    """, request.extensionId(), request.version())) {
                throw new BusinessException(ErrorCode.VALIDATION_FAILED, "版本号已存在");
            }
        }
    }

    private boolean existsPendingSubmission(String extensionId, UUID currentSubmissionId) {
        Boolean exists = jdbc.queryForObject("""
                select exists(
                  select 1 from submissions
                  where target_extension_id = ?
                    and status not in ('REJECTED', 'WITHDRAWN')
                    and (?::uuid is null or id <> ?::uuid)
                )
                """, Boolean.class, extensionId, currentSubmissionId, currentSubmissionId);
        return Boolean.TRUE.equals(exists);
    }

    private boolean exists(String sql, String extensionId) {
        Boolean exists = jdbc.queryForObject(sql, Boolean.class, extensionId);
        return Boolean.TRUE.equals(exists);
    }

    private boolean exists(String sql, String extensionId, String version) {
        Boolean exists = jdbc.queryForObject(sql, Boolean.class, extensionId, version);
        return Boolean.TRUE.equals(exists);
    }

    private int compareSemVer(String left, String right) {
        if (!StringUtils.hasText(right)) {
            return 1;
        }
        String[] leftParts = left.split("-", 2)[0].split("\\.");
        String[] rightParts = right.split("-", 2)[0].split("\\.");
        for (int index = 0; index < 3; index++) {
            int comparison = Integer.compare(Integer.parseInt(leftParts[index]), Integer.parseInt(rightParts[index]));
            if (comparison != 0) {
                return comparison;
            }
        }
        return left.compareTo(right);
    }
}
