FROM public.ecr.aws/docker/library/maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /workspace
COPY server/pom.xml server/pom.xml
COPY server/src server/src
RUN mvn -f server/pom.xml -DskipTests package

FROM public.ecr.aws/amazoncorretto/amazoncorretto:21-al2023-headless
WORKDIR /app
COPY --from=build /workspace/server/target/enterprise-agent-hub-server.jar /app/enterprise-agent-hub-server.jar
COPY scripts/healthcheck.sh /app/healthcheck.sh
RUN chmod +x /app/healthcheck.sh
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=5 CMD ["/app/healthcheck.sh"]
ENTRYPOINT ["java", "-jar", "/app/enterprise-agent-hub-server.jar"]
