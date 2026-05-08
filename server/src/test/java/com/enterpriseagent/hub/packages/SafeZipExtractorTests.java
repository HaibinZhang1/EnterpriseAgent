package com.enterpriseagent.hub.packages;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class SafeZipExtractorTests {
    @TempDir
    Path tempDir;

    @Test
    void validSkillPackageBuildsManifestPreviewAndRiskFindings() throws Exception {
        Path zip = zip("valid.zip",
                entry("SKILL.md", "---\nname: demo\n---\n# Demo"),
                entry("README.md", "apiKey=abcdefghijklmnopqrstuvwxyz\nhttps://example.invalid"),
                entry("scripts/install.ps1", "Write-Host hi"));
        PackageStorageProperties props = new PackageStorageProperties();
        props.setRoot(tempDir.resolve("storage"));
        SafeZipExtractResult result = new SafeZipExtractor(props, new SensitiveContentRedactor())
                .scan(zip, sha(zip), Files.size(zip));

        assertThat(result.rejected()).isFalse();
        assertThat(result.status()).isEqualTo(PackagePrecheckStatus.WARNING);
        assertThat(result.files()).extracting(FileManifestItem::path).contains("SKILL.md", "README.md", "scripts/install.ps1");
        assertThat(result.findings()).extracting(RiskFinding::code).contains("POSSIBLE_SECRET", "EXTERNAL_URL", "SCRIPT_FILE");
        assertThat(result.previews()).anySatisfy(preview -> {
            assertThat(preview.path()).isEqualTo("README.md");
            assertThat(preview.content()).contains("apiKey=***");
            assertThat(preview.content()).doesNotContain("abcdefghijklmnopqrstuvwxyz");
        });
    }

    @Test
    void rejectsTraversalAbsoluteWindowsAndReservedNames() throws Exception {
        assertRejects("traversal.zip", "../evil.txt", "package_path_traversal");
        assertRejects("absolute.zip", "/etc/passwd", "package_path_traversal");
        assertRejects("windows.zip", "C:\\evil.txt", "package_path_traversal");
        assertRejects("reserved.zip", "CON", "package_path_traversal");
    }

    @Test
    void rejectsFileCountAndUncompressedLimits() throws Exception {
        PackageStorageProperties props = new PackageStorageProperties();
        props.setRoot(tempDir.resolve("storage"));
        props.setMaxFileCount(1);
        Path zip = zip("count.zip", entry("SKILL.md", "ok"), entry("README.md", "ok"));
        SafeZipExtractResult result = new SafeZipExtractor(props, new SensitiveContentRedactor())
                .scan(zip, sha(zip), Files.size(zip));
        assertThat(result.rejected()).isTrue();
        assertThat(result.rejectCode()).isEqualTo("package_file_count_exceeded");

        props = new PackageStorageProperties();
        props.setRoot(tempDir.resolve("storage2"));
        props.setMaxUncompressedSize(5);
        zip = zip("bomb.zip", entry("SKILL.md", "123456789"));
        result = new SafeZipExtractor(props, new SensitiveContentRedactor()).scan(zip, sha(zip), Files.size(zip));
        assertThat(result.rejected()).isTrue();
        assertThat(result.rejectCode()).isEqualTo("package_uncompressed_size_exceeded");
    }

    private void assertRejects(String filename, String entryName, String code) throws Exception {
        Path zip = zip(filename, entry(entryName, "bad"));
        PackageStorageProperties props = new PackageStorageProperties();
        props.setRoot(tempDir.resolve("storage-" + filename));
        SafeZipExtractResult result = new SafeZipExtractor(props, new SensitiveContentRedactor())
                .scan(zip, sha(zip), Files.size(zip));
        assertThat(result.rejected()).isTrue();
        assertThat(result.rejectCode()).isEqualTo(code);
    }

    private Path zip(String filename, ZipContent... contents) throws Exception {
        Path zip = tempDir.resolve(filename);
        try (ZipOutputStream out = new ZipOutputStream(Files.newOutputStream(zip))) {
            for (ZipContent content : contents) {
                out.putNextEntry(new ZipEntry(content.name()));
                out.write(content.content().getBytes(java.nio.charset.StandardCharsets.UTF_8));
                out.closeEntry();
            }
        }
        return zip;
    }

    private String sha(Path path) throws Exception {
        try (var input = Files.newInputStream(path)) {
            return Hashing.sha256(input);
        }
    }

    private ZipContent entry(String name, String content) {
        return new ZipContent(name, content);
    }

    private record ZipContent(String name, String content) {}
}
