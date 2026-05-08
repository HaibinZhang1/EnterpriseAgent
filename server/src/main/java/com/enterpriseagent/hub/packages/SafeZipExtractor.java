package com.enterpriseagent.hub.packages;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import org.springframework.stereotype.Component;

@Component
public class SafeZipExtractor {
    private static final Pattern WINDOWS_DRIVE = Pattern.compile("^[a-zA-Z]:[\\\\/].*");
    private static final Set<String> RESERVED = Set.of("con", "prn", "aux", "nul", "com1", "com2", "com3", "com4",
            "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9");
    private static final Set<String> SCRIPT_EXTENSIONS = Set.of(".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd", ".js", ".vbs");
    private static final Set<String> EXECUTABLE_EXTENSIONS = Set.of(".exe", ".dll", ".so", ".dylib", ".msi");
    private static final Set<String> CERT_EXTENSIONS = Set.of(".pem", ".key", ".p12", ".pfx", ".crt", ".cer");
    private static final Set<String> CONFIG_EXTENSIONS = Set.of(".env", ".properties", ".toml", ".ini", ".conf");

    private final PackageStorageProperties properties;
    private final SensitiveContentRedactor redactor;

    public SafeZipExtractor(PackageStorageProperties properties, SensitiveContentRedactor redactor) {
        this.properties = properties;
        this.redactor = redactor;
    }

