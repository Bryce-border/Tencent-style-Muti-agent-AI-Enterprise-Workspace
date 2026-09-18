package com.enterprise.workspace;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import static org.springframework.http.HttpStatus.*;

@Repository
public class TaskRepository {
    private final JdbcTemplate db;
    private final ObjectMapper json;
    public TaskRepository(JdbcTemplate db,ObjectMapper json) { this.db=db; this.json=json; }
    public ObjectNode parse(String value) {
        try { return (ObjectNode)json.readTree(value); } catch (Exception ex) { throw new IllegalArgumentException("Invalid task snapshot",ex); }
    }
    public ObjectNode get(String id) {
        List<String> rows=db.queryForList("SELECT snapshot FROM tasks WHERE task_id=?",String.class,id);
        if (rows.isEmpty()) throw new ResponseStatusException(NOT_FOUND,"任务不存在");
        return parse(rows.getFirst());
    }
    public ObjectNode owned(String id,String space) {
        var task=get(id);
        if (!task.path("workspace_id").asText().equals(space)) throw new ResponseStatusException(NOT_FOUND,"任务不存在");
        return task;
    }
    public List<ObjectNode> list(String space,int limit) {
        return db.query("SELECT snapshot FROM tasks WHERE workspace_id=? ORDER BY updated_ms DESC LIMIT ?",(rs,i)->parse(rs.getString(1)),space,Math.clamp(limit,1,100));
    }

    @Transactional
    public ObjectNode create(String space,String prompt,String employee,String requestKey) {
        return create(space,prompt,employee,requestKey,null);
    }
    @Transactional
    public ObjectNode create(String space,String prompt,String employee,String requestKey,String owner) {
        // Workspace lock also serializes duplicate idempotency keys across service instances.
        db.queryForObject("SELECT id FROM workspaces WHERE id=? FOR UPDATE",String.class,space);
        if (requestKey!=null) {
            if (!requestKey.matches("[a-zA-Z0-9_-]{8,100}")) throw new ResponseStatusException(BAD_REQUEST,"幂等键格式无效");
            List<String> existing=db.queryForList("SELECT snapshot FROM tasks WHERE workspace_id=? AND request_key=?",String.class,space,requestKey);
            if (!existing.isEmpty()) {
                var task=parse(existing.getFirst());
                String existingOwner=db.queryForObject("SELECT owner_user_id FROM tasks WHERE task_id=?",String.class,task.path("task_id").asText());
                if (!java.util.Objects.equals(owner,existingOwner) || !task.path("prompt").asText().equals(prompt) || !task.path("employee_id").asText().equals(employee))
                    throw new ResponseStatusException(CONFLICT,"幂等键已用于不同请求");
                return task;
            }
        }
        var task=json.createObjectNode(); String id="T-"+UUID.randomUUID().toString().replace("-","").substring(0,12);
        task.put("task_id",id).put("workspace_id",space).put("prompt",prompt).put("employee_id",employee).put("status","PENDING")
            .put("created_at",Instant.now().toString()).put("updated_at",Instant.now().toString());
        task.putArray("plan"); task.putNull("result");
        db.update("INSERT INTO tasks(task_id,workspace_id,status,snapshot,updated_ms,request_key,owner_user_id) VALUES (?,?,?,?,?,?,?)",id,space,"PENDING",task.toString(),System.currentTimeMillis(),requestKey,owner);
        db.update("INSERT INTO task_outbox(task_id) VALUES (?)",id);
        event(id,"task.created",task);
        return task;
    }

    public ObjectNode visible(String id,IdentityService.Identity actor) {
        var task=owned(id,actor.workspaceId());
        String owner=db.queryForObject("SELECT owner_user_id FROM tasks WHERE task_id=?",String.class,id);
        if(owner!=null && !owner.equals(actor.userId())) throw new ResponseStatusException(NOT_FOUND,"任务不存在");
        return task;
    }
    public boolean visibleId(String id,IdentityService.Identity actor) {
        return db.queryForObject("SELECT COUNT(*) FROM tasks WHERE task_id=? AND workspace_id=? AND (owner_user_id IS NULL OR owner_user_id=?)",Integer.class,id,actor.workspaceId(),actor.userId())>0;
    }
    public List<ObjectNode> visibleList(IdentityService.Identity actor,int limit) {
        return db.query("SELECT snapshot FROM tasks WHERE workspace_id=? AND (owner_user_id IS NULL OR owner_user_id=?) ORDER BY updated_ms DESC LIMIT ?",(rs,i)->parse(rs.getString(1)),actor.workspaceId(),actor.userId(),Math.clamp(limit,1,100));
    }

