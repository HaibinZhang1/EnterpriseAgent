package com.enterpriseagent.hub.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import com.enterpriseagent.hub.PostgresIntegrationTestBase;

@AutoConfigureMockMvc
class HealthControllerTests extends PostgresIntegrationTestBase {
    @Autowired
    private MockMvc mockMvc;

    @Test
    void healthEndpointReturnsServiceAndDatabaseState() throws Exception {
        mockMvc.perform(get("/api/health").header("X-Request-ID", "req_health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requestId").value("req_health"))
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.status").value("UP"))
                .andExpect(jsonPath("$.data.appName").value("enterprise-agent-hub-server"))
                .andExpect(jsonPath("$.data.database.up").value(true));
    }
}
