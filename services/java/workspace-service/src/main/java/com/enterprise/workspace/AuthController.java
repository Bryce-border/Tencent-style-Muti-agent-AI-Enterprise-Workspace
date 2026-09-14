package com.enterprise.workspace;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import com.enterprise.workspace.IdentityService.Identity;

@RestController
@RequestMapping("/auth")
public class AuthController {
    private final IdentityService identities;
    private final SessionSecurity sessions;
    public AuthController(IdentityService identities, SessionSecurity sessions) { this.identities=identities; this.sessions=sessions; }
    public record Credentials(String username,String password,String workspace_name) {}
    @PostMapping("/register") Object register(@RequestBody Credentials body,HttpServletResponse res) {
        var identity=identities.register(body.username(),body.password(),body.workspace_name());
        sessions.issue(identity,res); return identities.profile(identity);
    }
    @PostMapping("/login") Object login(@RequestBody Credentials body,HttpServletResponse res) {
        var identity=identities.login(body.username(),body.password());
        sessions.issue(identity,res); return identities.profile(identity);
    }
    @GetMapping("/me") Object me(@AuthenticationPrincipal Identity identity) { return identities.profile(identity); }
    @PostMapping("/logout") Object logout(HttpServletRequest req,HttpServletResponse res) { sessions.revoke(req,res); return Map.of("ok",true); }
    @PostMapping("/workspace") Object switchSpace(@AuthenticationPrincipal Identity identity,@RequestBody Map<String,String> body,HttpServletRequest req,HttpServletResponse res) {
        var next=identities.identity(identity.userId(),body.get("workspace_id"));
        sessions.invalidate(req); sessions.issue(next,res); return identities.profile(next);
    }
}
