package com.enterprise.workspace;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.Cookie;
import java.util.Map;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"spring.datasource.url=jdbc:h2:mem:foundation;MODE=MySQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE","spring.datasource.username=sa","spring.datasource.password=","workspace.jwt-secret=test-secret-at-least-thirty-two-characters","workspace.config-key=test-model-key-at-least-thirty-two-characters","workspace.internal-token=test-internal-token-at-least-thirty-two-characters","workspace.bootstrap-password=","workspace.dispatch-enabled=false"})
@AutoConfigureMockMvc
class FoundationTests {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired TaskRepository tasks;
    @Autowired JdbcTemplate db;
    @Autowired ModelSettingsService models;
    @MockitoBean StringRedisTemplate redis;
    @MockitoBean RuntimeClient runtime;
    private final Map<String,String> sessions=new ConcurrentHashMap<>();

    @BeforeEach @SuppressWarnings("unchecked") void setupRedis() {
        ValueOperations<String,String> values=mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        when(values.increment(anyString())).thenReturn(1L);
        when(values.get(anyString())).thenAnswer(a->sessions.get(a.getArgument(0)));
        doAnswer(a->{sessions.put(a.getArgument(0),a.getArgument(1));return null;}).when(values).set(anyString(),anyString(),any(java.time.Duration.class));
        when(redis.delete(anyString())).thenAnswer(a->sessions.remove(a.getArgument(0))!=null);
    }
    record Account(String username,Cookie cookie,String space) {}
    Account account() throws Exception {
        String username="test_"+UUID.randomUUID().toString().substring(0,8);
        MvcResult response=mvc.perform(post("/auth/register").header("X-Workspace-Request","1").contentType("application/json")
            .content(json.writeValueAsString(Map.of("username",username,"password","test-password-12345","workspace_name",username))))
            .andExpect(status().isOk()).andReturn();
        return new Account(username,response.getResponse().getCookie("workspace_session"),json.readTree(response.getResponse().getContentAsString()).path("workspace_id").asText());
    }
    ObjectNode create(Account account) throws Exception {
        var response=mvc.perform(post("/v1/tasks").cookie(account.cookie()).header("X-Workspace-Request","1").contentType("application/json")
            .content("{\"prompt\":\"test local task\",\"employee_id\":\"document_expert\",\"workspace_id\":\"default\"}"))
            .andExpect(status().isAccepted()).andReturn();
        return (ObjectNode)json.readTree(response.getResponse().getContentAsString());
    }
    @Test void unauthenticatedAndInternalRequestsAreRejected() throws Exception {
        mvc.perform(get("/v1/tasks")).andExpect(status().isUnauthorized());
        mvc.perform(get("/internal/tasks/nope")).andExpect(status().isUnauthorized());
    }
    @Test void cookieIsHttpOnlyAndLogoutRevokesSession() throws Exception {
        var a=account(); assertTrue(a.cookie().isHttpOnly());
        mvc.perform(get("/auth/me").cookie(a.cookie())).andExpect(status().isOk());
        mvc.perform(post("/auth/logout").cookie(a.cookie()).header("X-Workspace-Request","1")).andExpect(status().isOk());
        mvc.perform(get("/auth/me").cookie(a.cookie())).andExpect(status().isUnauthorized());
    }
    @Test void csrfHeaderAndOriginAreRequired() throws Exception {
        var a=account();
        mvc.perform(post("/auth/logout").cookie(a.cookie())).andExpect(status().isForbidden());
        mvc.perform(post("/auth/logout").cookie(a.cookie()).header("X-Workspace-Request","1").header("Origin","https://untrusted.example")).andExpect(status().isForbidden());
    }
    @Test void taskOwnershipIsServerControlledAcrossEveryReadAndWrite() throws Exception {
        var a=account();var b=account();var task=create(a);String id=task.path("task_id").asText();
        assertEquals(a.space(),task.path("workspace_id").asText());
        for(String suffix:new String[]{"","/events","/stream","/export"})
            mvc.perform(get("/v1/tasks/"+id+suffix).cookie(b.cookie())).andExpect(status().isNotFound());
        for(String action:new String[]{"cancel","confirm"})
            mvc.perform(post("/v1/tasks/"+id+"/"+action).cookie(b.cookie()).header("X-Workspace-Request","1")).andExpect(status().isNotFound());
        mvc.perform(get("/v1/tasks?workspace_id="+a.space()).cookie(b.cookie())).andExpect(content().json("[]"));
        mvc.perform(get("/v1/reports/"+id).cookie(b.cookie())).andExpect(status().isNotFound());
        mvc.perform(post("/auth/workspace").cookie(b.cookie()).header("X-Workspace-Request","1").contentType("application/json").content("{\"workspace_id\":\""+a.space()+"\"}")).andExpect(status().isForbidden());
    }
    @Test void viewerCanReadButCannotMutateOrManageMembers() throws Exception {
        var a=account();var b=account();
        mvc.perform(post("/v1/admin/members").cookie(a.cookie()).header("X-Workspace-Request","1").contentType("application/json")
            .content(json.writeValueAsString(Map.of("username",b.username(),"role","VIEWER")))).andExpect(status().isOk());
        var switched=mvc.perform(post("/auth/workspace").cookie(b.cookie()).header("X-Workspace-Request","1").contentType("application/json")
            .content(json.writeValueAsString(Map.of("workspace_id",a.space())))).andExpect(status().isOk()).andReturn().getResponse().getCookie("workspace_session");
        mvc.perform(get("/v1/tasks").cookie(switched)).andExpect(status().isOk());
        mvc.perform(post("/v1/tasks").cookie(switched).header("X-Workspace-Request","1").contentType("application/json").content("{\"prompt\":\"forbidden\"}")).andExpect(status().isForbidden());
        mvc.perform(get("/v1/admin/members").cookie(switched)).andExpect(status().isForbidden());
        mvc.perform(post("/v1/admin/members").cookie(a.cookie()).header("X-Workspace-Request","1").contentType("application/json")
            .content(json.writeValueAsString(Map.of("username",a.username(),"role","VIEWER")))).andExpect(status().isConflict());
    }
    @Test void leaseFencesStaleWorkerAfterRecoveryAndCancellation() throws Exception {
        var a=account(); var task=create(a);String id=task.path("task_id").asText();String old=UUID.randomUUID().toString(),next=UUID.randomUUID().toString();
        assertTrue(tasks.claim(id,old));assertFalse(tasks.claim(id,next));
        db.update("UPDATE tasks SET lease_until=0 WHERE task_id=?",id); tasks.recover(id);
        assertEquals("PENDING",tasks.get(id).path("status").asText());assertTrue(tasks.claim(id,next));
        task.put("status","SUCCESS");assertFalse(tasks.save(id,old,task));assertFalse(tasks.heartbeat(id,old));
        tasks.action(id,a.space(),"cancel");assertFalse(tasks.save(id,next,task));assertFalse(tasks.workerEvent(id,next,"late",json.createObjectNode()));
        assertEquals("CANCELLED",tasks.get(id).path("status").asText());
    }
    @Test void recoveriesAreBoundedAndTaskHasVisibleError() throws Exception {
        var a=account();String id=create(a).path("task_id").asText();
        for(int i=0;i<3;i++){assertTrue(tasks.claim(id,UUID.randomUUID().toString()));db.update("UPDATE tasks SET lease_until=0 WHERE task_id=?",id);tasks.recover(id);}
        assertEquals("FAILED",tasks.get(id).path("status").asText());assertFalse(tasks.get(id).path("result").path("error").asText().isBlank());
    }
    @Test void idempotencyKeysCannotCreateDuplicateTasksOrChangeRequest() throws Exception {
        var a=account();String key=UUID.randomUUID().toString();
        var first=tasks.create(a.space(),"same prompt","document_expert",key);
        assertEquals(first,tasks.create(a.space(),"same prompt","document_expert",key));
        assertThrows(org.springframework.web.server.ResponseStatusException.class,()->tasks.create(a.space(),"different prompt","document_expert",key));
    }
    @Test void approvalArchivesRealDeliveryAndBlocksExternalWrites() throws Exception {
        var a=account();var task=create(a);String id=task.path("task_id").asText();String token=UUID.randomUUID().toString();tasks.claim(id,token);
        task.put("status","PENDING_CONFIRMATION");
        var result=json.createObjectNode().put("status","PENDING_CONFIRMATION").put("next_action","CONNECTOR_REQUIRED");result.putObject("data").put("mode","crewai").put("output","real output");task.set("result",result);
        tasks.save(id,token,task);
        assertThrows(org.springframework.web.server.ResponseStatusException.class,()->tasks.action(id,a.space(),"confirm"));
        String second=create(a).path("task_id").asText();var accepted=tasks.get(second);String lease=UUID.randomUUID().toString();tasks.claim(second,lease);
        accepted.put("status","PENDING_CONFIRMATION");result.put("next_action","REVIEW_DELIVERABLE");accepted.set("result",result);tasks.save(second,lease,accepted);
        tasks.action(second,a.space(),"confirm");assertEquals("real output",tasks.report(second,a.space()).get("content"));
        assertEquals(1,tasks.reports(a.space()).size());
    }
    @Test void knowledgeScopeIsDerivedFromIdentityAndObjectIdsAreNamespaced() throws Exception {
        var a=account();when(runtime.call(anyString(),any())).thenReturn(json.createObjectNode());
        mvc.perform(get("/v1/knowledge/search?q=policy&workspace_id=another").cookie(a.cookie())).andExpect(status().isOk());
        verify(runtime).call(contains("workspace_id="+a.space()),isNull());
        mvc.perform(post("/v1/knowledge/documents").cookie(a.cookie()).header("X-Workspace-Request","1").contentType("application/json")
            .content("{\"document_id\":\"same-id\",\"workspace_id\":\"another\",\"title\":\"Policy\",\"content\":\"Tenant policy\"}")).andExpect(status().isOk());
        verify(runtime).call(eq("/v1/knowledge/documents"),argThat(node->node.path("workspace_id").asText().equals(a.space())&&node.path("document_id").asText().equals(a.space()+"_same-id")));
    }