    private Map<String,Object> lock(String id) {
        List<Map<String,Object>> rows=db.queryForList("SELECT * FROM tasks WHERE task_id=? FOR UPDATE",id);
        if (rows.isEmpty()) throw new ResponseStatusException(NOT_FOUND,"任务不存在");
        return rows.getFirst();
    }
    private boolean ownsLease(Map<String,Object> row,String token) {
        return token!=null && token.equals(row.get("lease_token")) && "RUNNING".equals(row.get("status")) && ((Number)row.get("lease_until")).longValue()>System.currentTimeMillis();
    }
    private void persist(ObjectNode task) {
        task.put("updated_at",Instant.now().toString());
        db.update("UPDATE tasks SET snapshot=?,status=?,updated_ms=? WHERE task_id=?",task.toString(),task.path("status").asText(),System.currentTimeMillis(),task.path("task_id").asText());
    }

    @Transactional
    public boolean claim(String id,String token) {
        if (token==null || !token.matches("[a-zA-Z0-9-]{16,64}")) throw new ResponseStatusException(BAD_REQUEST,"执行租约无效");
        var row=lock(id);
        if (!"PENDING".equals(row.get("status"))) return false;
        var task=parse((String)row.get("snapshot")); task.put("status","RUNNING"); task.putNull("result"); task.putArray("plan"); persist(task);
        db.update("UPDATE tasks SET lease_token=?,lease_until=?,attempts=attempts+1 WHERE task_id=?",token,System.currentTimeMillis()+120000,id);
        return true;
    }

    @Transactional
    public boolean heartbeat(String id,String token) {
        var row=lock(id); if (!ownsLease(row,token)) return false;
        db.update("UPDATE tasks SET lease_until=? WHERE task_id=?",System.currentTimeMillis()+120000,id); return true;
    }

    @Transactional
    public boolean save(String id,String token,ObjectNode incoming) {
        var row=lock(id); if (!ownsLease(row,token)) return false;
        var task=parse((String)row.get("snapshot"));
        String status=incoming.path("status").asText();
        if (!List.of("SUCCESS","FAILED","PENDING_CONFIRMATION").contains(status)) throw new ResponseStatusException(BAD_REQUEST,"无效执行结果状态");
        if (!incoming.path("task_id").asText().equals(id) || !incoming.path("workspace_id").asText().equals(task.path("workspace_id").asText()))
            throw new ResponseStatusException(CONFLICT,"任务归属不匹配");
        task.put("status",status); task.set("result",incoming.get("result")); task.set("plan",incoming.get("plan"));
        persist(task); archive(task); return true;
    }

    @Transactional
    public boolean plan(String id,String token,JsonNode plan) {
        var row=lock(id); if (!ownsLease(row,token)) return false;
        var task=parse((String)row.get("snapshot")); task.set("plan",plan); persist(task); return true;
    }
    @Transactional
    public boolean workerEvent(String id,String token,String type,JsonNode payload) {
        var row=lock(id);
        // A finishing worker can append its final event, but never after another lease wins.
        if (token==null || !token.equals(row.get("lease_token")) || "CANCELLED".equals(row.get("status"))) return false;
        if ("RUNNING".equals(row.get("status")) && !ownsLease(row,token)) return false;
        event(id,type,payload); return true;
    }
    public void event(String id,String type,JsonNode payload) {
        db.update("INSERT INTO task_events(task_id,event_type,payload,created_at) VALUES (?,?,?,?)",id,type,payload.toString(),Instant.now().toString());
    }

