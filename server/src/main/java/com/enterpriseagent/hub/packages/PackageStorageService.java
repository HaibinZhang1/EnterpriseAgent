package com.enterpriseagent.hub.packages;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import jakarta.annotation.PostConstruct;

import com.enterpriseagent.hub.common.error.BusinessException;
import com.enterpriseagent.hub.common.error.ErrorCode;

@Service
public class PackageStorageService {
    private final PackageStorageProperties properties;

    public PackageStorageService(PackageStorageProperties properties) {
        this.properties = properties;
    }

    @PostConstruct
    void initializeStorageDirectories() {
        try {
            Files.createDirectories(safeResolve(properties.getRoot(), "packages", "skill"));
            Files.createDirectories(safeResolve(properties.getRoot(), "packages", "mcp"));
            Files.createDirectories(safeResolve(properties.getRoot(), "packages", "plugin"));
            Files.createDirectories(safeResolve(properties.getRoot(), "manifests", "mcp"));
            Files.createDirectories(safeResolve(properties.getRoot(), "manifests", "plugin"));
            Files.createDirectories(safeResolve(properties.getRoot(), "client-updates"));
            Files.createDirectories(safeResolve(properties.getRoot(), "previews"));
            Files.createDirectories(safeResolve(properties.getRoot(), "temp"));
            Files.createDirectories(safeResolve(properties.getRoot(), "backups"));
        } catch (IOException exception) {
            throw new BusinessException(ErrorCode.STORAGE_WRITE_FAILED, "存储目录初始化失败");
        }
    }

    public StoredTempFile writeTemp(UUID tempUploadId, MultipartFile file) {
        String filename = sanitizeFilename(file.getOriginalFilename());
        Path directory = safeResolve(properties.getRoot(), "temp", "uploads", tempUploadId.toString());
        Path target = safeResolve(directory, filename);
        try {
            Files.createDirectories(directory);
            try (InputStream input = file.getInputStream()) {
                Files.copy(input, target, StandardCopyOption.REPLACE_EXISTING);
            }
            long size = Files.size(target);
            if (size > properties.getMaxCompressedSize()) {
                Files.deleteIfExists(target);
                throw new BusinessException(ErrorCode.PACKAGE_TOO_LARGE, "包大小超过限制");
            }
            String sha256;
            try (InputStream input = Files.newInputStream(target)) {
                sha256 = Hashing.sha256(input);
            }
            return new StoredTempFile(target, filename, size, sha256);
        } catch (BusinessException exception) {
            throw exception;
        } catch (IOException exception) {
            throw new BusinessException(ErrorCode.STORAGE_WRITE_FAILED, "临时文件写入失败");
        }
    }

    public Path moveTempToFinal(Path tempPath, UploadType uploadType, String extensionId, String version, String sha256,
            String originalFilename) {
        String typeDirectory = switch (uploadType) {
            case SKILL_PACKAGE -> "skill";
            case MCP_MANIFEST -> "mcp";
            case PLUGIN_PACKAGE, PLUGIN_MANIFEST -> "plugin";
            case CLIENT_UPDATE_PACKAGE -> "client-updates";
        };
        Path directory = uploadType == UploadType.CLIENT_UPDATE_PACKAGE
                ? safeResolve(properties.getRoot(), "client-updates", version, sha256)
                : safeResolve(properties.getRoot(), "packages", typeDirectory, extensionId, version, sha256);
        Path target = safeResolve(directory, sanitizeFilename(originalFilename));
        try {
            Files.createDirectories(directory);
            if (Files.exists(target)) {
                try (InputStream input = Files.newInputStream(target)) {
                    if (sha256.equals(Hashing.sha256(input))) {
                        return target;
                    }
                }
                throw new BusinessException(ErrorCode.STORAGE_WRITE_FAILED, "正式包路径已存在且 Hash 不一致");
            }
            Files.copy(tempPath, target);
            return target;
        } catch (BusinessException exception) {
            throw exception;
        } catch (IOException exception) {
            throw new BusinessException(ErrorCode.STORAGE_WRITE_FAILED, "正式包写入失败");
        }
    }

    public Path safeResolve(Path base, String... parts) {
        Path root = base.toAbsolutePath().normalize();
        Path resolved = root;
        for (String part : parts) {
            resolved = resolved.resolve(part);
        }
        resolved = resolved.normalize();
        if (!resolved.startsWith(root)) {
            throw new BusinessException(ErrorCode.PACKAGE_PATH_TRAVERSAL, "存储路径不安全");
        }
        return resolved;
    }

    private String sanitizeFilename(String original) {
        String value = StringUtils.hasText(original) ? Path.of(original).getFileName().toString() : "upload.bin";
        value = value.replaceAll("[\\p{Cntrl}/\\\\]", "_");
        return value.isBlank() ? "upload.bin" : value;
    }

    public record StoredTempFile(Path path, String originalFilename, long size, String sha256) {}
}
