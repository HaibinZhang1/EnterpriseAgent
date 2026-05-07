package com.enterpriseagent.hub.auth;

import java.time.OffsetDateTime;
import java.util.Locale;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import com.enterpriseagent.hub.common.error.BusinessException;
import com.enterpriseagent.hub.common.error.ErrorCode;

@Service
public class PasswordService {
    public static final String ALGORITHM = "BCRYPT";
    private final PasswordEncoder encoder;
    private final PasswordPolicyProperties policy;

    public PasswordService(PasswordEncoder encoder, PasswordPolicyProperties policy) {
        this.encoder = encoder;
        this.policy = policy;
    }

    public String hash(String rawPassword) {
        validate(rawPassword);
        return encoder.encode(rawPassword);
    }

    public boolean matches(String rawPassword, String hash) {
        return encoder.matches(rawPassword, hash);
    }

    public void applyNewPassword(User user, String rawPassword, boolean mustChangePassword) {
        user.setPasswordHash(hash(rawPassword));
        user.setPasswordAlgo(ALGORITHM);
        user.setPasswordChangedAt(OffsetDateTime.now());
        user.setMustChangePassword(mustChangePassword);
    }

    public void validate(String rawPassword) {
        if (rawPassword == null || rawPassword.length() < policy.minLength()) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "密码长度不足");
        }
        String lower = rawPassword.toLowerCase(Locale.ROOT);
        if (policy.weakPasswords().stream().anyMatch(lower::contains)) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "密码过于简单");
        }
        if (policy.requireLetter() && rawPassword.chars().noneMatch(Character::isLetter)) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "密码必须包含字母");
        }
        if (policy.requireDigit() && rawPassword.chars().noneMatch(Character::isDigit)) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "密码必须包含数字");
        }
        if (policy.requireSpecial() && rawPassword.chars().allMatch(Character::isLetterOrDigit)) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "密码必须包含特殊字符");
        }
    }
}
