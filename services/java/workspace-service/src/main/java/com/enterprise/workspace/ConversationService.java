package com.enterprise.workspace;

import com.enterprise.workspace.IdentityService.Identity;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import static org.springframework.http.HttpStatus.*;

/** Application-owned memory: provenance and owner scope are independent of the LLM framework. */
@Service
public class ConversationService {
    private static final Set<String> EMPLOYEES=Set.of("ai_assistant","data_analyst","document_expert","meeting_secretary","hr_assistant","crm_assistant","knowledge_expert","product_designer","ai_engineer");
    private final JdbcTemplate db;
    private final TaskRepository tasks;
    public ConversationService(JdbcTemplate db,TaskRepository tasks) { this.db=db; this.tasks=tasks; }
    private String text(String value,int max) {
        if(value==null || value.isBlank() || value.length()>max) throw new ResponseStatusException(BAD_REQUEST,"内容为空或超过长度限制");
        return value.strip();
    }
    private void employee(String id) { if(id==null || !EMPLOYEES.contains(id)) throw new ResponseStatusException(BAD_REQUEST,"员工不存在"); }
    public List<Map<String,Object>> list(Identity a) {
        return db.queryForList("SELECT id,title,project_id,employee_id,archived,created_at,updated_at FROM conversations WHERE workspace_id=? AND user_id=? ORDER BY updated_at DESC LIMIT 100",a.workspaceId(),a.userId());
    }
    public Map<String,Object> owned(Identity a,String id,boolean lock) {
        var rows=db.queryForList("SELECT * FROM conversations WHERE id=? AND workspace_id=? AND user_id=?"+(lock?" FOR UPDATE":""),id,a.workspaceId(),a.userId());
        if(rows.isEmpty()) throw new ResponseStatusException(NOT_FOUND,"会话不存在");
        return rows.getFirst();
    }
    @Transactional public Map<String,Object> create(Identity a,String title,String employee) {
        return create(a,title,employee,null);
    }
    @Transactional public Map<String,Object> create(Identity a,String title,String employee,String project) {
        a.requireWrite(); employee(employee); title=text(title,120); String id="C-"+UUID.randomUUID();
        if(project==null || project.isBlank()) project=(String)createProject(a,title).get("id");
        activeProject(a,project,true);
        String now=Instant.now().toString();
        db.update("INSERT INTO conversations(id,workspace_id,user_id,employee_id,title,created_at,updated_at,project_id) VALUES (?,?,?,?,?,?,?,?)",id,a.workspaceId(),a.userId(),employee,title,now,now,project);
        return owned(a,id,false);
    }
    public Map<String,Object> detail(Identity a,String id) {
        var conversation=owned(a,id,false);
        var turns=db.query("SELECT t.snapshot FROM conversation_turns c JOIN tasks t ON t.task_id=c.task_id WHERE c.conversation_id=? ORDER BY c.id",(rs,i)->CitationView.task(tasks.parse(rs.getString(1))),id);
        return Map.of("conversation",conversation,"turns",turns);
    }
    @Transactional public ObjectNode submit(Identity a,String id,String prompt,String key) {
        a.requireWrite(); var unlocked=owned(a,id,false); activeProject(a,(String)unlocked.get("project_id"),true); var c=owned(a,id,true); prompt=text(prompt,4000);
        if(Boolean.TRUE.equals(c.get("archived"))) throw new ResponseStatusException(CONFLICT,"请先恢复会话");
        if(key==null || !key.matches("[a-zA-Z0-9_-]{8,100}")) throw new ResponseStatusException(BAD_REQUEST,"请提供幂等键");
        String requestKey="chat_"+UUID.nameUUIDFromBytes((id+":"+key).getBytes(StandardCharsets.UTF_8));
        var existing=db.queryForList("SELECT task_id FROM tasks WHERE workspace_id=? AND request_key=?",String.class,a.workspaceId(),requestKey);
        if(!existing.isEmpty()) {
            var task=tasks.visible(existing.getFirst(),a);
            if(!task.path("prompt").asText().equals(prompt)) throw new ResponseStatusException(CONFLICT,"幂等键已用于不同请求");
            return task;
        }
        int active=db.queryForObject("SELECT COUNT(*) FROM conversation_turns c JOIN tasks t ON t.task_id=c.task_id WHERE c.conversation_id=? AND t.status IN ('PENDING','RUNNING','PENDING_CONFIRMATION')",Integer.class,id);
        if(active>0) throw new ResponseStatusException(CONFLICT,"请等待当前轮完成，或先处理待确认任务");
        if(db.queryForObject("SELECT COUNT(*) FROM conversation_turns WHERE conversation_id=?",Integer.class,id)>=200)
            throw new ResponseStatusException(CONFLICT,"会话已满200轮，请新建会话");
        var task=tasks.create(a.workspaceId(),prompt,(String)c.get("employee_id"),requestKey,a.userId());
        db.update("INSERT INTO conversation_turns(conversation_id,task_id) VALUES (?,?)",id,task.path("task_id").asText());
        db.update("UPDATE conversations SET updated_at=? WHERE id=?",Instant.now().toString(),id);
        return task;
    }
    public List<Map<String,Object>> memories(Identity a,String employee) {
        employee(employee);
        return db.queryForList("SELECT * FROM agent_memories WHERE workspace_id=? AND user_id=? AND employee_id=? ORDER BY created_at DESC LIMIT 100",a.workspaceId(),a.userId(),employee);
    }
    public List<Map<String,Object>> memories(Identity a,String employee,String project) {
        if(project==null || project.isBlank()) return memories(a,employee);
        project(a,project,false);
        return db.queryForList("SELECT * FROM agent_memories WHERE workspace_id=? AND user_id=? AND project_id=? ORDER BY created_at DESC LIMIT 100",a.workspaceId(),a.userId(),project);
    }
    public List<Map<String,Object>> recalledMemories(Identity a,String conversation) {
        var c=owned(a,conversation,false);
        var p=project(a,(String)c.get("project_id"),false);
        if(Boolean.TRUE.equals(c.get("archived")) || Boolean.TRUE.equals(p.get("archived"))) return List.of();
        return db.queryForList("SELECT id,kind,content,source_task_id FROM agent_memories WHERE workspace_id=? AND user_id=? AND project_id=? AND enabled=TRUE ORDER BY updated_at DESC LIMIT 8",a.workspaceId(),a.userId(),c.get("project_id"));
    }
    @Transactional public Map<String,Object> remember(Identity a,String employee,String kind,String content,String source) {
        return remember(a,employee,kind,content,source,null);
    }
    @Transactional public Map<String,Object> remember(Identity a,String employee,String kind,String content,String source,String project) {
        a.requireWrite(); employee(employee); content=text(content,1000);
        if(kind==null || !Set.of("preference","fact","decision").contains(kind)) throw new ResponseStatusException(BAD_REQUEST,"记忆类型无效");
        if(project==null || project.isBlank()) {
            if(source!=null && !source.isBlank()) {
                tasks.visible(source,a);
                var links=db.queryForList("SELECT c.project_id FROM conversation_turns ct JOIN conversations c ON c.id=ct.conversation_id WHERE ct.task_id=?",String.class,source);
                if(!links.isEmpty()) project=links.getFirst();
            }
            if(project==null || project.isBlank()) throw new ResponseStatusException(BAD_REQUEST,"请指定记忆所属项目");
        }
        activeProject(a,project,true);
        db.queryForObject("SELECT id FROM workspaces WHERE id=? FOR UPDATE",String.class,a.workspaceId());
        if(source!=null && !source.isBlank()) {
            tasks.visible(source,a);
            if(db.queryForObject("SELECT COUNT(*) FROM conversation_turns t JOIN conversations c ON c.id=t.conversation_id WHERE t.task_id=? AND c.user_id=? AND c.workspace_id=? AND c.project_id=? AND t.id>c.memory_after_turn",Integer.class,source,a.userId(),a.workspaceId(),project)==0)
                throw new ResponseStatusException(BAD_REQUEST,"来源必须是此员工的个人会话任务");
        } else source=null;
        var old=memories(a,employee,project);
        for(var m:old) if(content.equals(m.get("content")) && kind.equals(m.get("kind"))) return m;
        if(old.size()>=100) throw new ResponseStatusException(CONFLICT,"该项目已有100条记忆，请删除过期内容");
        String id="M-"+UUID.randomUUID(),now=Instant.now().toString();
        db.update("INSERT INTO agent_memories(id,workspace_id,user_id,employee_id,kind,content,source_task_id,created_at,updated_at,project_id) VALUES (?,?,?,?,?,?,?,?,?,?)",id,a.workspaceId(),a.userId(),employee,kind,content,source,now,now,project);
        return db.queryForMap("SELECT * FROM agent_memories WHERE id=?",id);
    }
    public void forget(Identity a,String id) {
        a.requireWrite();
        if(db.update("DELETE FROM agent_memories WHERE id=? AND workspace_id=? AND user_id=?",id,a.workspaceId(),a.userId())==0)
            throw new ResponseStatusException(NOT_FOUND,"记忆不存在");
    }
    @Transactional public Map<String,Object> update(Identity a,String id,String title,Boolean archived) {
        a.requireWrite(); var unlocked=owned(a,id,false); activeProject(a,(String)unlocked.get("project_id"),true); owned(a,id,true);
        if(Boolean.TRUE.equals(archived)) requireIdle(id);
        if(title!=null) db.update("UPDATE conversations SET title=? WHERE id=?",text(title,120),id);
        if(archived!=null) db.update("UPDATE conversations SET archived=? WHERE id=?",archived,id);
        db.update("UPDATE conversations SET updated_at=? WHERE id=?",Instant.now().toString(),id);
        return owned(a,id,false);
    }
    @Transactional public Map<String,Object> updateMemory(Identity a,String id,String content,Boolean enabled) {
        a.requireWrite();
        var rows=db.queryForList("SELECT * FROM agent_memories WHERE id=? AND workspace_id=? AND user_id=? FOR UPDATE",id,a.workspaceId(),a.userId());
        if(rows.isEmpty()) throw new ResponseStatusException(NOT_FOUND,"记忆不存在");
        if(Boolean.TRUE.equals(enabled) && rows.getFirst().get("project_id")==null)
            throw new ResponseStatusException(CONFLICT,"旧记忆尚未绑定项目，请在目标项目重新保存");
        if(content!=null) db.update("UPDATE agent_memories SET content=? WHERE id=?",text(content,1000),id);
        if(enabled!=null) db.update("UPDATE agent_memories SET enabled=? WHERE id=?",enabled,id);
        db.update("UPDATE agent_memories SET updated_at=? WHERE id=?",Instant.now().toString(),id);
        return db.queryForMap("SELECT * FROM agent_memories WHERE id=?",id);
    }
    private void requireIdle(String id) {
        if(db.queryForObject("SELECT COUNT(*) FROM conversation_turns c JOIN tasks t ON t.task_id=c.task_id WHERE c.conversation_id=? AND t.status IN ('PENDING','RUNNING','PENDING_CONFIRMATION')",Integer.class,id)>0)
            throw new ResponseStatusException(CONFLICT,"请先等待当前任务结束，或处理待确认任务后再归档");
    }
    private void deleteConversation(String id) {
        requireIdle(id);
        var ids=db.queryForList("SELECT task_id FROM conversation_turns WHERE conversation_id=?",String.class,id);
        for(String taskId:ids) {
            db.queryForMap("SELECT task_id FROM tasks WHERE task_id=? FOR UPDATE",taskId);
            db.update("DELETE FROM agent_memories WHERE source_task_id=?",taskId);
            db.update("DELETE FROM reports WHERE task_id=?",taskId);
            db.update("DELETE FROM task_events WHERE task_id=?",taskId);
            db.update("DELETE FROM task_outbox WHERE task_id=?",taskId);
        }
        db.update("DELETE FROM conversation_turns WHERE conversation_id=?",id);
        for(String taskId:ids) db.update("DELETE FROM tasks WHERE task_id=?",taskId);
        db.update("DELETE FROM conversations WHERE id=?",id);
    }
    public Map<String,Object> context(String taskId,String lease) {
        if(!tasks.heartbeat(taskId,lease)) throw new ResponseStatusException(CONFLICT,"执行租约无效");
        var rows=db.queryForList("SELECT c.*,t.id AS turn_id,t.output_spec FROM conversations c JOIN conversation_turns t ON c.id=t.conversation_id WHERE t.task_id=?",taskId);
        if(rows.isEmpty()) return Map.of("turns",List.of(),"memories",List.of());
        var c=rows.getFirst();
        if(Boolean.TRUE.equals(c.get("archived")) || db.queryForObject("SELECT archived FROM projects WHERE id=?",Boolean.class,c.get("project_id"))) return Map.of("turns",List.of(),"memories",List.of());
        var history=db.query("SELECT t.snapshot FROM conversation_turns ct JOIN conversations hc ON hc.id=ct.conversation_id JOIN tasks t ON t.task_id=ct.task_id WHERE hc.project_id=? AND hc.archived=FALSE AND ct.id<? AND ct.id>hc.memory_after_turn AND t.status='SUCCESS' ORDER BY ct.id DESC LIMIT 6",(rs,i)->tasks.parse(rs.getString(1)),c.get("project_id"),c.get("turn_id"));
        Collections.reverse(history);
        var turns=history.stream().map(t->Map.of("task_id",t.path("task_id").asText(),"user",clip(t.path("prompt").asText(),1200),"assistant",clip(t.path("result").path("data").path("output").asText(),2000))).toList();
        var memories=db.queryForList("SELECT id,kind,content,source_task_id FROM agent_memories WHERE workspace_id=? AND user_id=? AND project_id=? AND enabled=TRUE ORDER BY updated_at DESC LIMIT 8",c.get("workspace_id"),c.get("user_id"),c.get("project_id"));
        // Checkpoints belong to the leased task, never a user-provided source task.
        var checkpoints=db.queryForList("SELECT payload FROM task_events WHERE task_id=? AND event_type='document.checkpoint' ORDER BY id DESC LIMIT 1",String.class,taskId);
        return Map.of("conversation_id",c.get("id"),"turns",turns,"memories",memories,"output_spec",c.get("output_spec")==null?Map.of():tasks.parse((String)c.get("output_spec")),
            "document_checkpoint",checkpoints.isEmpty()?Map.of():tasks.parse(checkpoints.getFirst()));
    }
    private String clip(String value,int length) { return value.length()>length?value.substring(0,length)+"…[截断]":value; }
}
