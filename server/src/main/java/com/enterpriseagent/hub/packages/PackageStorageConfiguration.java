package com.enterpriseagent.hub.packages;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(PackageStorageProperties.class)
public class PackageStorageConfiguration {
}
