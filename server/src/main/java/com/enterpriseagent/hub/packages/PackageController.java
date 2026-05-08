package com.enterpriseagent.hub.packages;

import java.util.Map;
import java.util.UUID;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.jdbc.core.JdbcTemplate;

import com.enterpriseagent.hub.auth.CurrentUserProvider;
import com.enterpriseagent.hub.common.api.ApiResponse;
import com.enterpriseagent.hub.common.error.BusinessException;
import com.enterpriseagent.hub.common.error.ErrorCode;

@RestController
@RequestMapping("/api")
public class PackageController {
    private final PackageUploadService uploadService;
    private final CurrentUserProvider currentUserProvider;
    private final JdbcTemplate jdbc;

    public PackageController(PackageUploadService uploadService, CurrentUserProvider currentUserProvider, JdbcTemplate jdbc) {
        this.uploadService = uploadService;
        this.currentUserProvider = currentUserProvider;
        this.jdbc = jdbc;
    }

    @PostMapping({"/uploads/package", "/packages/upload"})
    public ApiResponse<Map<String, Object>> upload(@RequestParam UploadType uploadType,
            @RequestParam("file") MultipartFile file) {
        return ApiResponse.success(uploadService.upload(currentUserProvider.requireCurrentUser(), uploadType, file));
    }

    @DeleteMapping("/uploads/{tempUploadId}")
    public ApiResponse<Map<String, Object>> deleteTemp(@PathVariable UUID tempUploadId) {
        var actor = currentUserProvider.requireCurrentUser();
        int updated = jdbc.update("""
                update temp_uploads set status = 'EXPIRED' where id = ? and created_by = ? and status = 'AVAILABLE'
                """, tempUploadId, actor.id());
        if (updated == 0) {
            throw new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "临时上传不存在或不可删除");
        }
        return ApiResponse.success(Map.of("tempUploadId", tempUploadId, "status", "EXPIRED"));
    }

    @GetMapping("/packages/{packageId}/files")
    public ApiResponse<Map<String, Object>> files(@PathVariable UUID packageId) {
        return ApiResponse.success(uploadService.files(currentUserProvider.requireCurrentUser(), packageId));
    }

    @GetMapping("/packages/{packageId}/preview")
    public ApiResponse<Map<String, Object>> preview(@PathVariable UUID packageId, @RequestParam("path") String path) {
        return ApiResponse.success(uploadService.preview(currentUserProvider.requireCurrentUser(), packageId, path));
    }

    @GetMapping("/admin/packages/{packageId}/risk-summary")
    public ApiResponse<Map<String, Object>> riskSummary(@PathVariable UUID packageId) {
        return ApiResponse.success(uploadService.riskSummary(currentUserProvider.requireCurrentUser(), packageId));
    }
}
