package com.enterprise.workspace;

import com.enterprise.workspace.IdentityService.Identity;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import static org.springframework.http.HttpStatus.*;

@RestController
public class WorkspaceController {
    private static final List<String> EMPLOYEES=List.of("ai_assistant","data_analyst","document_expert","meeting_secretary","hr_assistant","crm_assistant","knowledge_expert","product_designer","ai_engineer");
    private final TaskRepository tasks; private final IdentityService identities; private final RuntimeClient runtime;
    private final JdbcTemplate db; private final ObjectMapper json;
    private final ModelSettingsService models;
    public WorkspaceController(TaskRepository tasks,IdentityService identities,RuntimeClient runtime,JdbcTemplate db,ObjectMapper json,ModelSettingsService models) {
        this.tasks=tasks;this.identities=identities;this.runtime=runtime;this.db=db;this.json=json;this.models=models;
    }
    @GetMapping("/health") Object health() { return Map.of("status","ok","service","workspace-service","version","0.3.0"); }
    @GetMapping("/v1/employees") Object employees(@AuthenticationPrincipal Identity actor) {
        var employees=runtime.call("/v1/employees",null);
        if(models.view(actor.workspaceId()).get("source").equals("workspace"))
            for(JsonNode item:employees) ((ObjectNode)item).put("status","available");
        return employees;
    }
    @GetMapping("/v1/dashboard") Object dashboard(@AuthenticationPrincipal Identity actor) {
        ObjectNode dashboard;
        try { dashboard=(ObjectNode)runtime.call("/v1/dashboard?workspace_id="+encode(actor.workspaceId()),null); }
        catch (ResponseStatusException ex) {
            dashboard=json.createObjectNode(); dashboard.set("knowledge",json.valueToTree(Map.of("documents",0,"chunks",0,"available",false)));
            dashboard.put("employee_count",9).put("employees_available",0); dashboard.set("runtime",json.valueToTree(Map.of("configured",false,"model","")));
        }
        dashboard.put("workspace_id",actor.workspaceId()); dashboard.set("tasks",json.valueToTree(tasks.stats(actor.workspaceId())));
        var model=models.view(actor.workspaceId());
        if(model.get("source").equals("workspace")) dashboard.set("runtime",json.valueToTree(Map.of("configured",true,"model",model.get("model"))));
        dashboard.put("reports",db.queryForObject("SELECT COUNT(*) FROM reports WHERE workspace_id=?",Integer.class,actor.workspaceId()));
        return dashboard;
    }
    @GetMapping("/v1/tasks") Object list(@AuthenticationPrincipal Identity actor,@RequestParam(defaultValue="20") int limit) { return tasks.visibleList(actor,limit).stream().map(CitationView::task).toList(); }
    @PostMapping("/v1/tasks") ResponseEntity<?> create(@AuthenticationPrincipal Identity actor,@RequestBody ObjectNode body,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        actor.requireWrite(); String prompt=body.path("prompt").asText(), employee=body.path("employee_id").asText("ai_assistant");
        if (prompt.isBlank() || prompt.length()>4000 || !EMPLOYEES.contains(employee)) throw new ResponseStatusException(BAD_REQUEST,"请提供有效员工与1至4000字的工作目标");
        var task=tasks.create(actor.workspaceId(),prompt,employee,key); identities.audit(actor,"task.create",task.path("task_id").asText());
        return ResponseEntity.accepted().body(task);
    }
    @GetMapping("/v1/tasks/{id}") Object get(@AuthenticationPrincipal Identity actor,@PathVariable String id) { return CitationView.task(tasks.visible(id,actor)); }
    @PostMapping("/v1/tasks/{id}/{action:cancel|confirm|retry}") Object action(@AuthenticationPrincipal Identity actor,@PathVariable String id,@PathVariable String action) {
        actor.requireWrite(); tasks.visible(id,actor); var task=action.equals("retry")?tasks.retryDocument(id,actor.workspaceId()):tasks.action(id,actor.workspaceId(),action); identities.audit(actor,"task."+action,id); return CitationView.task(task);
    }
    @GetMapping("/v1/tasks/{id}/events") Object events(@AuthenticationPrincipal Identity actor,@PathVariable String id,@RequestParam(defaultValue="0") long after) {
        tasks.visible(id,actor); return tasks.events(id,Math.max(0,after));
    }
    @GetMapping(value="/v1/tasks/{id}/stream",produces=MediaType.TEXT_EVENT_STREAM_VALUE)
    SseEmitter stream(@AuthenticationPrincipal Identity actor,@PathVariable String id,@RequestHeader(value="Last-Event-ID",defaultValue="0") String last) {
        tasks.visible(id,actor); long cursor;
        try { cursor=Long.parseLong(last); } catch (NumberFormatException ex) { cursor=0; }
        final long initial=Math.max(0,cursor); var emitter=new SseEmitter(30000L);
        Thread.startVirtualThread(()->{
            long position=initial;
            try {
                for(int turn=0;turn<50;turn++) {
                    identities.identity(actor.userId(),actor.workspaceId());
                    for(var event:tasks.events(id,position)) { position=((Number)event.get("id")).longValue(); emitter.send(SseEmitter.event().id(Long.toString(position)).data(event)); }
                    if (!List.of("PENDING","RUNNING").contains(tasks.visible(id,actor).path("status").asText())) break;
                    Thread.sleep(500);
                }
                emitter.complete();
            } catch (Exception ex) { emitter.completeWithError(ex); }
        }); return emitter;
    }
    @GetMapping("/v1/messages") Object messages(@AuthenticationPrincipal Identity actor) { return tasks.messages(actor); }
    @GetMapping("/v1/reports") Object reports(@AuthenticationPrincipal Identity actor) { return tasks.reports(actor); }
    @GetMapping("/v1/reports/{id}") Object report(@AuthenticationPrincipal Identity actor,@PathVariable String id) { tasks.visible(id,actor); return tasks.report(id,actor.workspaceId()); }
    @GetMapping("/v1/tasks/{id}/export") ResponseEntity<String> export(@AuthenticationPrincipal Identity actor,@PathVariable String id) {
        var task=CitationView.task(tasks.visible(id,actor)); var result=task.path("result");
        if (result.isNull() || result.isMissingNode()) throw new ResponseStatusException(CONFLICT,"任务尚未产生结果");
        String content="# "+task.path("prompt").asText()+"\n\n- 任务 ID：`"+id+"`\n- 状态：`"+task.path("status").asText()+"`\n\n## 结果\n\n"+result.path("data").path("output").asText()+"\n";
        if (result.path("citations").isArray() && !result.path("citations").isEmpty()) {
            content+="\n## 引用来源\n";
            for(JsonNode item:result.path("citations")) content+="\n- "+item.path("title").asText()+"："+item.path("content").asText()+"\n";
        }
        if (result.hasNonNull("error")) content+="\n## 错误\n\n"+result.path("error").asText()+"\n";
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_DISPOSITION,"attachment; filename=\""+id.replaceAll("[^a-zA-Z0-9_-]","")+".md\"")
            .contentType(MediaType.parseMediaType("text/markdown;charset=UTF-8")).body(content);
    }
    @GetMapping("/v1/knowledge/search") Object search(@AuthenticationPrincipal Identity actor,@RequestParam String q,@RequestParam(defaultValue="5") int limit) {
        if(q.isBlank() || q.length()>4000) throw new ResponseStatusException(BAD_REQUEST,"检索内容需为1至4000字");
        return runtime.call("/v1/knowledge/search?workspace_id="+encode(actor.workspaceId())+"&q="+encode(q)+"&limit="+Math.clamp(limit,1,20),null);
    }
    @PostMapping("/v1/knowledge/documents") Object index(@AuthenticationPrincipal Identity actor,@RequestBody ObjectNode body) {
        actor.requireWrite();
        if(body.path("content").asText().length()>100000 || body.path("content").asText().isBlank()) throw new ResponseStatusException(BAD_REQUEST,"文本需为1至100000字");
        if(!body.path("document_id").asText().matches("[a-zA-Z0-9_-]{1,80}")) throw new ResponseStatusException(BAD_REQUEST,"文档ID格式无效");
        body.put("workspace_id",actor.workspaceId());
        // Elasticsearch document keys must be globally unique even when two tenants choose the same local id.
        body.put("document_id",actor.workspaceId()+"_"+body.path("document_id").asText());
        var result=runtime.call("/v1/knowledge/documents",body); identities.audit(actor,"knowledge.index",body.path("document_id").asText()); return result;
    }
    @GetMapping("/v1/admin/members") Object members(@AuthenticationPrincipal Identity actor) { return identities.members(actor); }
    @PostMapping("/v1/admin/members") Object member(@AuthenticationPrincipal Identity actor,@RequestBody Map<String,String> body) {
        identities.addMember(actor,body.getOrDefault("username",""),body.getOrDefault("role","MEMBER")); return identities.members(actor);
    }
    @GetMapping("/v1/admin/audit") Object audit(@AuthenticationPrincipal Identity actor) {
        actor.requireAdmin(); return db.queryForList("SELECT * FROM audit_logs WHERE workspace_id=? ORDER BY id DESC LIMIT 100",actor.workspaceId());
    }
    private String encode(String value) { return URLEncoder.encode(value,StandardCharsets.UTF_8); }
}
