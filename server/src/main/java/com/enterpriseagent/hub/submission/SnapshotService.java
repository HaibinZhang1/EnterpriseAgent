package com.enterpriseagent.hub.submission;

import java.util.Locale;
import java.util.Map;

import org.springframework.stereotype.Service;

import com.enterpriseagent.hub.common.error.BusinessException;
import com.enterpriseagent.hub.common.error.ErrorCode;
import com.enterpriseagent.hub.extension.ExtensionJson;

@Service
public class SnapshotService {
    private final ExtensionJson json;

    public SnapshotService(ExtensionJson json) {
        this.json = json;
    }

    public Map<String, Object> envelopeMap(String source, Object data) {
        return json.envelopeMap(source, data);
    }

    public String envelope(String source, Object data) {
        return json.write(envelopeMap(source, data));
    }

    public void rejectM5PackageFields(SubmissionRequest request) {
        scanForForbiddenPackageFields(request.metadata());
        scanForForbiddenPackageFields(request.riskStatement());
        scanForForbiddenPackageFields(request.typePayload());
        scanForForbiddenPackageFields(request.authorizationScope());
    }

    private void scanForForbiddenPackageFields(Object value) {
        if (value == null) {
            return;
        }
        if (value instanceof Map<?, ?> map) {
            for (var entry : map.entrySet()) {
                String key = String.valueOf(entry.getKey());
                if (isForbiddenPackageField(key)) {
                    throw new BusinessException(ErrorCode.VALIDATION_FAILED, "M4 不支持真实包上传或下载字段");
                }
                scanForForbiddenPackageFields(entry.getValue());
            }
        } else if (value instanceof Iterable<?> iterable) {
            for (Object item : iterable) {
                scanForForbiddenPackageFields(item);
            }
        }
    }

    private boolean isForbiddenPackageField(String key) {
        String normalized = key.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
        return normalized.contains("uploadurl")
                || normalized.contains("downloadurl")
                || normalized.contains("packageurl")
                || normalized.contains("objectstore")
                || normalized.contains("objectstorage")
                || normalized.contains("filesystem")
                || normalized.contains("filepath")
                || normalized.contains("credential")
                || normalized.contains("token")
                || normalized.contains("secret")
                || normalized.contains("password")
                || normalized.equals("key")
                || normalized.endsWith("key")
                || normalized.contains("downloadticket");
    }
}