    @Transactional
    public ObjectNode retryDocument(String id,String space) {
        var links=db.queryForList("SELECT conversation_id,output_spec FROM conversation_turns WHERE task_id=?",id);
        if(links.isEmpty()) throw new ResponseStatusException(CONFLICT,"此任务不支持章节续作");
        var link=links.getFirst();
        var c=db.queryForMap("SELECT * FROM conversations WHERE id=? FOR UPDATE",link.get("conversation_id"));
        if(!space.equals(c.get("workspace_id")) || Boolean.TRUE.equals(c.get("archived")) || !id.equals(c.get("approved_task_id")))
            throw new ResponseStatusException(CONFLICT,"请在原会话当前批准任务中重试，已归档或已有新方案的任务不可重试");
        var spec=link.get("output_spec");
        if(db.queryForObject("SELECT COUNT(*) FROM conversation_turns c JOIN tasks t ON t.task_id=c.task_id WHERE c.conversation_id=? AND c.task_id<>? AND t.status IN ('PENDING','RUNNING','PENDING_CONFIRMATION')",Integer.class,link.get("conversation_id"),id)>0)
            throw new ResponseStatusException(CONFLICT,"会话内已有其他任务正在执行");
        if(spec==null || !parse((String)spec).path("generation_mode").asText().equals("chapters"))
            throw new ResponseStatusException(CONFLICT,"仅分章文档支持章节续作");
        var row=lock(id); var task=parse((String)row.get("snapshot"));
        if(List.of("RUNNING","PENDING").contains(task.path("status").asText())) return task;
        if(!task.path("status").asText().equals("FAILED")) throw new ResponseStatusException(CONFLICT,"只有失败任务可以重试");
        task.put("status","PENDING");persist(task);
        db.update("UPDATE tasks SET lease_token=NULL,lease_until=0,attempts=0 WHERE task_id=?",id);
        db.update("UPDATE task_outbox SET published_ms=0 WHERE task_id=?",id);
        event(id,"task.retry.requested",json.createObjectNode().put("reason","user_resume_document"));
        return task;
    }

    @Transactional
    public ObjectNode action(String id,String space,String action) {
        var row=lock(id); var task=parse((String)row.get("snapshot"));
        if (!space.equals(task.path("workspace_id").asText())) throw new ResponseStatusException(NOT_FOUND,"任务不存在");
        String status=task.path("status").asText();
        if (action.equals("cancel")) {
            if (List.of("SUCCESS","FAILED","CANCELLED").contains(status)) return task;
            task.put("status","CANCELLED");
        } else {
            if (!status.equals("PENDING_CONFIRMATION") || !task.path("result").path("next_action").asText().equals("REVIEW_DELIVERABLE"))
                throw new ResponseStatusException(CONFLICT,"此任务不能接受交付，外部连接器写入仍不可用");
            task.put("status","SUCCESS"); ((ObjectNode)task.get("result")).put("status","SUCCESS").put("next_action","READ_REPORT");
        }
        persist(task); archive(task);
        event(id,action.equals("cancel")?"task.cancelled":"task.confirmed",json.createObjectNode().put("status",task.path("status").asText()));
        return task;
    }
    private void archive(ObjectNode task) {
        var result=task.path("result"); String output=result.path("data").path("output").asText();
        if (task.path("status").asText().equals("SUCCESS") && result.path("data").path("mode").asText().equals("crewai") && !output.isBlank() &&
            db.queryForObject("SELECT COUNT(*) FROM reports WHERE task_id=?",Integer.class,task.path("task_id").asText())==0)
            db.update("INSERT INTO reports VALUES (?,?,?,?,?)",task.path("task_id").asText(),task.path("workspace_id").asText(),task.path("prompt").asText(),output,task.path("updated_at").asText());
    }
    public List<Map<String,Object>> events(String id,long after) {
        return db.query("SELECT * FROM task_events WHERE task_id=? AND id>? ORDER BY id",(rs,i)->Map.of("id",rs.getLong("id"),"type",rs.getString("event_type"),"payload",parse(rs.getString("payload")),"created_at",rs.getString("created_at")),id,after);
    }
    public List<Map<String,Object>> messages(String space) {
        return db.query("SELECT e.*,t.snapshot FROM task_events e JOIN tasks t ON t.task_id=e.task_id WHERE t.workspace_id=? ORDER BY e.id DESC LIMIT 100",(rs,i)->Map.of("id",rs.getLong("id"),"task_id",rs.getString("task_id"),"type",rs.getString("event_type"),"payload",parse(rs.getString("payload")),"prompt",parse(rs.getString("snapshot")).path("prompt").asText(),"created_at",rs.getString("created_at")),space);
    }
    public List<Map<String,Object>> messages(IdentityService.Identity actor) {
        return db.query("SELECT e.*,t.snapshot FROM task_events e JOIN tasks t ON t.task_id=e.task_id WHERE t.workspace_id=? AND (t.owner_user_id IS NULL OR t.owner_user_id=?) ORDER BY e.id DESC LIMIT 100",(rs,i)->Map.of("id",rs.getLong("id"),"task_id",rs.getString("task_id"),"type",rs.getString("event_type"),"payload",parse(rs.getString("payload")),"prompt",parse(rs.getString("snapshot")).path("prompt").asText(),"created_at",rs.getString("created_at")),actor.workspaceId(),actor.userId());
    }
    public List<Map<String,Object>> reports(IdentityService.Identity actor) {
        return db.queryForList("SELECT r.task_id,r.title,r.created_at FROM reports r JOIN tasks t ON t.task_id=r.task_id WHERE r.workspace_id=? AND (t.owner_user_id IS NULL OR t.owner_user_id=?) ORDER BY r.created_at DESC LIMIT 100",actor.workspaceId(),actor.userId());
    }
    public List<Map<String,Object>> reports(String space) {
        return db.queryForList("SELECT task_id,title,created_at FROM reports WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100",space);
    }
    public Map<String,Object> report(String id,String space) {
        var rows=db.queryForList("SELECT * FROM reports WHERE task_id=? AND workspace_id=?",id,space);
        if (rows.isEmpty()) throw new ResponseStatusException(NOT_FOUND,"报告不存在"); return rows.getFirst();
    }
    public Map<String,Object> stats(String space) {
        return db.queryForMap("SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN status IN ('PENDING','RUNNING') THEN 1 ELSE 0 END),0) AS active,COALESCE(SUM(CASE WHEN status='SUCCESS' THEN 1 ELSE 0 END),0) AS success,COALESCE(SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END),0) AS failed,COALESCE(SUM(CASE WHEN status='PENDING_CONFIRMATION' THEN 1 ELSE 0 END),0) AS pending_confirmation FROM tasks WHERE workspace_id=?",space);
    }

