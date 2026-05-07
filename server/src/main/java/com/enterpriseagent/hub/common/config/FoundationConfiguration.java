package com.enterpriseagent.hub.common.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

import com.enterpriseagent.hub.common.request.RequestIdProperties;

@Configuration
@EnableConfigurationProperties(RequestIdProperties.class)
public class FoundationConfiguration {
}
