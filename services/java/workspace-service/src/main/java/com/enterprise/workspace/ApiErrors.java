package com.enterprise.workspace;

import java.util.Map;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

@RestControllerAdvice
public class ApiErrors {
    @ExceptionHandler(org.springframework.web.multipart.MaxUploadSizeExceededException.class) ResponseEntity<?> oversized() {
        return ResponseEntity.status(413).body(Map.of("detail","文件超过5MB限制"));
    }
    @ExceptionHandler(ResponseStatusException.class) ResponseEntity<?> known(ResponseStatusException e) {
        return ResponseEntity.status(e.getStatusCode()).body(Map.of("detail",e.getReason()==null ? "请求失败" : e.getReason()));
    }
    @ExceptionHandler(DuplicateKeyException.class) ResponseEntity<?> duplicate() {
        return ResponseEntity.status(409).body(Map.of("detail","记录已存在，请刷新或更换名称"));
    }
    @ExceptionHandler(Exception.class) ResponseEntity<?> unexpected(Exception e) {
        return ResponseEntity.status(503).body(Map.of("detail","服务暂不可用，请稍后重试"));
    }
}