    @Test void sseCompletesThroughSecurityAsyncDispatchAndHonorsCursor() throws Exception {
        var a=account();String id=create(a).path("task_id").asText();
        long first=((Number)tasks.events(id,0).getFirst().get("id")).longValue();
        tasks.action(id,a.space(),"cancel");
        var response=mvc.perform(get("/v1/tasks/"+id+"/stream").cookie(a.cookie()).header("Last-Event-ID",Long.toString(first)))
            .andExpect(request().asyncStarted()).andReturn();
        response.getAsyncResult(3000);
        var body=mvc.perform(asyncDispatch(response)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertTrue(body.contains("task.cancelled"));assertFalse(body.contains("task.created"));
    }

    @Test void legacyRetrievalCandidatesAreNotPresentedOrExportedAsCitations() throws Exception {
        var a=account(); var task=create(a); String id=task.path("task_id").asText(); String lease=UUID.randomUUID().toString();
        tasks.claim(id,lease); task.put("status","SUCCESS");
        var result=task.putObject("result"); result.put("status","SUCCESS");
        result.putObject("data").put("mode","crewai").put("output","Completed weekly report.");
        result.putArray("citations").addObject().put("title","Travel policy").put("content","Submit in 30 days.");
        tasks.save(id,lease,task);
        mvc.perform(get("/v1/tasks/"+id).cookie(a.cookie())).andExpect(status().isOk()).andExpect(jsonPath("$.result.citations").isEmpty());
        mvc.perform(get("/v1/tasks").cookie(a.cookie())).andExpect(status().isOk()).andExpect(jsonPath("$[0].result.citations").isEmpty());
        String exported=mvc.perform(get("/v1/tasks/"+id+"/export").cookie(a.cookie())).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertTrue(exported.contains("Completed weekly report.")); assertFalse(exported.contains("Travel policy"));
        assertEquals(1,tasks.get(id).path("result").path("citations").size());
        assertEquals("Completed weekly report.",tasks.report(id,a.space()).get("content"));
    }

    @Test void citationViewKeepsExplicitSourcesAndDeduplicatesAcrossDocuments() {
        var task=json.createObjectNode(); var result=task.putObject("result");
        result.putObject("data").put("output","30天。[来源: 报销制度] [来源：leave-1] [来源: 占位制度]");
        var sources=result.putArray("citations");
        sources.addObject().put("title","报销制度").put("documentId","one").put("content","30天内提交。");
        sources.addObject().put("title","报销制度").put("documentId","two").put("content","３０天内提交。\n");
        sources.addObject().put("title","年假制度").put("chunkId","leave-1").put("content","提前3天申请。");
        sources.addObject().put("title","占位制度").put("content","x".repeat(1200));
        sources.addObject().put("title","未引用制度").put("content","无需展示。");
        assertEquals(2,CitationView.task(task).path("result").path("citations").size());
        assertEquals(5,result.path("citations").size());
    }

    @Test void modelSettingsEncryptSecretsAndScopeChangesToAdministrators() throws Exception {
        var a=account();var b=account();
        var body=json.createObjectNode().put("base_url","https://api.openai.com/v1").put("model","qwen3.7-flash").put("api_key","test-secret-never-public").put("temperature",0.3).put("max_tokens",2200);
        String response=mvc.perform(put("/v1/model-settings").cookie(a.cookie()).header("X-Workspace-Request","1").contentType("application/json").content(body.toString()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.source").value("workspace")).andReturn().getResponse().getContentAsString();
        assertFalse(response.contains("test-secret-never-public"));assertFalse(response.contains("encrypted_key"));
        String stored=db.queryForObject("SELECT encrypted_key FROM model_settings WHERE workspace_id=?",String.class,a.space());
        assertFalse(stored.contains("test-secret"));assertEquals("test-secret-never-public",models.resolved(a.space()).get("api_key"));
        assertTrue(models.resolved(b.space()).isEmpty());
        body.put("api_key","").put("model","kimi-k3");
        mvc.perform(put("/v1/model-settings").cookie(a.cookie()).header("X-Workspace-Request","1").contentType("application/json").content(body.toString())).andExpect(status().isOk());
        assertEquals("test-secret-never-public",models.resolved(a.space()).get("api_key"));assertEquals("kimi-k3",models.resolved(a.space()).get("model"));
        body.put("base_url","https://api.moonshot.cn/v1");
        mvc.perform(put("/v1/model-settings").cookie(a.cookie()).header("X-Workspace-Request","1").contentType("application/json").content(body.toString())).andExpect(status().isBadRequest());
        mvc.perform(post("/v1/admin/members").cookie(a.cookie()).header("X-Workspace-Request","1").contentType("application/json").content(json.writeValueAsString(Map.of("username",b.username(),"role","MEMBER")))).andExpect(status().isOk());
        var switched=mvc.perform(post("/auth/workspace").cookie(b.cookie()).header("X-Workspace-Request","1").contentType("application/json").content("{\"workspace_id\":\""+a.space()+"\"}")).andReturn().getResponse().getCookie("workspace_session");
        for(String method:List.of("PUT","DELETE","POST"))
            mvc.perform(request(org.springframework.http.HttpMethod.valueOf(method),method.equals("POST")?"/v1/model-settings/test":"/v1/model-settings").cookie(switched).header("X-Workspace-Request","1").contentType("application/json").content(body.toString())).andExpect(status().isForbidden());
        mvc.perform(get("/v1/model-settings").cookie(switched)).andExpect(status().isOk()).andExpect(jsonPath("$.api_key").doesNotExist());
        mvc.perform(delete("/v1/model-settings").cookie(a.cookie()).header("X-Workspace-Request","1")).andExpect(status().isOk());
        assertTrue(models.resolved(a.space()).isEmpty());
    }

    @Test void modelUrlsRejectInternalAddressesAndUnapprovedHostsBeforeNetworkAccess() throws Exception {
        var a=account();
        for(String url:List.of("http://localhost:8000/v1","https://127.0.0.1/v1","https://api.openai.com@localhost/v1","https://api.openai.com.evil.test/v1","https://api.openai.com/v1?key=secret")) {
            var body=json.createObjectNode().put("base_url",url).put("model","test").put("api_key","test-secret");
            mvc.perform(post("/v1/model-settings/test").cookie(a.cookie()).header("X-Workspace-Request","1").contentType("application/json").content(body.toString())).andExpect(status().isBadRequest());
        }
        verifyNoInteractions(runtime);
    }
}
