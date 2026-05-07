package com.enterpriseagent.hub.organization;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.stereotype.Service;

import com.enterpriseagent.hub.auth.Role;
import com.enterpriseagent.hub.auth.UserRepository;
import com.enterpriseagent.hub.auth.UserStatus;
import com.enterpriseagent.hub.organization.dto.DepartmentTreeDto;

@Service
public class DepartmentTreeService {
    private final DepartmentRepository departmentRepository;
    private final UserRepository userRepository;

    public DepartmentTreeService(DepartmentRepository departmentRepository, UserRepository userRepository) {
        this.departmentRepository = departmentRepository;
        this.userRepository = userRepository;
    }

    public boolean isSelfOrDescendant(UUID ancestorId, UUID candidateId) {
        if (ancestorId == null || candidateId == null) {
            return false;
        }
        if (ancestorId.equals(candidateId)) {
            return true;
        }
        return isStrictDescendant(ancestorId, candidateId);
    }

    public boolean isStrictDescendant(UUID ancestorId, UUID candidateId) {
        UUID cursor = candidateId;
        Set<UUID> seen = new HashSet<>();
        while (cursor != null && seen.add(cursor)) {
            Department department = departmentRepository.findById(cursor).orElse(null);
            if (department == null) {
                return false;
            }
            cursor = department.getParentId();
            if (ancestorId.equals(cursor)) {
                return true;
            }
        }
        return false;
    }

    public Set<UUID> selfAndDescendantIds(UUID rootId, boolean includeDisabled) {
        Set<UUID> ids = new HashSet<>();
        collect(rootId, includeDisabled, ids);
        return ids;
    }

    private void collect(UUID rootId, boolean includeDisabled, Set<UUID> ids) {
        Department root = departmentRepository.findById(rootId).orElse(null);
        if (root == null || root.getStatus() == DepartmentStatus.DELETED) {
            return;
        }
        if (includeDisabled || root.getStatus() == DepartmentStatus.ACTIVE) {
            ids.add(rootId);
            for (Department child : departmentRepository.findByParentIdAndStatusNot(rootId, DepartmentStatus.DELETED)) {
                collect(child.getId(), includeDisabled, ids);
            }
        }
    }

    public List<String> pathNames(UUID departmentId) {
        List<String> names = new ArrayList<>();
        UUID cursor = departmentId;
        Set<UUID> seen = new HashSet<>();
        while (cursor != null && seen.add(cursor)) {
            Department department = departmentRepository.findById(cursor).orElse(null);
            if (department == null) break;
            names.add(0, department.getName());
            cursor = department.getParentId();
        }
        return names;
    }

    public List<DepartmentTreeDto> buildTree(Set<UUID> visibleIds, boolean includeDisabled) {
        List<Department> departments = departmentRepository.findByStatusNot(DepartmentStatus.DELETED).stream()
                .filter(d -> visibleIds.contains(d.getId()))
                .filter(d -> includeDisabled || d.getStatus() == DepartmentStatus.ACTIVE)
                .toList();
        Map<UUID, List<Department>> byParent = new java.util.HashMap<>();
        departments.forEach(department -> byParent
                .computeIfAbsent(department.getParentId(), ignored -> new ArrayList<>())
                .add(department));
        return departments.stream()
                .filter(d -> d.getParentId() == null || !visibleIds.contains(d.getParentId()))
                .map(d -> toTree(d, byParent))
                .toList();
    }

    private DepartmentTreeDto toTree(Department department, Map<UUID, List<Department>> byParent) {
        long userCount = userRepository.countByDepartmentIdAndStatusNot(department.getId(), UserStatus.DELETED);
        long activeUserCount = userRepository.countByDepartmentIdAndStatus(department.getId(), UserStatus.ACTIVE);
        long adminCount = userRepository.findByDepartmentIdAndStatusNot(department.getId(), UserStatus.DELETED).stream()
                .filter(user -> user.getRole() == Role.DEPARTMENT_ADMIN && user.getStatus() == UserStatus.ACTIVE)
                .count();
        List<DepartmentTreeDto> children = byParent.getOrDefault(department.getId(), List.of()).stream()
                .map(child -> toTree(child, byParent))
                .toList();
        return new DepartmentTreeDto(department.getId(), department.getName(), department.getParentId(),
                department.getStatus(), pathNames(department.getId()), userCount, activeUserCount, adminCount, 0, children);
    }
}
