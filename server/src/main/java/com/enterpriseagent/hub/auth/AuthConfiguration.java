package com.enterpriseagent.hub.auth;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties({AuthProperties.class, PasswordPolicyProperties.class})
public class AuthConfiguration {
}
