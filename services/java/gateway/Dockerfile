FROM eclipse-temurin:21-jre
WORKDIR /app
COPY target/workspace-gateway-0.3.0.jar app.jar
USER 10001
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70", "-jar", "/app/app.jar"]
