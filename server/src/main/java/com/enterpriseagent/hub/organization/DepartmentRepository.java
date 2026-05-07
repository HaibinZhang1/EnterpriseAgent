package com.enterpriseagent.hub.organization;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface DepartmentRepository extends JpaRepository<Department, UUID> {
    List<Department> findByStatusNot(DepartmentStatus status);
    List<Department> findByParentIdAndStatusNot(UUID parentId, DepartmentStatus status);
    boolean existsByParentIdAndStatusNot(UUID parentId, DepartmentStatus status);
    boolean existsByNameIgnoreCaseAndParentIdAndStatusNot(String name, UUID parentId, DepartmentStatus status);
    Optional<Department> findByIdAndStatusNot(UUID id, DepartmentStatus status);
    long countByParentIdAndStatusNot(UUID parentId, DepartmentStatus status);
}
