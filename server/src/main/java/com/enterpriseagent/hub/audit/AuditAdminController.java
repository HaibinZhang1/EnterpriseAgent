package com.enterpriseagent.hub.audit;

import java.util.Map;
import java.util.UUID;

import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.enterpriseagent.hub.auth.CurrentUserProvider;
import com.enterpriseagent.hub.common.api.ApiResponse;
import com.enterpriseagent.hub.common.pagination.PageResult;

@RestController
@RequestMapping("/api/admin/audit-logs")
public class AuditAdminController {
    private final AuditQueryService service;
    private final CurrentUserProvider currentUserProvider;

    public AuditAdminController(AuditQueryService service, CurrentUserProvider currentUserProvider) {
        this.service = service;
        this.currentUserProvider = currentUserProvider;
    }

    @GetMapping
    public ApiResponse<PageResult<Map<String, Object>>> query(@RequestParam(required = false) String requestId,
            @RequestParam(required = false) UUID actorId,
            @RequestParam(required = false) String deviceId,
            @RequestParam(required = false) String objectType,
            @RequestParam(required = false) String objectId,
            @RequestParam(required = false) String action,
            @RequestParam(required = false) String result,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return ApiResponse.success(service.query(currentUserProvider.requireCurrentUser(), new AuditQueryService.Query(
                requestId, actorId, deviceId, objectType, objectId, action, result, from, to, page, pageSize)));
    }

    @GetMapping(value = "/export", produces = "text/csv")
    public ResponseEntity<String> export(@RequestParam(required = false) String requestId,
            @RequestParam(required = false) UUID actorId,
            @RequestParam(required = false) String deviceId,
            @RequestParam(required = false) String objectType,
            @RequestParam(required = false) String objectId,
            @RequestParam(required = false) String action,
            @RequestParam(required = false) String result,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to) {
        String csv = service.exportCsv(currentUserProvider.requireCurrentUser(), new AuditQueryService.Query(
                requestId, actorId, deviceId, objectType, objectId, action, result, from, to, 1, 100));
        return ResponseEntity.ok()
                .contentType(new MediaType("text", "csv"))
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename("audit-logs.csv").build().toString())
                .body(csv);
    }
}
