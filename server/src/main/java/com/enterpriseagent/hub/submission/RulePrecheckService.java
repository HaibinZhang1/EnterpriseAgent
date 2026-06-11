package com.enterpriseagent.hub.submission;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import com.enterpriseagent.hub.common.error.BusinessException;
import com.enterpriseagent.hub.common.error.ErrorCode;
import com.enterpriseagent.hub.extension.ScopeType;

@Service
public class RulePrecheckService {
    private static final Pattern SEMVER_PATTERN = Pattern.compile(
            "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)"
                    + "(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?"
                    + "(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$");

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
        if (SemVer.parse(request.version()) == null) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "版本号必须为 SemVer");
        }
        validateExtensionState(request, currentSubmissionId);
        validateAuthorizationScope(request.authorizationScope());
        if (request.visibilityMode() == null) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "可见性模式必须显式指定");
        }
        return Map.of("status", "PASSED", "summary", "规则预审通过");
    }

    private void validateAuthorizationScope(Map<String, Object> authorizationScope) {
        if (authorizationScope == null) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "授权范围必须显式指定");
        }
        ScopeType scopeType = parseScopeType(authorizationScope.get("scopeType"));
        if (scopeType == ScopeType.ALL_EMPLOYEES) {
            return;
        }
        List<UUID> departmentIds = departmentIds(authorizationScope.get("departments"));
        if (departmentIds.isEmpty()) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "部门授权范围必须指定部门");
        }
        for (UUID departmentId : departmentIds) {
            if (!exists("select exists(select 1 from departments where id = ?)", departmentId)) {
                throw new BusinessException(ErrorCode.VALIDATION_FAILED, "授权部门不存在");
            }
        }
    }

    private ScopeType parseScopeType(Object value) {
        if (value == null || !StringUtils.hasText(String.valueOf(value))) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "授权范围类型必须显式指定");
        }
        try {
            return ScopeType.valueOf(String.valueOf(value));
        } catch (IllegalArgumentException exception) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "授权范围类型不合法");
        }
    }

    private List<UUID> departmentIds(Object departments) {
        if (!(departments instanceof Iterable<?> iterable)) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "部门授权范围必须指定部门列表");
        }
        List<UUID> ids = new ArrayList<>();
        for (Object item : iterable) {
            if (!(item instanceof Map<?, ?> map) || map.get("departmentId") == null
                    || !StringUtils.hasText(String.valueOf(map.get("departmentId")))) {
                throw new BusinessException(ErrorCode.VALIDATION_FAILED, "部门授权范围包含无效部门");
            }
            try {
                ids.add(UUID.fromString(String.valueOf(map.get("departmentId"))));
            } catch (IllegalArgumentException exception) {
                throw new BusinessException(ErrorCode.VALIDATION_FAILED, "部门授权范围包含无效部门");
            }
        }
        return ids;
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

    private boolean exists(String sql, UUID id) {
        Boolean exists = jdbc.queryForObject(sql, Boolean.class, id);
        return Boolean.TRUE.equals(exists);
    }

    private int compareSemVer(String left, String right) {
        SemVer leftVersion = SemVer.parse(left);
        SemVer rightVersion = SemVer.parse(right);
        if (rightVersion == null) {
            return 1;
        }
        if (leftVersion == null) {
            return -1;
        }
        return leftVersion.compareTo(rightVersion);
    }

    private record SemVer(String major, String minor, String patch, String preRelease) implements Comparable<SemVer> {
        static SemVer parse(String value) {
            if (!StringUtils.hasText(value)) {
                return null;
            }
            Matcher matcher = SEMVER_PATTERN.matcher(value.trim());
            if (!matcher.matches()) {
                return null;
            }
            String preRelease = matcher.group(4);
            if (preRelease != null) {
                for (String identifier : preRelease.split("\\.")) {
                    if (isNumeric(identifier) && identifier.length() > 1 && identifier.startsWith("0")) {
                        return null;
                    }
                }
            }
            return new SemVer(matcher.group(1), matcher.group(2), matcher.group(3), preRelease);
        }

        @Override
        public int compareTo(SemVer other) {
            int core = compareCore(other);
            if (core != 0) {
                return core;
            }
            if (preRelease == null && other.preRelease == null) {
                return 0;
            }
            if (preRelease == null) {
                return 1;
            }
            if (other.preRelease == null) {
                return -1;
            }
            return comparePreRelease(preRelease, other.preRelease);
        }

        private int compareCore(SemVer other) {
            int majorComparison = compareNumericIdentifier(major, other.major);
            if (majorComparison != 0) {
                return majorComparison;
            }
            int minorComparison = compareNumericIdentifier(minor, other.minor);
            if (minorComparison != 0) {
                return minorComparison;
            }
            return compareNumericIdentifier(patch, other.patch);
        }

        private static int comparePreRelease(String left, String right) {
            String[] leftParts = left.split("\\.");
            String[] rightParts = right.split("\\.");
            int count = Math.min(leftParts.length, rightParts.length);
            for (int index = 0; index < count; index++) {
                String leftPart = leftParts[index];
                String rightPart = rightParts[index];
                boolean leftNumeric = isNumeric(leftPart);
                boolean rightNumeric = isNumeric(rightPart);
                if (leftNumeric && rightNumeric) {
                    int comparison = compareNumericIdentifier(leftPart, rightPart);
                    if (comparison != 0) {
                        return comparison;
                    }
                } else if (leftNumeric != rightNumeric) {
                    return leftNumeric ? -1 : 1;
                } else {
                    int comparison = leftPart.compareTo(rightPart);
                    if (comparison != 0) {
                        return comparison;
                    }
                }
            }
            return Integer.compare(leftParts.length, rightParts.length);
        }

        private static boolean isNumeric(String value) {
            return value.chars().allMatch(Character::isDigit);
        }

        private static int compareNumericIdentifier(String left, String right) {
            int lengthComparison = Integer.compare(left.length(), right.length());
            if (lengthComparison != 0) {
                return lengthComparison;
            }
            return left.compareTo(right);
        }
    }
}
