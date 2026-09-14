package com.enterprise.workspace;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.crypto.spec.SecretKeySpec;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.server.ResponseStatusException;

@Configuration
public class SessionSecurity {
    static final String COOKIE = "workspace_session";
    private final IdentityService identities;
    private final StringRedisTemplate redis;
    private final JwtEncoder encoder;
    private final JwtDecoder decoder;
    private final String internalToken;
    private final List<String> origins;
    private final boolean secure;
    private final ObjectMapper json;

    public SessionSecurity(IdentityService identities, StringRedisTemplate redis, ObjectMapper json,
            @Value("${workspace.jwt-secret}") String secret, @Value("${workspace.internal-token}") String token,
            @Value("${workspace.origins}") String origins, @Value("${workspace.cookie-secure}") boolean secure) {
        if (secret.length() < 32 || token.length() < 32) throw new IllegalArgumentException("Workspace secrets must be at least 32 characters");
        this.identities=identities; this.redis=redis; this.internalToken=token;
        this.origins=List.of(origins.split(",")); this.secure=secure; this.json=json;
        var key=new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        encoder=new NimbusJwtEncoder(new ImmutableSecret<>(key));
        var verifier=NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
        verifier.setJwtValidator(JwtValidators.createDefaultWithIssuer("enterprise-workspace"));
        decoder=verifier;
    }

    @Bean SecurityFilterChain security(HttpSecurity http) throws Exception {
        return http.csrf(c->c.disable()).sessionManagement(s->s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a->a.dispatcherTypeMatchers(jakarta.servlet.DispatcherType.ASYNC, jakarta.servlet.DispatcherType.ERROR).permitAll()
                .requestMatchers("/health", "/auth/login", "/auth/register", "/internal/**").permitAll().anyRequest().authenticated())
            .exceptionHandling(e->e.authenticationEntryPoint((req,res,ex)->error(res,401,"请先登录")))
            .addFilterBefore(new OncePerRequestFilter() {
                @Override protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws IOException, ServletException {
                    try {
                        String path=req.getRequestURI();
                        if (path.startsWith("/internal/")) {
                            String supplied=req.getHeader("X-Internal-Token");
                            if (supplied==null || !MessageDigest.isEqual(internalToken.getBytes(StandardCharsets.UTF_8),supplied.getBytes(StandardCharsets.UTF_8))) {
                                error(res,401,"服务认证失败"); return;
                            }
                        } else {
                            if (!List.of("GET","HEAD","OPTIONS").contains(req.getMethod())) {
                                String origin=req.getHeader("Origin");
                                if (!"1".equals(req.getHeader("X-Workspace-Request")) || (origin!=null && !SessionSecurity.this.origins.contains(origin))) {
                                    error(res,403,"请求来源验证失败"); return;
                                }
                            }
                            if (path.equals("/auth/login") || path.equals("/auth/register")) rateLimit(req);
                            else {
                                String raw=cookie(req);
                                if (raw!=null) {
                                    Jwt jwt=decoder.decode(raw);
                                    String session=redis.opsForValue().get("session:"+jwt.getId());
                                    if (!jwt.getSubject().equals(session)) { error(res,401,"登录已失效"); return; }
                                    var identity=identities.identity(jwt.getSubject(),jwt.getClaimAsString("workspace"));
                                    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(identity,null,List.of()));
                                }
                            }
                        }
                    } catch (JwtException ex) { error(res,401,"登录已失效"); return; }
                    catch (ResponseStatusException ex) { error(res,ex.getStatusCode().value(),ex.getReason()); return; }
                    catch (RuntimeException ex) { error(res,503,"认证服务暂不可用"); return; }
                    chain.doFilter(req,res);
                }
            }, UsernamePasswordAuthenticationFilter.class).build();
    }

    private void rateLimit(HttpServletRequest req) {
        String key="login-rate:"+req.getRemoteAddr()+":"+(Instant.now().getEpochSecond()/60);
        Long count=redis.opsForValue().increment(key);
        if (count!=null && count==1) redis.expire(key,Duration.ofMinutes(2));
        if (count!=null && count>30) throw new ResponseStatusException(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS,"请求过于频繁，请稍后再试");
    }

    public void issue(IdentityService.Identity identity, HttpServletResponse res) {
        String sid=UUID.randomUUID().toString(); Instant now=Instant.now();
        redis.opsForValue().set("session:"+sid,identity.userId(),Duration.ofHours(8));
        String jwt=encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(),
            JwtClaimsSet.builder().issuer("enterprise-workspace").subject(identity.userId()).id(sid)
                .issuedAt(now).expiresAt(now.plusSeconds(28800)).claim("workspace",identity.workspaceId()).build())).getTokenValue();
        res.addHeader(HttpHeaders.SET_COOKIE,ResponseCookie.from(COOKIE,jwt).httpOnly(true).secure(secure).sameSite("Lax").path("/").maxAge(28800).build().toString());
    }

    public void revoke(HttpServletRequest req, HttpServletResponse res) {
        invalidate(req);
        res.addHeader(HttpHeaders.SET_COOKIE,ResponseCookie.from(COOKIE,"").httpOnly(true).secure(secure).sameSite("Lax").path("/").maxAge(0).build().toString());
    }

    public void invalidate(HttpServletRequest req) {
        String raw=cookie(req);
        if (raw!=null) { try { redis.delete("session:"+decoder.decode(raw).getId()); } catch (JwtException ignored) { } }
    }

    private String cookie(HttpServletRequest req) {
        return req.getCookies()==null ? null : Arrays.stream(req.getCookies()).filter(c->c.getName().equals(COOKIE)).map(Cookie::getValue).findFirst().orElse(null);
    }
    private void error(HttpServletResponse res,int status,String message) throws IOException {
        res.setStatus(status); res.setContentType("application/json;charset=UTF-8"); json.writeValue(res.getOutputStream(),Map.of("detail",message));
    }
}
