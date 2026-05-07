package com.enterpriseagent.hub.common.error;

import java.util.List;
import java.util.Map;

import jakarta.validation.ConstraintViolationException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import com.enterpriseagent.hub.common.api.ApiResponse;
import com.enterpriseagent.hub.common.request.RequestContext;

@RestControllerAdvice
public class GlobalExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ApiResponse<Void>> handleBusiness(BusinessException exception) {
        ErrorCode code = exception.errorCode();
        return ResponseEntity.status(code.httpStatus())
                .body(ApiResponse.error(code, exception.getMessage(), exception.details()));
    }

    @ExceptionHandler({MethodArgumentNotValidException.class})
    public ResponseEntity<ApiResponse<Void>> handleMethodArgumentNotValid(MethodArgumentNotValidException exception) {
        List<Map<String, String>> details = exception.getBindingResult().getFieldErrors().stream()
                .map(this::toFieldDetail)
                .toList();
        return validationResponse(details);
    }

    @ExceptionHandler({ConstraintViolationException.class, MissingServletRequestParameterException.class,
            MethodArgumentTypeMismatchException.class})
    public ResponseEntity<ApiResponse<Void>> handleValidation(Exception exception) {
        return validationResponse(Map.of("reason", exception.getMessage()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleUnexpected(Exception exception) {
        log.error("Unhandled server error requestId={}", RequestContext.requireRequestId(), exception);
        return ResponseEntity.status(ErrorCode.INTERNAL_ERROR.httpStatus())
                .body(ApiResponse.error(ErrorCode.INTERNAL_ERROR, "服务内部错误", null));
    }

    private ResponseEntity<ApiResponse<Void>> validationResponse(Object details) {
        return ResponseEntity.status(ErrorCode.VALIDATION_FAILED.httpStatus())
                .body(ApiResponse.error(ErrorCode.VALIDATION_FAILED, "参数校验失败", details));
    }

    private Map<String, String> toFieldDetail(FieldError error) {
        return Map.of(
                "field", error.getField(),
                "reason", error.getDefaultMessage() == null ? "invalid" : error.getDefaultMessage());
    }
}
