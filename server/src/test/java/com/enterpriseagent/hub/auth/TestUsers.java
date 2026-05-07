package com.enterpriseagent.hub.auth;

import java.time.OffsetDateTime;
import java.util.UUID;

import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

final class TestUsers {
    static final UUID ROOT_DEPARTMENT_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final BCryptPasswordEncoder ENCODER = new BCryptPasswordEncoder();

    private TestUsers() {
    }

    static User createNormalUser(UserRepository repository, String phone, String password) {
        User user = new User("测试用户" + phone.substring(phone.length() - 4), phone,
                ENCODER.encode(password), "BCRYPT", ROOT_DEPARTMENT_ID, Role.NORMAL_USER);
        user.setPasswordChangedAt(OffsetDateTime.now());
        return repository.save(user);
    }
}
