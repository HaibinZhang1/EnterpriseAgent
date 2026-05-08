package com.enterpriseagent.hub.packages;

import java.util.List;

public record SafeZipExtractResult(
        String sha256,
        long compressedSize,
        long uncompressedSize,
        int fileCount,
        List<FileManifestItem> files,
        List<RiskFinding> findings,
        List<PreviewCandidate> previews,
        boolean rejected,
        String rejectCode) {
    public PackagePrecheckStatus status() {
        if (rejected) {
            return PackagePrecheckStatus.FAILED;
        }
        return findings.isEmpty() ? PackagePrecheckStatus.PASSED : PackagePrecheckStatus.WARNING;
    }

    public String riskLevel() {
        if (findings.stream().anyMatch(f -> "HIGH".equals(f.severity()))) {
            return "HIGH";
        }
        return findings.isEmpty() ? "LOW" : "MEDIUM";
    }
}
