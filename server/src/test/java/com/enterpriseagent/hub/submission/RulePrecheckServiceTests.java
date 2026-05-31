package com.enterpriseagent.hub.submission;

import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import com.enterpriseagent.hub.common.error.BusinessException;
import com.enterpriseagent.hub.extension.ExtensionType;
import com.enterpriseagent.hub.extension.VisibilityMode;

class RulePrecheckServiceTests {
    @Test
    void acceptsSemverBuildMetadataForFirstPublish() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), eq("skill-build"))).thenReturn(false);
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), eq("skill-build"), any(), any())).thenReturn(false);

        RulePrecheckService service = new RulePrecheckService(jdbc);

        assertThatNoException().isThrownBy(() -> service.validate(request(
                SubmissionType.FIRST_PUBLISH, "skill-build", "1.2.3-beta.1+build.7")));
    }

    @Test
    void treatsStableReleaseAsNewerThanPrerelease() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), eq("skill-prerelease"))).thenReturn(true);
        when(jdbc.queryForObject(anyString(), eq(String.class), eq("skill-prerelease"))).thenReturn("1.0.0-rc.1");
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), eq("skill-prerelease"), eq("1.0.0"))).thenReturn(false);

        RulePrecheckService service = new RulePrecheckService(jdbc);

        assertThatNoException().isThrownBy(() -> service.validate(request(
                SubmissionType.VERSION_UPDATE, "skill-prerelease", "1.0.0")));
    }

    @Test
    void rejectsInvalidSemverPrereleaseNumericIdentifiers() {
        RulePrecheckService service = new RulePrecheckService(mock(JdbcTemplate.class));

        assertThatThrownBy(() -> service.validate(request(SubmissionType.FIRST_PUBLISH, "skill-invalid", "1.0.0-01")))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("版本号必须为 SemVer");
    }

    @Test
    void comparesLargeNumericIdentifiersWithoutOverflow() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), eq("skill-large-version"))).thenReturn(true);
        when(jdbc.queryForObject(anyString(), eq(String.class), eq("skill-large-version")))
                .thenReturn("1.0.0-999999999999999999999999");
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), eq("skill-large-version"),
                eq("1.0.0-1000000000000000000000000"))).thenReturn(false);

        RulePrecheckService service = new RulePrecheckService(jdbc);

        assertThatNoException().isThrownBy(() -> service.validate(request(
                SubmissionType.VERSION_UPDATE, "skill-large-version", "1.0.0-1000000000000000000000000")));
    }

    private SubmissionRequest request(SubmissionType type, String extensionId, String version) {
        return new SubmissionRequest(type, ExtensionType.SKILL, extensionId, null, version,
                Map.of("name", extensionId), Map.of("scopeType", "ALL_EMPLOYEES"),
                VisibilityMode.PUBLIC_TO_ALL_LOGGED_IN, Map.of(), Map.of(), List.of());
    }
}