    @Transactional
    public void recover(String id) {
        var row=lock(id);
        if (!"RUNNING".equals(row.get("status")) || ((Number)row.get("lease_until")).longValue()>=System.currentTimeMillis()) return;
        var task=parse((String)row.get("snapshot")); boolean exhausted=((Number)row.get("attempts")).intValue()>=3;
        task.put("status",exhausted?"FAILED":"PENDING");
        if (exhausted) {
            var result=json.createObjectNode().put("task_id",id).put("agent","runtime").put("status","FAILED")
                .put("error","执行租约连续失效3次，请检查Worker后重新提交");
            result.putObject("data"); result.putArray("citations"); task.set("result",result);
        }
        persist(task);
        db.update("UPDATE tasks SET lease_token=NULL,lease_until=0 WHERE task_id=?",id);
        db.update("UPDATE task_outbox SET published_ms=0 WHERE task_id=?",id);
        event(id,exhausted?"task.failed":"task.recovered",json.createObjectNode().put("reason","expired_lease"));
    }

    @Transactional
    public Map<String,Object> migrate(JsonNode payload) {
        // Migration is import-only and atomic; never replace a live task or its events.
        int imported=0;
        for (JsonNode value:payload.path("tasks")) {
            ObjectNode task=(ObjectNode)value; String id=task.path("task_id").asText(), space=task.path("workspace_id").asText();
            if (db.queryForObject("SELECT COUNT(*) FROM tasks WHERE task_id=?",Integer.class,id)>0) continue;
            if (db.queryForObject("SELECT COUNT(*) FROM workspaces WHERE id=?",Integer.class,space)==0)
                db.update("INSERT INTO workspaces VALUES (?,?)",space,"迁移空间 "+space);
            String status=task.path("status").asText();
            if (status.equals("RUNNING")) { task.put("status","PENDING"); status="PENDING"; }
            db.update("INSERT INTO tasks(task_id,workspace_id,status,snapshot,updated_ms) VALUES (?,?,?,?,?)",id,space,status,task.toString(),Instant.parse(task.path("updated_at").asText()).toEpochMilli());
            if (status.equals("PENDING")) db.update("INSERT INTO task_outbox(task_id) VALUES (?)",id);
            for (JsonNode event:payload.path("events").path(id))
                db.update("INSERT INTO task_events(task_id,event_type,payload,created_at) VALUES (?,?,?,?)",id,event.path("type").asText(),event.path("payload").toString(),event.path("created_at").asText());
            imported++;
        }
        for (JsonNode report:payload.path("reports")) {
            if (db.queryForObject("SELECT COUNT(*) FROM reports WHERE task_id=?",Integer.class,report.path("task_id").asText())==0)
                db.update("INSERT INTO reports VALUES (?,?,?,?,?)",report.path("task_id").asText(),report.path("workspace_id").asText(),report.path("title").asText(),report.path("content").asText(),report.path("created_at").asText());
        }
        return Map.of("imported",imported,"tasks",db.queryForObject("SELECT COUNT(*) FROM tasks",Integer.class),"events",db.queryForObject("SELECT COUNT(*) FROM task_events",Integer.class),"reports",db.queryForObject("SELECT COUNT(*) FROM reports",Integer.class));
    }
}
