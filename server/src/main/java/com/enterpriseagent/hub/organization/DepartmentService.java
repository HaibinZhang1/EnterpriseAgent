package com.enterpriseagent.hub.organization;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.enterpriseagent.hub.auth.CurrentUser;
import com.enterpriseagent.hub.auth.Role;
import com.enterpriseagent.hub.auth.SessionService;
import com.enterpriseagent.hub.auth.UserRepository;
import com.enterpriseagent.hub.auth.UserStatus;
import com.enterpriseagent.hub.common.audit.AuditRecord;
import com.enterpriseagent.hub.common.audit.AuditResult;
import com.enterpriseagent.hub.common.audit.AuditService;
import com.enterpriseagent.hub.common.error.BusinessException;
import com.enterpriseagent.hub.common.error.ErrorCode;
import com.enterpriseagent.hub.organization.dto.CreateDepartmentRequest;
import com.enterpriseagent.hub.organization.dto.DepartmentActionRequest;
import com.enterpriseagent.hub.organization.dto.DepartmentDto;
import com.enterpriseagent.hub.organization.dto.DepartmentTreeDto;
import com.enterpriseagent.hub.organization.dto.UpdateDepartmentRequest;

@Service
public class DepartmentService {
    private final DepartmentRepository departmentRepository;
    private final UserRepository userRepository;
    private final ManagementScopeService managementScopeService;
    private final DepartmentTreeService departmentTreeService;
    private final LastSystemAdminGuard lastSystemAdminGuard;
    private final SessionService sessionService;
    private final AuditService auditService;

    public DepartmentService(DepartmentRepository departmentRepository, UserRepository userRepository,
            ManagementScopeService managementScopeService, DepartmentTreeService departmentTreeService,
            LastSystemAdminGuard lastSystemAdminGuard, SessionService sessionService, AuditService auditService) {
        this.departmentRepository = departmentRepository;
        this.userRepository = userRepository;
        this.managementScopeService = managementScopeService;
        this.departmentTreeService = departmentTreeService;
        this.lastSystemAdminGuard = lastSystemAdminGuard;
        this.sessionService = sessionService;
        this.auditService = auditService;
    }

    @Transactional(readOnly = true)
    public java.util.List<DepartmentTreeDto> tree(CurrentUser actor, boolean includeDisabled, UUID rootDepartmentId) {
        requireAdmin(actor, "department.tree", rootDepartmentId);
        Set<UUID> visible = actor.isSystemAdmin()
                ? departmentRepository.findByStatusNot(DepartmentStatus.DELETED).stream().map(Department::getId).collect(java.util.stream.Collectors.toSet())
                : departmentTreeService.selfAndDescendantIds(actor.departmentId(), true);
        if (rootDepartmentId != null) {
            if (!managementScopeService.canViewDepartment(actor, rootDepartmentId)) {
                deny(actor, "department.tree", rootDepartmentId, "outside management scope");
            }
            visible.retainAll(departmentTreeService.selfAndDescendantIds(rootDepartmentId, true));
        }
        return departmentTreeService.buildTree(visible, includeDisabled);
    }

    @Transactional
    public DepartmentDto create(CurrentUser actor, CreateDepartmentRequest request) {
        if (!managementScopeService.canCreateDepartment(actor, request.parentId())) {
            deny(actor, "department.create", request.parentId(), "parent outside management scope");
        }
        if (request.parentId() != null) {
            Department parent = requireDepartment(request.parentId());
            if (parent.getStatus() != DepartmentStatus.ACTIVE) {
                throw new BusinessException(ErrorCode.DEPARTMENT_DISABLED, "上级部门不可用");
            }
        }
        if (departmentRepository.existsByNameIgnoreCaseAndParentIdAndStatusNot(request.name(), request.parentId(), DepartmentStatus.DELETED)) {
            throw new BusinessException(ErrorCode.VALIDATION_FAILED, "同级部门名称已存在");
        }
        Department department = departmentRepository.save(new Department(request.name(), request.parentId()));
        audit(actor, "department.create", department, AuditResult.SUCCESS, request.reason(), null,
                Map.of("parentId", request.parentId() == null ? "" : request.parentId().toString(), "status", department.getStatus().name()));
        return DepartmentDto.from(department);
    }

    @Transactional(readOnly = true)
    public DepartmentDto get(CurrentUser actor, UUID id) {
        requireAdmin(actor, "department.read", id);
        Department department = requireDepartment(id);
        if (!managementScopeService.canViewDepartment(actor, id)) deny(actor, "department.read", id, "outside management scope");
        return DepartmentDto.from(department);
    }

