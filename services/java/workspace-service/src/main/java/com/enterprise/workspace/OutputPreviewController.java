package com.enterprise.workspace;
import com.enterprise.workspace.IdentityService.Identity;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/v1/conversations/{id}")
public class OutputPreviewController {
    private final OutputPreviewService service;
    public OutputPreviewController(OutputPreviewService service) { this.service=service; }
    @PostMapping("/preview") Object generate(@AuthenticationPrincipal Identity a,@PathVariable String id,@RequestBody JsonNode b) { return service.generate(a,id,b); }
    @PutMapping("/preview") Object edit(@AuthenticationPrincipal Identity a,@PathVariable String id,@RequestBody JsonNode b) { return service.edit(a,id,b); }
    @PostMapping("/approve") Object approve(@AuthenticationPrincipal Identity a,@PathVariable String id,@RequestBody JsonNode b) { return service.approve(a,id,b.path("revision").asInt(-1)); }
}
