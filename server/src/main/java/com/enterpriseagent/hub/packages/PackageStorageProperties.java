package com.enterpriseagent.hub.packages;

import java.nio.file.Path;
import java.time.Duration;
import java.util.Set;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "enterprise-agent.package-storage")
public class PackageStorageProperties {
    private Path root = Path.of("storage");
    private long maxCompressedSize = 5L * 1024 * 1024;
    private long maxUncompressedSize = 20L * 1024 * 1024;
    private long maxSingleFileSize = 2L * 1024 * 1024;
    private int maxFileCount = 100;
    private int previewMaxBytes = 256 * 1024;
    private Duration tempTtl = Duration.ofHours(24);
    private Duration ticketTtl = Duration.ofMinutes(10);
    private Set<String> previewExtensions = Set.of(".md", ".markdown", ".txt", ".json", ".yaml", ".yml");

    public Path getRoot() { return root; }
    public void setRoot(Path root) { this.root = root; }
    public long getMaxCompressedSize() { return maxCompressedSize; }
    public void setMaxCompressedSize(long maxCompressedSize) { this.maxCompressedSize = maxCompressedSize; }
    public long getMaxUncompressedSize() { return maxUncompressedSize; }
    public void setMaxUncompressedSize(long maxUncompressedSize) { this.maxUncompressedSize = maxUncompressedSize; }
    public long getMaxSingleFileSize() { return maxSingleFileSize; }
    public void setMaxSingleFileSize(long maxSingleFileSize) { this.maxSingleFileSize = maxSingleFileSize; }
    public int getMaxFileCount() { return maxFileCount; }
    public void setMaxFileCount(int maxFileCount) { this.maxFileCount = maxFileCount; }
    public int getPreviewMaxBytes() { return previewMaxBytes; }
    public void setPreviewMaxBytes(int previewMaxBytes) { this.previewMaxBytes = previewMaxBytes; }
    public Duration getTempTtl() { return tempTtl; }
    public void setTempTtl(Duration tempTtl) { this.tempTtl = tempTtl; }
    public Duration getTicketTtl() { return ticketTtl; }
    public void setTicketTtl(Duration ticketTtl) { this.ticketTtl = ticketTtl; }
    public Set<String> getPreviewExtensions() { return previewExtensions; }
    public void setPreviewExtensions(Set<String> previewExtensions) { this.previewExtensions = previewExtensions; }
}
