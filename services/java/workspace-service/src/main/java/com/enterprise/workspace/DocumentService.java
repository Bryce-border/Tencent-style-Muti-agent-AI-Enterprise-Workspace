package com.enterprise.workspace;

import com.enterprise.workspace.IdentityService.Identity;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import static org.springframework.http.HttpStatus.*;

@Service
public class DocumentService {
    private final JdbcTemplate db; private final RuntimeClient runtime; private final ObjectMapper json;
    private final IdentityService identities; private final TransactionTemplate transaction; private final boolean enabled;
    public DocumentService(JdbcTemplate db,RuntimeClient runtime,ObjectMapper json,IdentityService identities,
            org.springframework.transaction.PlatformTransactionManager manager,@Value("${workspace.dispatch-enabled}") boolean enabled) {
        this.db=db;this.runtime=runtime;this.json=json;this.identities=identities;this.transaction=new TransactionTemplate(manager);this.enabled=enabled;
    }
    public List<Map<String,Object>> list(String space) {
        return db.queryForList("SELECT d.*,v.filename,v.byte_size,v.status,v.chunk_count,v.error FROM documents d JOIN document_versions v ON v.document_id=d.id AND v.version=d.latest_version WHERE d.workspace_id=? ORDER BY d.created_at DESC LIMIT 200",space);
    }
    public Map<String,Object> owned(String id,String space,boolean lock) {
        var rows=db.queryForList("SELECT * FROM documents WHERE id=? AND workspace_id=?"+(lock?" FOR UPDATE":""),id,space);
        if(rows.isEmpty()) throw new ResponseStatusException(NOT_FOUND,"文档不存在");return rows.getFirst();
    }
    public Map<String,Object> detail(String id,String space) {
        var value=owned(id,space,false);
        value.put("versions",db.queryForList("SELECT version,filename,byte_size,status,extracted_text,chunk_count,error,created_at FROM document_versions WHERE document_id=? ORDER BY version DESC",id));
        return value;
    }
    private void idle(String id) {
        if(db.queryForObject("SELECT COUNT(*) FROM document_versions WHERE document_id=? AND status IN ('PENDING','INDEXING')",Integer.class,id)>0)
            throw new ResponseStatusException(CONFLICT,"文档正在入库，请等待处理结束");
    }
    @Transactional public Object upload(Identity actor,String id,MultipartFile file) {
        actor.requireWrite(); String filename=Optional.ofNullable(file.getOriginalFilename()).orElse("").replace('\\','/');
        filename=filename.substring(filename.lastIndexOf('/')+1);
        if(filename.length()>255 || !filename.toLowerCase(Locale.ROOT).matches(".+\\.(txt|md|csv|pdf|docx|xlsx)") || filename.chars().anyMatch(Character::isISOControl) || file.isEmpty() || file.getSize()>5*1024*1024)
            throw new ResponseStatusException(BAD_REQUEST,"请选择5MB以内的TXT、Markdown、CSV、PDF、DOCX或XLSX文件");
        int version=1;
        if(id==null) {
            id="D-"+UUID.randomUUID();
            db.update("INSERT INTO documents(id,workspace_id,title,created_at) VALUES (?,?,?,?)",id,actor.workspaceId(),filename,Instant.now().toString());
        } else {
            var doc=owned(id,actor.workspaceId(),true);idle(id);
            if(Boolean.TRUE.equals(doc.get("archived"))) throw new ResponseStatusException(CONFLICT,"请先恢复归档文档");
            version=((Number)doc.get("latest_version")).intValue()+1;
        }
        ObjectNode body=json.createObjectNode().put("workspace_id",actor.workspaceId()).put("document_id",id).put("filename",filename);
        try {body.put("content_base64",Base64.getEncoder().encodeToString(file.getBytes()));}
        catch(Exception ex) {throw new ResponseStatusException(BAD_REQUEST,"无法读取上传文件");}
        var stored=runtime.call("/v1/files/store",body);
        db.update("INSERT INTO document_versions(document_id,version,filename,object_key,byte_size,status,created_at) VALUES (?,?,?,?,?,'PENDING',?)",id,version,filename,stored.path("object_key").asText(),file.getSize(),Instant.now().toString());
        db.update("UPDATE documents SET latest_version=?,title=? WHERE id=?",version,filename,id);
        identities.audit(actor,"document.upload",id);return detail(id,actor.workspaceId());
    }
    public byte[] download(String id,int version,String space) {
        owned(id,space,false);var rows=db.queryForList("SELECT object_key,filename FROM document_versions WHERE document_id=? AND version=?",id,version);
        if(rows.isEmpty()) throw new ResponseStatusException(NOT_FOUND,"文档版本不存在");
        var body=json.createObjectNode().put("workspace_id",space).put("document_id",id).put("object_key",(String)rows.getFirst().get("object_key"));
        return Base64.getDecoder().decode(runtime.call("/v1/files/download",body).path("content_base64").asText());
    }
    @Transactional public Object retry(Identity actor,String id) {
        actor.requireWrite();var doc=owned(id,actor.workspaceId(),true);idle(id);
        if(Boolean.TRUE.equals(doc.get("archived"))) throw new ResponseStatusException(CONFLICT,"请先恢复归档文档");
        if(db.update("UPDATE document_versions SET status='PENDING',error=NULL,job_token=NULL WHERE document_id=? AND version=? AND status='FAILED'",id,doc.get("latest_version"))!=1)
            throw new ResponseStatusException(CONFLICT,"只有失败版本可以重试");
        identities.audit(actor,"document.retry",id);return detail(id,actor.workspaceId());
    }
    @Transactional public Object archive(Identity actor,String id,boolean archived) {
        actor.requireWrite();owned(id,actor.workspaceId(),true);idle(id);
        runtime.call("/v1/files/exclude",json.createObjectNode().put("workspace_id",actor.workspaceId()).put("document_id",id).put("excluded",archived));
        db.update("UPDATE documents SET archived=? WHERE id=?",archived,id);identities.audit(actor,archived?"document.archive":"document.restore",id);
        return detail(id,actor.workspaceId());
    }
    @Scheduled(fixedDelay=3000) public void indexPending() {
        if(!enabled) return;
        db.update("UPDATE document_versions SET status='FAILED',error='处理超时，可重试',job_token=NULL WHERE status='INDEXING' AND started_ms<?",System.currentTimeMillis()-300000);
        for(var candidate:db.queryForList("SELECT document_id,version FROM document_versions WHERE status='PENDING' ORDER BY created_at LIMIT 1")) {
            String id=(String)candidate.get("document_id"),token=UUID.randomUUID().toString();int version=((Number)candidate.get("version")).intValue();
            if(db.update("UPDATE document_versions SET status='INDEXING',job_token=?,started_ms=? WHERE document_id=? AND version=? AND status='PENDING'",token,System.currentTimeMillis(),id,version)!=1) continue;
            var row=db.queryForMap("SELECT d.workspace_id,d.title,v.filename,v.object_key FROM documents d JOIN document_versions v ON d.id=v.document_id WHERE d.id=? AND v.version=?",id,version);
            ObjectNode body=json.valueToTree(row);body.put("document_id",id).put("version",version);
            try {
                var result=runtime.call("/v1/files/index",body,210);
                transaction.executeWithoutResult(status->{
                    if(db.update("UPDATE document_versions SET status='READY',extracted_text=?,chunk_count=?,error=NULL WHERE document_id=? AND version=? AND job_token=? AND status='INDEXING'",result.path("text").asText(),result.path("chunk_count").asInt(),id,version,token)==1)
                        db.update("UPDATE documents SET active_version=? WHERE id=?",version,id);
                });
            } catch(Exception ex) {
                String message=ex instanceof ResponseStatusException r?r.getReason():"文档处理失败，可重试";
                db.update("UPDATE document_versions SET status='FAILED',error=? WHERE document_id=? AND version=? AND job_token=? AND status='INDEXING'",message,id,version,token);
            }
        }
    }
}
