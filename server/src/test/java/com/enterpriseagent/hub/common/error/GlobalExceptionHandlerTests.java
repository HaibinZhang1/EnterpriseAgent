package com.enterpriseagent.hub.common.error;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import com.enterpriseagent.hub.PostgresIntegrationTestBase;

@AutoConfigureMockMvc
class GlobalExceptionHandlerTests extends PostgresIntegrationTestBase {
    @Autowired
    private MockMvc mockMvc;

    @Test
    void businessExceptionUsesStableErrorEnvelope() throws Exception {
        mockMvc.perform(get("/api/test/errors/business").header("X-Request-ID", "req_error_business"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.requestId").value("req_error_business"))
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("state_conflict"));
    }

    @Test
    void validationExceptionReturnsValidationFailed() throws Exception {
        mockMvc.perform(post("/api/test/errors/validation")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("validation_failed"));
    }

    @Test
    void unexpectedExceptionDoesNotExposeStackDetails() throws Exception {
        mockMvc.perform(get("/api/test/errors/unexpected").header("X-Request-ID", "req_error_unexpected"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.requestId").value("req_error_unexpected"))
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("internal_error"))
                .andExpect(jsonPath("$.error.details.interfaceName").value("GET /api/test/errors/unexpected"))
                .andExpect(jsonPath("$.error.details.requestId").value("req_error_unexpected"))
                .andExpect(jsonPath("$.error.details.resourceId").value("unexpected"))
                .andExpect(jsonPath("$.error.details.nextStep").isNotEmpty());
    }
}
