package com.enterpriseagent.hub.packages;

import java.util.Map;

import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.enterpriseagent.hub.auth.CurrentUserProvider;
import com.enterpriseagent.hub.common.api.ApiResponse;

@RestController
@RequestMapping("/api")
public class DownloadTicketController {
    private final DownloadTicketService service;
    private final CurrentUserProvider currentUserProvider;

    public DownloadTicketController(DownloadTicketService service, CurrentUserProvider currentUserProvider) {
        this.service = service;
        this.currentUserProvider = currentUserProvider;
    }

    @PostMapping("/download-tickets")
    public ApiResponse<Map<String, Object>> issue(@RequestBody DownloadTicketRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return ApiResponse.success(service.issue(currentUserProvider.requireCurrentUser(), request, idempotencyKey));
    }

    @GetMapping("/packages/download")
    public ResponseEntity<Resource> download(@RequestParam("ticket") String ticket) {
        return response(service.authorizeDownload(currentUserProvider.requireCurrentUser(), ticket));
    }

    @GetMapping("/download-tickets/{ticket}/download")
    public ResponseEntity<Resource> downloadAlias(@PathVariable String ticket) {
        return response(service.authorizeDownload(currentUserProvider.requireCurrentUser(), ticket));
    }

    private ResponseEntity<Resource> response(DownloadTicketService.DownloadFile file) {
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .contentLength(file.size())
                .header("X-Package-SHA256", file.sha256())
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(file.filename(), java.nio.charset.StandardCharsets.UTF_8).build().toString())
                .body(file.resource());
    }
}
