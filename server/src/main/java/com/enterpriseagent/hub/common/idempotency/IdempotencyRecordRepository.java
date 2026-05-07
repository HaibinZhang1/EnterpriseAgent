package com.enterpriseagent.hub.common.idempotency;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

import jakarta.persistence.LockModeType;

public interface IdempotencyRecordRepository extends JpaRepository<IdempotencyRecord, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<IdempotencyRecord> findByActorIdAndOperationAndIdempotencyKey(UUID actorId, String operation,
            String idempotencyKey);
}
