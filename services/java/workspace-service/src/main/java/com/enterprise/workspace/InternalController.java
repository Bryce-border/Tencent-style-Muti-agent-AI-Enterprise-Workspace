package com.enterprise.workspace;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/internal")
public class InternalController {
    private final TaskRepository tasks;
    private final ModelSettingsService models;
    public InternalController(TaskRepository tasks,ModelSettingsService models) { this.tasks=tasks; this.models=models; }
    @GetMapping("/tasks/{id}/model-settings") Object model(@PathVariable String id,@RequestHeader("X-Lease-Token") String token) {
        if(!tasks.heartbeat(id,token)) throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.CONFLICT,"执行租约无效");
        return models.resolved(tasks.get(id).path("workspace_id").asText());
    }
    @GetMapping("/tasks/{id}") Object get(@PathVariable String id) { return tasks.get(id); }
    @PostMapping("/tasks/{id}/claim") Object claim(@PathVariable String id,@RequestHeader("X-Lease-Token") String token) { return Map.of("ok",tasks.claim(id,token)); }
    @PostMapping("/tasks/{id}/heartbeat") Object heartbeat(@PathVariable String id,@RequestHeader("X-Lease-Token") String token) { return Map.of("ok",tasks.heartbeat(id,token)); }
    @PutMapping("/tasks/{id}") Object save(@PathVariable String id,@RequestHeader("X-Lease-Token") String token,@RequestBody ObjectNode task) { return Map.of("ok",tasks.save(id,token,task)); }
    @PutMapping("/tasks/{id}/plan") Object plan(@PathVariable String id,@RequestHeader("X-Lease-Token") String token,@RequestBody JsonNode plan) { return Map.of("ok",tasks.plan(id,token,plan)); }
    @PostMapping("/tasks/{id}/events") Object event(@PathVariable String id,@RequestHeader("X-Lease-Token") String token,@RequestBody JsonNode event) { return Map.of("ok",tasks.workerEvent(id,token,event.path("type").asText(),event.path("payload"))); }
    @PostMapping("/migration") Object migrate(@RequestBody JsonNode payload) { return tasks.migrate(payload); }
}