    public SafeZipExtractResult scan(Path archivePath, String sha256, long compressedSize) {
        if (compressedSize > properties.getMaxCompressedSize()) {
            return rejected(sha256, compressedSize, "package_too_large");
        }
        List<FileManifestItem> files = new ArrayList<>();
        List<RiskFinding> findings = new ArrayList<>();
        List<PreviewCandidate> previews = new ArrayList<>();
        long uncompressed = 0;
        try (InputStream input = java.nio.file.Files.newInputStream(archivePath);
                ZipInputStream zip = new ZipInputStream(input, StandardCharsets.UTF_8)) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (entry.isDirectory()) {
                    continue;
                }
                String path = normalizeEntryName(entry.getName());
                String reject = rejectCodeForPath(path);
                if (reject != null) {
                    return rejected(sha256, compressedSize, reject);
                }
                if (files.size() + 1 > properties.getMaxFileCount()) {
                    return rejected(sha256, compressedSize, "package_file_count_exceeded");
                }
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                MessageDigest digest = sha256Digest();
                byte[] buffer = new byte[8192];
                int read;
                long entrySize = 0;
                while ((read = zip.read(buffer)) >= 0) {
                    entrySize += read;
                    uncompressed += read;
                    digest.update(buffer, 0, read);
                    if (entrySize > properties.getMaxSingleFileSize()) {
                        return rejected(sha256, compressedSize, "validation_failed");
                    }
                    if (uncompressed > properties.getMaxUncompressedSize()) {
                        return rejected(sha256, compressedSize, "package_uncompressed_size_exceeded");
                    }
                    if (out.size() < properties.getPreviewMaxBytes() + 1) {
                        int allowed = Math.min(read, properties.getPreviewMaxBytes() + 1 - out.size());
                        out.write(buffer, 0, allowed);
                    }
                }
                byte[] previewBytes = out.toByteArray();
                PackageFileType type = detectType(path, previewBytes);
                List<String> riskFlags = riskFlags(path, type, previewBytes);
                findings.addAll(findingsFor(path, riskFlags));
                boolean previewable = isPreviewable(path, type);
                String fileSha = HexFormat.of().formatHex(digest.digest());
                files.add(new FileManifestItem(path, entrySize, fileSha, type, previewable, riskFlags));
                if (previewable) {
                    String content = new String(previewBytes, 0, Math.min(previewBytes.length, properties.getPreviewMaxBytes()), StandardCharsets.UTF_8);
                    var redacted = redactor.redact(content);
                    findings.addAll(redactor.findSecrets(path, content));
                    previews.add(new PreviewCandidate(path, redacted.content(), entrySize > properties.getPreviewMaxBytes(), entrySize, redacted.redactionCount()));
                }
            }
        } catch (IOException | IllegalArgumentException exception) {
            return rejected(sha256, compressedSize, "validation_failed");
        }
        if (files.isEmpty()) {
            return rejected(sha256, compressedSize, "validation_failed");
        }
        return new SafeZipExtractResult(sha256, compressedSize, uncompressed, files.size(), List.copyOf(files),
                List.copyOf(findings), List.copyOf(previews), false, null);
    }

    private MessageDigest sha256Digest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 unavailable", exception);
        }
    }

    private SafeZipExtractResult rejected(String sha256, long compressedSize, String code) {
        return new SafeZipExtractResult(sha256, compressedSize, 0, 0, List.of(), List.of(), List.of(), true, code);
    }

    private String normalizeEntryName(String name) {
        return name.replace('\\', '/').trim();
    }

    private String rejectCodeForPath(String path) {
        if (path.isEmpty() || path.contains("\u0000") || path.chars().anyMatch(ch -> ch < 32)) {
            return "package_path_traversal";
        }
        if (path.startsWith("/") || WINDOWS_DRIVE.matcher(path).matches()) {
            return "package_path_traversal";
        }
        Path normalized = Path.of(path).normalize();
        String normalizedText = normalized.toString().replace('\\', '/');
        if (normalized.isAbsolute() || normalizedText.startsWith("..") || normalizedText.contains("/../")) {
            return "package_path_traversal";
        }
        for (Path part : normalized) {
            String lower = part.toString().toLowerCase(Locale.ROOT);
            int dot = lower.indexOf('.');
            String base = dot >= 0 ? lower.substring(0, dot) : lower;
            if (RESERVED.contains(base)) {
                return "package_path_traversal";
            }
        }
        return null;
    }

    private PackageFileType detectType(String path, byte[] sample) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (endsWithAny(lower, EXECUTABLE_EXTENSIONS)) return PackageFileType.EXECUTABLE;
        if (endsWithAny(lower, SCRIPT_EXTENSIONS)) return PackageFileType.SCRIPT;
        if (endsWithAny(lower, CERT_EXTENSIONS)) return PackageFileType.CERTIFICATE;
        if (endsWithAny(lower, CONFIG_EXTENSIONS)) return PackageFileType.CONFIG;
        if (isLikelyBinary(sample)) return PackageFileType.BINARY;
        if (isPreviewExtension(lower)) return PackageFileType.TEXT;
        return PackageFileType.UNKNOWN;
    }

    private boolean endsWithAny(String value, Set<String> suffixes) {
        return suffixes.stream().anyMatch(value::endsWith);
    }

    private boolean isLikelyBinary(byte[] bytes) {
        for (byte b : bytes) {
            if (b == 0) return true;
        }
        return false;
    }

    private boolean isPreviewable(String path, PackageFileType type) {
        return type != PackageFileType.BINARY && type != PackageFileType.EXECUTABLE && isPreviewExtension(path.toLowerCase(Locale.ROOT));
    }

    private boolean isPreviewExtension(String lower) {
        return properties.getPreviewExtensions().stream().anyMatch(lower::endsWith);
    }

    private List<String> riskFlags(String path, PackageFileType type, byte[] sample) {
        List<String> flags = new ArrayList<>();
        switch (type) {
            case SCRIPT -> flags.add("SCRIPT_FILE");
            case EXECUTABLE -> flags.add("EXECUTABLE_FILE");
            case BINARY -> flags.add("BINARY_FILE");
            case CERTIFICATE -> flags.add("CERTIFICATE_OR_KEY_FILE");
            case CONFIG -> flags.add("CONFIG_FILE");
            default -> { }
        }
        String content = new String(sample, StandardCharsets.UTF_8);
        if (content.contains("http://") || content.contains("https://")) {
            flags.add("EXTERNAL_URL");
        }
        if (redactor.redact(content).redactionCount() > 0) {
            flags.add("POSSIBLE_SECRET");
        }
        return List.copyOf(flags);
    }

    private List<RiskFinding> findingsFor(String path, List<String> riskFlags) {
        return riskFlags.stream()
                .map(flag -> new RiskFinding(flag, path, riskMessage(flag), "POSSIBLE_SECRET".equals(flag) ? "HIGH" : "MEDIUM", null))
                .toList();
    }

    private String riskMessage(String flag) {
        return switch (flag) {
            case "SCRIPT_FILE" -> "包含脚本文件";
            case "EXECUTABLE_FILE" -> "包含可执行文件";
            case "BINARY_FILE" -> "包含二进制文件";
            case "CERTIFICATE_OR_KEY_FILE" -> "包含证书或密钥类文件";
            case "CONFIG_FILE" -> "包含配置文件";
            case "EXTERNAL_URL" -> "包含外部网络地址";
            case "POSSIBLE_SECRET" -> "包含疑似敏感信息";
            default -> "存在风险项";
        };
    }
}
