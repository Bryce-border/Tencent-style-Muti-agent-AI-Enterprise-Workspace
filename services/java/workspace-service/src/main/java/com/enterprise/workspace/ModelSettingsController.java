package com.enterprise.workspace;

import com.enterprise.workspace.IdentityService.Identity;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/v1/model-settings")
public class ModelSettingsController {
    private final ModelSettingsService settings;
    public ModelSettingsController(ModelSettingsService settings) {this.settings=settings;}
    @GetMapping Object get(@AuthenticationPrincipal Identity actor) {return settings.publicView(actor.workspaceId());}
    @PutMapping Object put(@AuthenticationPrincipal Identity actor,@RequestBody JsonNode body) {return settings.save(actor,body);}
    @DeleteMapping Object reset(@AuthenticationPrincipal Identity actor) {return settings.reset(actor);}
    @PostMapping("/test") Object test(@AuthenticationPrincipal Identity actor,@RequestBody JsonNode body) {return settings.test(actor,body);}
}
