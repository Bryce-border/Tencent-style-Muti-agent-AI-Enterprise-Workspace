package com.enterprise.workspace;

import com.enterprise.workspace.IdentityService.Identity;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import static org.springframework.http.HttpStatus.*;

@Service
public class OutputPreviewService {
    private final ConversationService conversations;
    private final TaskRepository tasks;
    private final RuntimeClient runtime;
    private final ModelSettingsService models;
    private final JdbcTemplate db;
    private final ObjectMapper json;
    public OutputPreviewService(ConversationService conversations,TaskRepository tasks,RuntimeClient runtime,ModelSettingsService models,JdbcTemplate db,ObjectMapper json) {
        this.conversations=conversations;this.tasks=tasks;this.runtime=runtime;this.models=models;this.db=db;this.json=json;
    }
    private void idle(String id,Map<String,Object> conversation) {
        if(Boolean.TRUE.equals(conversation.get("archived"))) throw new ResponseStatusException(CONFLICT,"请先恢复会话");
        if(db.queryForObject("SELECT COUNT(*) FROM conversation_turns c JOIN tasks t ON t.task_id=c.task_id WHERE c.conversation_id=? AND t.status IN ('PENDING','RUNNING','PENDING_CONFIRMATION')",Integer.class,id)>0)
            throw new ResponseStatusException(CONFLICT,"请先等待或处理当前任务");
    }
    public ObjectNode generate(Identity a,String id,JsonNode body) {
        a.requireWrite(); var c=conversations.owned(a,id,false); idle(id,c);
        int revision=body.path("revision").asInt(-1);
        if(revision!=((Number)c.get("draft_revision")).intValue()) throw new ResponseStatusException(CONFLICT,"方案已更新，请刷新后重试");
        String goal=body.path("goal").asText();
        if(goal.isBlank() || goal.length()>4000) throw new ResponseStatusException(BAD_REQUEST,"目标需为1至4000字");
        var request=json.createObjectNode().put("goal",goal).put("changes",body.path("changes").asText());
        if(request.path("changes").asText().length()>1000) throw new ResponseStatusException(BAD_REQUEST,"修改要求不超过1000字");
        if(c.get("output_draft")!=null && c.get("approved_task_id")==null) request.set("previous",tasks.parse((String)c.get("output_draft")));
        request.set("configuration",json.valueToTree(models.resolved(a.workspaceId())));
        request.set("memories",json.valueToTree(conversations.memories(a,(String)c.get("employee_id")).stream().filter(m->Boolean.TRUE.equals(m.get("enabled"))).limit(8).map(m->Map.of("kind",m.get("kind"),"content",m.get("content"))).toList()));
        request.set("history",json.valueToTree(db.query("SELECT t.snapshot FROM conversation_turns c JOIN tasks t ON t.task_id=c.task_id WHERE c.conversation_id=? AND t.status='SUCCESS' ORDER BY c.id DESC LIMIT 3",(rs,i)-> {
            var t=tasks.parse(rs.getString(1));return Map.of("goal",t.path("prompt").asText(),"output",t.path("result").path("data").path("output").asText().substring(0,Math.min(1500,t.path("result").path("data").path("output").asText().length())));
        },id)));
        ObjectNode draft=validate(runtime.call("/v1/output-preview",request,55));draft.put("goal",goal);
        // Network call is outside a transaction. CAS prevents stale tabs overwriting a newer preview/approval.
        if(db.update("UPDATE conversations SET output_draft=?,draft_revision=draft_revision+1,approved_task_id=NULL,updated_at=? WHERE id=? AND draft_revision=? AND archived=FALSE AND COALESCE(approved_task_id,'')=? AND NOT EXISTS (SELECT 1 FROM conversation_turns ct JOIN tasks t ON t.task_id=ct.task_id WHERE ct.conversation_id=? AND t.status IN ('PENDING','RUNNING','PENDING_CONFIRMATION'))",draft.toString(),Instant.now().toString(),id,revision,Objects.toString(c.get("approved_task_id"),""),id)!=1)
            throw new ResponseStatusException(CONFLICT,"方案已更新或会话已归档，请刷新后重试");
        if(db.queryForObject("SELECT COUNT(*) FROM conversation_turns WHERE conversation_id=?",Integer.class,id)==0)
            db.update("UPDATE conversations SET title=? WHERE id=? AND title='新会话'",goal.substring(0,Math.min(24,goal.length())),id);
        return draft.put("revision",revision+1);
    }
    private ObjectNode validate(JsonNode input) {
        ObjectNode d=json.createObjectNode();
        for(String field:List.of("title","output_type","length","style","notes")) {
            String value=input.path(field).asText(); int max=field.equals("notes")?600:120;
            if(value.length()>max || (!field.equals("notes") && value.isBlank())) throw new ResponseStatusException(BAD_REQUEST,"输出方案字段无效："+field);
            d.put(field,value);
        }
        if(!input.path("format").asText().equals("Markdown")) throw new ResponseStatusException(BAD_REQUEST,"当前支持 Markdown 交付");
        String mode=input.path("generation_mode").asText("single");
        if(!Set.of("single","chapters").contains(mode)) throw new ResponseStatusException(BAD_REQUEST,"生成方式无效");
        d.put("generation_mode",mode);
        d.put("format","Markdown"); var sections=d.putArray("sections"); var values=input.path("sections");
        if(!values.isArray() || values.isEmpty() || values.size()>10) throw new ResponseStatusException(BAD_REQUEST,"目录需为1至10节");
        for(var s:values) { if(!s.isTextual() || s.asText().isBlank() || s.asText().length()>100) throw new ResponseStatusException(BAD_REQUEST,"章节标题需为1至100字"); sections.add(s.asText()); }
        return d;
    }
    @Transactional public ObjectNode edit(Identity a,String id,JsonNode b) {
        a.requireWrite();var c=conversations.owned(a,id,true);idle(id,c);
        if(c.get("output_draft")==null || c.get("approved_task_id")!=null || b.path("revision").asInt(-1)!=((Number)c.get("draft_revision")).intValue()) throw new ResponseStatusException(CONFLICT,"方案已更新或执行，请刷新");
        var draft=validate(b);draft.put("goal",tasks.parse((String)c.get("output_draft")).path("goal").asText());
        db.update("UPDATE conversations SET output_draft=?,draft_revision=draft_revision+1,updated_at=? WHERE id=?",draft.toString(),Instant.now().toString(),id);
        return draft.put("revision",((Number)c.get("draft_revision")).intValue()+1);
    }
    @Transactional public ObjectNode approve(Identity a,String id,int revision) {
        a.requireWrite();var c=conversations.owned(a,id,true);
        if(c.get("output_draft")==null || revision!=((Number)c.get("draft_revision")).intValue()) throw new ResponseStatusException(CONFLICT,"方案已更新，请查看最新方案后批准");
        if(c.get("approved_task_id")!=null) return tasks.visible((String)c.get("approved_task_id"),a);
        idle(id,c); var draft=tasks.parse((String)c.get("output_draft"));
        var task=conversations.submit(a,id,draft.path("goal").asText(),"approved-"+revision);
        String taskId=task.path("task_id").asText();
        db.update("UPDATE conversation_turns SET output_spec=? WHERE task_id=?",draft.toString(),taskId);
        db.update("UPDATE conversations SET approved_task_id=? WHERE id=?",taskId,id);
        tasks.event(taskId,"output.approved",draft);
        return task;
    }
}
