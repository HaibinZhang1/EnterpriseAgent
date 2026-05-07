package com.enterpriseagent.hub.auth;

import java.time.OffsetDateTime;
import java.util.UUID;

import org.springframework.stereotype.Service;

@Service
public class LoginAttemptService {
    private final LoginAttemptRepository repository;
    private final AuthProperties properties;

    public LoginAttemptService(LoginAttemptRepository repository, AuthProperties properties) {
        this.repository = repository;
        this.properties = properties;
    }

    public void record(String phone, UUID userId, String ip, String userAgent, LoginAttemptResult result,
            String failureReason) {
        repository.save(new LoginAttempt(phone, userId, ip, userAgent, result, failureReason));
    }

    public boolean isThrottled(String phone, String ip) {
        OffsetDateTime after = OffsetDateTime.now().minus(properties.loginFailureWindow());
        return repository.countByPhoneAndIpAndResultAndCreatedAtAfter(phone, ip, LoginAttemptResult.FAILED, after)
                >= properties.maxLoginFailures();
    }
}
