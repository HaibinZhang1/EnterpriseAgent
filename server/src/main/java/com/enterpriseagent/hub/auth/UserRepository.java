package com.enterpriseagent.hub.auth;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

public interface UserRepository extends JpaRepository<User, UUID> {
    Optional<User> findByPhoneAndStatusNot(String phone, UserStatus status);
    Optional<User> findByIdAndStatusNot(UUID id, UserStatus status);
    boolean existsByPhoneAndStatusNot(String phone, UserStatus status);
    long countByDepartmentIdAndStatusNot(UUID departmentId, UserStatus status);
    long countByDepartmentIdAndStatus(UUID departmentId, UserStatus status);
    List<User> findByDepartmentIdAndStatusNot(UUID departmentId, UserStatus status);
    List<User> findByDepartmentIdInAndStatusNot(Set<UUID> departmentIds, UserStatus status);
    List<User> findByRoleAndStatus(Role role, UserStatus status);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from User u where u.role = :role and u.status = :status")
    List<User> lockByRoleAndStatus(@Param("role") Role role, @Param("status") UserStatus status);
}
