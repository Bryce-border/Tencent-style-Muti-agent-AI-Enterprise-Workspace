package com.enterprise.workspace;

import com.enterprise.workspace.IdentityService.Identity;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/v1/documents")
public class DocumentController {
    private final DocumentService documents;
    public DocumentController(DocumentService documents) {this.documents=documents;}
    @GetMapping Object list(@AuthenticationPrincipal Identity actor) {return documents.list(actor.workspaceId());}
    @GetMapping("/{id}") Object detail(@AuthenticationPrincipal Identity actor,@PathVariable String id) {return documents.detail(id,actor.workspaceId());}
    @PostMapping Object upload(@AuthenticationPrincipal Identity actor,@RequestPart("file") MultipartFile file) {return documents.upload(actor,null,file);}
    @PostMapping("/{id}/versions") Object version(@AuthenticationPrincipal Identity actor,@PathVariable String id,@RequestPart("file") MultipartFile file) {return documents.upload(actor,id,file);}
    @PostMapping("/{id}/retry") Object retry(@AuthenticationPrincipal Identity actor,@PathVariable String id) {return documents.retry(actor,id);}
    @PostMapping("/{id}/archive") Object archive(@AuthenticationPrincipal Identity actor,@PathVariable String id,@RequestBody Map<String,Boolean> body) {return documents.archive(actor,id,Boolean.TRUE.equals(body.get("archived")));}
    @GetMapping("/{id}/versions/{version}/download") ResponseEntity<byte[]> download(@AuthenticationPrincipal Identity actor,@PathVariable String id,@PathVariable int version) {
        return ResponseEntity.ok().header("Content-Type","application/octet-stream").header("X-Content-Type-Options","nosniff")
            .header("Content-Disposition","attachment; filename=\""+id.replaceAll("[^a-zA-Z0-9_-]","")+"-v"+version+"\"")
            .body(documents.download(id,version,actor.workspaceId()));
    }
}
