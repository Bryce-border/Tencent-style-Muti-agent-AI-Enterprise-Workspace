package com.enterprise.workspace;

import com.enterprise.workspace.IdentityService.Identity;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
public class ConversationController {
    private final ConversationService conversations;
    public ConversationController(ConversationService conversations) { this.conversations=conversations; }
    @GetMapping("/v1/conversations") Object list(@AuthenticationPrincipal Identity a) { return conversations.list(a); }
    @PostMapping("/v1/conversations") Object create(@AuthenticationPrincipal Identity a,@RequestBody Map<String,String> b) {
        return conversations.create(a,b.getOrDefault("title","新会话"),b.getOrDefault("employee_id","ai_assistant"));
    }
    @GetMapping("/v1/conversations/{id}") Object detail(@AuthenticationPrincipal Identity a,@PathVariable String id) { return conversations.detail(a,id); }
    @PatchMapping("/v1/conversations/{id}") Object update(@AuthenticationPrincipal Identity a,@PathVariable String id,@RequestBody com.fasterxml.jackson.databind.JsonNode b) {
        return conversations.update(a,id,b.hasNonNull("title")?b.path("title").asText():null,b.hasNonNull("archived")?b.path("archived").asBoolean():null);
    }
    @PostMapping("/v1/conversations/{id}/turns") @ResponseStatus(org.springframework.http.HttpStatus.ACCEPTED)
    Object submit(@AuthenticationPrincipal Identity a,@PathVariable String id,@RequestBody Map<String,String> b,@RequestHeader("Idempotency-Key") String key) { return conversations.submit(a,id,b.get("prompt"),key); }
    @GetMapping("/v1/memories") Object memories(@AuthenticationPrincipal Identity a,@RequestParam(defaultValue="ai_assistant") String employee_id) { return conversations.memories(a,employee_id); }
    @PostMapping("/v1/memories") Object remember(@AuthenticationPrincipal Identity a,@RequestBody Map<String,String> b) {
        return conversations.remember(a,b.getOrDefault("employee_id","ai_assistant"),b.getOrDefault("kind","preference"),b.get("content"),b.get("source_task_id"));
    }
    @DeleteMapping("/v1/memories/{id}") Object forget(@AuthenticationPrincipal Identity a,@PathVariable String id) { conversations.forget(a,id); return Map.of("ok",true); }
    @PatchMapping("/v1/memories/{id}") Object updateMemory(@AuthenticationPrincipal Identity a,@PathVariable String id,@RequestBody com.fasterxml.jackson.databind.JsonNode b) {
        return conversations.updateMemory(a,id,b.hasNonNull("content")?b.path("content").asText():null,b.hasNonNull("enabled")?b.path("enabled").asBoolean():null);
    }
    @GetMapping("/internal/tasks/{id}/context") Object context(@PathVariable String id,@RequestHeader("X-Lease-Token") String lease) { return conversations.context(id,lease); }
}
