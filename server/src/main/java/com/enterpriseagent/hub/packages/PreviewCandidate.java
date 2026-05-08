package com.enterpriseagent.hub.packages;

public record PreviewCandidate(String path, String content, boolean truncated, long originalSize, int redactionCount) {
}
