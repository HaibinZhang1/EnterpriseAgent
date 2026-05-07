package com.enterpriseagent.hub.auth;

import java.util.UUID;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.enterpriseagent.hub.organization.Department;
import com.enterpriseagent.hub.organization.DepartmentRepository;
import com.enterpriseagent.hub.organization.DepartmentStatus;

@Component
@Profile("test")
public class TestProfileDataSeeder implements ApplicationRunner {
    public static final UUID ROOT_DEPARTMENT_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    public static final String ADMIN_PHONE = "13800000000";
    public static final String ADMIN_PASSWORD = "Admin#123456";

    private final DepartmentRepository departmentRepository;
    private final UserRepository userRepository;
    private final PasswordService passwordService;
    private final JdbcTemplate jdbcTemplate;

    public TestProfileDataSeeder(DepartmentRepository departmentRepository, UserRepository userRepository,
            PasswordService passwordService, JdbcTemplate jdbcTemplate) {
        this.departmentRepository = departmentRepository;
        this.userRepository = userRepository;
        this.passwordService = passwordService;
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        jdbcTemplate.update("""
                insert into departments (id, name, parent_id, status, created_at, updated_at)
                values (?, '测试根部门', null, 'ACTIVE', now(), now())
                on conflict (id) do nothing
                """, ROOT_DEPARTMENT_ID);
        Department root = departmentRepository.findById(ROOT_DEPARTMENT_ID).orElseThrow();
        if (root.getStatus() != DepartmentStatus.ACTIVE) {
            root.setStatus(DepartmentStatus.ACTIVE);
        }
        User admin = userRepository.findByPhoneAndStatusNot(ADMIN_PHONE, UserStatus.DELETED).orElseGet(() -> {
            User created = new User("测试系统管理员", ADMIN_PHONE, passwordService.hash(ADMIN_PASSWORD),
                    PasswordService.ALGORITHM, ROOT_DEPARTMENT_ID, Role.SYSTEM_ADMIN);
            created.setMustChangePassword(false);
            return userRepository.save(created);
        });
        admin.setStatus(UserStatus.ACTIVE);
        admin.setRole(Role.SYSTEM_ADMIN);
        admin.setDepartmentId(ROOT_DEPARTMENT_ID);
        admin.setLockedUntil(null);
        admin.setMustChangePassword(false);
    }
}
