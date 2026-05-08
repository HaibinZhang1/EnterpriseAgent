package com.enterpriseagent.hub.packages;

import java.util.List;

public record FileManifestItem(
        String path,
        long size,
        String sha256,
        PackageFileType type,
        boolean previewable,
        List<String> riskFlags) {
}
