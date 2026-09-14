package com.enterprise.workspace;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import static org.springframework.http.HttpStatus.*;

@Service
public class IdentityService implements ApplicationRunner {
    private final JdbcTemplate db;
    private final String bootstrapUser;
    private final String bootstrapPassword;
    private final BCryptPasswordEncoder passwords = new BCryptPasswordEncoder(12);

    public record Identity(String userId, String username, String workspaceId, String role) {
        public boolean admin() { return role.equals("ADMIN"); }
        public void requireWrite() { if (role.equals("VIEWER")) throw new ResponseStatusException(FORBIDDEN, "只读成员不能执行此操作"); }
        public void requireAdmin() { if (!admin()) throw new ResponseStatusException(FORBIDDEN, "需要工作空间管理员权限"); }
    }

    public IdentityService(JdbcTemplate db, @Value("${workspace.bootstrap-user}") String user,
                           @Value("${workspace.bootstrap-password}") String password) {
        this.db = db; this.bootstrapUser = user; this.bootstrapPassword = password;
    }

    @Override @Transactional
    public void run(ApplicationArguments args) {
        if (db.queryForObject("SELECT COUNT(*) FROM users", Integer.class) == 0 && !bootstrapPassword.isBlank()) {
            create(bootstrapUser, bootstrapPassword, "default", "默认业务空间");
        }
    }

    @Transactional
    public Identity register(String username, String password, String spaceName) {
        return create(username, password, "W-" + UUID.randomUUID(), spaceName);
    }

    private Identity create(String username, String password, String workspaceId, String name) {
        if (username == null || !username.matches("[a-zA-Z0-9_.-]{3,64}"))
            throw new ResponseStatusException(BAD_REQUEST, "用户名需为3至64位字母、数字或_.-");
        if (password == null || password.length() < 12 || password.getBytes(StandardCharsets.UTF_8).length > 72)
            throw new ResponseStatusException(BAD_REQUEST, "密码至少12位且UTF-8长度不超过72字节");
        if (name == null || name.isBlank() || name.length() > 120)
            throw new ResponseStatusException(BAD_REQUEST, "请填写120字以内的空间名称");
        String userId = UUID.randomUUID().toString();
        db.update("INSERT INTO users VALUES (?,?,?,?)", userId, username.toLowerCase(), passwords.encode(password), Instant.now().toString());
        db.update("INSERT INTO workspaces VALUES (?,?)", workspaceId, name);
        db.update("INSERT INTO memberships VALUES (?,?,?)", workspaceId, userId, "ADMIN");
        return new Identity(userId, username.toLowerCase(), workspaceId, "ADMIN");
    }

    public Identity login(String username, String password) {
        List<Map<String,Object>> users = db.queryForList("SELECT * FROM users WHERE username=?", username == null ? "" : username.toLowerCase());
        if (users.isEmpty() || password == null || !passwords.matches(password, (String) users.getFirst().get("password_hash")))
            throw new ResponseStatusException(UNAUTHORIZED, "用户名或密码错误");
        String id = (String) users.getFirst().get("id");
        List<String> spaces = db.queryForList("SELECT workspace_id FROM memberships WHERE user_id=? ORDER BY workspace_id", String.class, id);
        if (spaces.isEmpty()) throw new ResponseStatusException(FORBIDDEN, "尚未加入工作空间");
        return identity(id, spaces.getFirst());
    }

    public Identity identity(String userId, String space) {
        List<Identity> rows = db.query("SELECT u.username,m.role FROM users u JOIN memberships m ON u.id=m.user_id WHERE u.id=? AND m.workspace_id=?",
            (rs,i) -> new Identity(userId, rs.getString(1), space, rs.getString(2)), userId, space);
        if (rows.isEmpty()) throw new ResponseStatusException(FORBIDDEN, "无权访问工作空间");
        return rows.getFirst();
    }

    public Map<String,Object> profile(Identity identity) {
        return Map.of("username", identity.username(), "user_id", identity.userId(), "workspace_id", identity.workspaceId(), "role", identity.role(),
            "workspaces", db.queryForList("SELECT w.id,w.name,m.role FROM memberships m JOIN workspaces w ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY w.name", identity.userId()));
    }

    @Transactional
    public void addMember(Identity actor, String username, String role) {
        actor.requireAdmin();
        if (!List.of("ADMIN", "MEMBER", "VIEWER").contains(role)) throw new ResponseStatusException(BAD_REQUEST, "角色无效");
        // Serialize membership changes so concurrent demotions cannot remove every administrator.
        db.queryForObject("SELECT id FROM workspaces WHERE id=? FOR UPDATE", String.class, actor.workspaceId());
        List<String> users = db.queryForList("SELECT id FROM users WHERE username=?", String.class, username.toLowerCase());
        if (users.isEmpty()) throw new ResponseStatusException(NOT_FOUND, "用户尚未注册");
        String userId = users.getFirst();
        List<String> previous = db.queryForList("SELECT role FROM memberships WHERE workspace_id=? AND user_id=?", String.class, actor.workspaceId(), userId);
        if (!previous.isEmpty() && previous.getFirst().equals("ADMIN") && !role.equals("ADMIN") &&
            db.queryForObject("SELECT COUNT(*) FROM memberships WHERE workspace_id=? AND role='ADMIN'", Integer.class, actor.workspaceId()) <= 1)
            throw new ResponseStatusException(CONFLICT, "必须保留至少一位管理员");
        if (previous.isEmpty()) db.update("INSERT INTO memberships VALUES (?,?,?)", actor.workspaceId(), userId, role);
        else db.update("UPDATE memberships SET role=? WHERE workspace_id=? AND user_id=?", role, actor.workspaceId(), userId);
        audit(actor, "member.role." + role, userId);
    }

    public List<Map<String,Object>> members(Identity actor) {
        actor.requireAdmin();
        return db.queryForList("SELECT u.id,u.username,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY u.username", actor.workspaceId());
    }

    public void audit(Identity actor, String action, String resource) {
        db.update("INSERT INTO audit_logs(workspace_id,user_id,action,resource_id,created_at) VALUES (?,?,?,?,?)",
            actor.workspaceId(), actor.userId(), action, resource, Instant.now().toString());
    }
}
