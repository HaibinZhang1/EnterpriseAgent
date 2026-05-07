package com.enterpriseagent.hub.common.request;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.test.web.servlet.MockMvc;

import com.enterpriseagent.hub.PostgresIntegrationTestBase;

@AutoConfigureMockMvc
class RequestIdFilterTests extends PostgresIntegrationTestBase {
    @Autowired
    private MockMvc mockMvc;

    @Test
    void preservesClientRequestIdInResponseHeaderAndBody() throws Exception {
        var response = mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/health")
                        .header(RequestContext.DEFAULT_REQUEST_ID_HEADER, "req_client_123"))
                .andReturn()
                .getResponse();

        assertThat(response.getHeader(RequestContext.DEFAULT_REQUEST_ID_HEADER)).isEqualTo("req_client_123");
        assertThat(response.getContentAsString()).contains("\"requestId\":\"req_client_123\"");
    }

    @Test
    void generatesRequestIdWhenHeaderIsMissing() throws Exception {
        var response = mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/health"))
                .andReturn()
                .getResponse();

        assertThat(response.getHeader(HttpHeaders.CONTENT_TYPE)).contains("application/json");
        assertThat(response.getHeader(RequestContext.DEFAULT_REQUEST_ID_HEADER)).startsWith("req_");
        assertThat(response.getContentAsString()).contains("\"requestId\":\"req_");
    }
}
