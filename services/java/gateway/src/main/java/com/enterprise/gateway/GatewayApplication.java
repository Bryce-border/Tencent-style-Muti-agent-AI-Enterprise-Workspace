package com.enterprise.gateway;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.gateway.route.RouteLocator;
import org.springframework.cloud.gateway.route.builder.RouteLocatorBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.beans.factory.annotation.Value;

@SpringBootApplication
public class GatewayApplication {
    public static void main(String[] args) { SpringApplication.run(GatewayApplication.class, args); }

    @Bean
    RouteLocator routes(RouteLocatorBuilder builder, @Value("${workspace.service-url}") String serviceUrl) {
        return builder.routes().route("workspace", r -> r.path("/auth/**", "/v1/**", "/health")
            .filters(f -> f.removeRequestHeader("X-Internal-Token").removeRequestHeader("X-Lease-Token")
                .removeRequestHeader("X-User-Id").removeRequestHeader("X-Workspace-Id"))
            .uri(serviceUrl)).build();
    }
}
