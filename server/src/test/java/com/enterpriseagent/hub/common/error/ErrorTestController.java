package com.enterpriseagent.hub.common.error;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/test/errors")
@Profile("test")
class ErrorTestController {

    @GetMapping("/business")
    void business() {
        throw new BusinessException(ErrorCode.STATE_CONFLICT, "状态冲突");
    }

    @GetMapping("/unexpected")
    void unexpected() {
        throw new IllegalStateException("sensitive stack details");
    }

    @PostMapping("/validation")
    void validation(@Valid @RequestBody TestRequest request) {
    }

    record TestRequest(@NotBlank String name) {
    }
}