    @Transactional
    public DepartmentDto update(CurrentUser actor, UUID id, UpdateDepartmentRequest request) {
        Department department = requireDepartment(id);
        if (!managementScopeService.canManageDepartment(actor, id)) deny(actor, "department.update", id, "outside management scope");
        String before = department.getName();
        department.setName(request.name());
        audit(actor, "department.update", department, AuditResult.SUCCESS, request.reason(), Map.of("name", before),
                Map.of("name", department.getName()));
        return DepartmentDto.from(department);
    }

    @Transactional
    public DepartmentDto disable(CurrentUser actor, UUID id, DepartmentActionRequest request) {
        Department department = requireDepartment(id);
        if (!managementScopeService.canManageDepartment(actor, id)) deny(actor, "department.disable", id, "outside management scope");
        lastSystemAdminGuard.ensureDepartmentDisableKeepsSystemAdmin(id);
        department.setStatus(DepartmentStatus.DISABLED);
        userRepository.findByDepartmentIdAndStatusNot(id, UserStatus.DELETED).forEach(user -> sessionService.revokeAllForUser(user.getId(), "department_disabled"));
        audit(actor, "department.disable", department, AuditResult.SUCCESS, request == null ? null : request.reason(), null,
                Map.of("status", "DISABLED"));
        return DepartmentDto.from(department);
    }

    @Transactional
    public DepartmentDto enable(CurrentUser actor, UUID id, DepartmentActionRequest request) {
        Department department = requireDepartment(id);
        if (!managementScopeService.canManageDepartment(actor, id)) deny(actor, "department.enable", id, "outside management scope");
        department.setStatus(DepartmentStatus.ACTIVE);
        audit(actor, "department.enable", department, AuditResult.SUCCESS, request == null ? null : request.reason(), null,
                Map.of("status", "ACTIVE"));
        return DepartmentDto.from(department);
    }

    @Transactional
    public void delete(CurrentUser actor, UUID id, DepartmentActionRequest request) {
        Department department = requireDepartment(id);
        if (!managementScopeService.canManageDepartment(actor, id)) deny(actor, "department.delete", id, "outside management scope");
        long childCount = departmentRepository.countByParentIdAndStatusNot(id, DepartmentStatus.DELETED);
        long activeUserCount = userRepository.countByDepartmentIdAndStatusNot(id, UserStatus.DELETED);
        if (department.getStatus() != DepartmentStatus.DISABLED || childCount > 0 || activeUserCount > 0) {
            throw new BusinessException(ErrorCode.STATE_CONFLICT, "部门删除被阻塞",
                    Map.of("code", "department_delete_blocked", "childDepartmentCount", childCount,
                            "activeUserCount", activeUserCount, "activeExtensionCount", 0, "pendingSubmissionCount", 0));
        }
        department.setStatus(DepartmentStatus.DELETED);
        audit(actor, "department.delete", department, AuditResult.SUCCESS, request == null ? null : request.reason(), null,
                Map.of("status", "DELETED"));
    }

    private Department requireDepartment(UUID id) {
        return departmentRepository.findByIdAndStatusNot(id, DepartmentStatus.DELETED)
                .orElseThrow(() -> new BusinessException(ErrorCode.RESOURCE_NOT_FOUND, "部门不存在"));
    }

    private void requireAdmin(CurrentUser actor, String action, UUID objectId) {
        if (!actor.isAdmin()) {
            deny(actor, action, objectId, "admin role required");
        }
    }

    private void deny(CurrentUser actor, String action, UUID objectId, String reason) {
        auditService.recordFailure(AuditRecord.builder()
                .actorId(actor.id())
                .actorSnapshot(Map.of("name", actor.name(), "role", actor.role().name()))
                .objectType("department")
                .objectId(objectId == null ? null : objectId.toString())
                .action(action)
                .result(AuditResult.FAILURE)
                .reason(reason)
                .build());
        throw new BusinessException(ErrorCode.PERMISSION_DENIED, "无权执行该操作");
    }

    private void audit(CurrentUser actor, String action, Department department, AuditResult result, String reason,
            Map<String, Object> before, Map<String, Object> after) {
        auditService.record(AuditRecord.builder()
                .actorId(actor.id())
                .actorSnapshot(Map.of("name", actor.name(), "role", actor.role().name()))
                .actorDepartmentSnapshot(Map.of("departmentId", actor.departmentId().toString(), "departmentName", actor.departmentName()))
                .objectType("department")
                .objectId(department.getId().toString())
                .objectNameSnapshot(department.getName())
                .action(action)
                .result(result)
                .reason(reason)
                .beforeSummary(before)
                .afterSummary(after)
                .build());
    }
}
