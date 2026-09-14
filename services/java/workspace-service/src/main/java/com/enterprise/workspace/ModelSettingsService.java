package com.enterprise.workspace;

import com.enterprise.workspace.IdentityService.Identity;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import static org.springframework.http.HttpStatus.*;

@Service
public class ModelSettingsService {
    private final JdbcTemplate db; private final IdentityService identities; private final ObjectMapper json;
    private final SecretKeySpec encryptionKey; private final Set<String> allowedHosts;
    private final RuntimeClient runtime;
    private HttpClient client;
    private synchronized HttpClient client() {
        if(client==null) client=HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();
        return client;
    }
    public ModelSettingsService(JdbcTemplate db,IdentityService identities,ObjectMapper json,RuntimeClient runtime,
            @Value("${workspace.config-key:}") String key,@Value("${workspace.model-api-hosts}") String hosts) {
        this.db=db;this.identities=identities;this.json=json;this.runtime=runtime;
        allowedHosts=new HashSet<>(Arrays.asList(hosts.toLowerCase(Locale.ROOT).split(",")));
        try { encryptionKey=key.length()<32?null:new SecretKeySpec(MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8)),"AES"); }
        catch(Exception ex) { throw new IllegalStateException("Model encryption initialization failed"); }
    }
    public Map<String,Object> view(String space) {
        var rows=db.queryForList("SELECT base_url,model,temperature,max_tokens,revision,updated_at FROM model_settings WHERE workspace_id=?",space);
        var result=new LinkedHashMap<String,Object>();
        if (!rows.isEmpty()) result.putAll(rows.getFirst());
        result.put("source",rows.isEmpty()?"environment":"workspace"); result.put("has_key",!rows.isEmpty());
        result.put("editable",encryptionKey!=null); result.put("allowed_hosts",allowedHosts.stream().sorted().toList());
        return result;
    }
    public Map<String,Object> publicView(String space) {
        var result=view(space);
        if(result.get("source").equals("environment")) {
            var defaults=runtime.call("/v1/model-defaults",null);
            for(String field:List.of("base_url","model","temperature","max_tokens")) if(defaults.has(field)) result.put(field,defaults.get(field));
            result.put("has_key",!defaults.path("api_key").asText().isBlank());
        }
        return result;
    }
    private Map<String,Object> candidate(Identity actor,JsonNode body) {
        actor.requireAdmin();
        String base=body.path("base_url").asText().strip().replaceAll("/+$",""),model=body.path("model").asText().strip(),key=body.path("api_key").asText("");
        validateEndpoint(base);
        if (!model.matches("[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,149}")) throw new ResponseStatusException(BAD_REQUEST,"模型名称格式无效");
        double temperature=body.path("temperature").asDouble(0.2); int maxTokens=body.path("max_tokens").asInt(1800);
        if (!Double.isFinite(temperature) || temperature<0 || temperature>2 || maxTokens<128 || maxTokens>16384)
            throw new ResponseStatusException(BAD_REQUEST,"温度需为0至2，输出上限需为128至16384");
        var saved=resolved(actor.workspaceId());
        if(key.isBlank() && saved.isEmpty() && body.path("use_environment_key").asBoolean()) {
            var defaults=runtime.call("/v1/model-defaults",null);
            if(!base.equals(defaults.path("base_url").asText().replaceAll("/+$","")))
                throw new ResponseStatusException(BAD_REQUEST,"部署密钥只能用于原API地址");
            key=defaults.path("api_key").asText();
        }
        if (key.isBlank()) {
            if (saved.isEmpty()) throw new ResponseStatusException(BAD_REQUEST,"首次配置需要API密钥");
            if (!base.equals(saved.get("base_url"))) throw new ResponseStatusException(BAD_REQUEST,"更换API地址时请重新填写密钥");
            key=(String)saved.get("api_key");
        }
        if (key.length()<8 || key.length()>4096 || key.chars().anyMatch(Character::isWhitespace))
            throw new ResponseStatusException(BAD_REQUEST,"API密钥格式无效");
        return Map.of("base_url",base,"model",model,"api_key",key,"temperature",temperature,"max_tokens",maxTokens);
    }
    private void validateEndpoint(String base) {
        try {
            URI uri=URI.create(base);
            if (!"https".equals(uri.getScheme()) || uri.getHost()==null || !allowedHosts.contains(uri.getHost().toLowerCase(Locale.ROOT)) ||
                    uri.getRawUserInfo()!=null || uri.getRawQuery()!=null || uri.getRawFragment()!=null || (uri.getPort()!=-1 && uri.getPort()!=443) || base.length()>500)
                throw new IllegalArgumentException();
        } catch(Exception ex) { throw new ResponseStatusException(BAD_REQUEST,"API地址需为服务器允许域名的HTTPS地址"); }
    }
    @Transactional public Map<String,Object> save(Identity actor,JsonNode body) {
        actor.requireAdmin(); requireEncryption();
        db.queryForObject("SELECT id FROM workspaces WHERE id=? FOR UPDATE",String.class,actor.workspaceId());
        var values=candidate(actor,body);
        var revision=db.queryForList("SELECT revision FROM model_settings WHERE workspace_id=?",Long.class,actor.workspaceId());
        long next=revision.isEmpty()?1:revision.getFirst()+1;
        String encrypted=crypt(actor.workspaceId(),(String)values.get("api_key"),true);
        db.update("DELETE FROM model_settings WHERE workspace_id=?",actor.workspaceId());
        db.update("INSERT INTO model_settings VALUES (?,?,?,?,?,?,?,?)",actor.workspaceId(),values.get("base_url"),values.get("model"),encrypted,values.get("temperature"),values.get("max_tokens"),next,Instant.now().toString());
        identities.audit(actor,"model.settings.save",actor.workspaceId()); return view(actor.workspaceId());
    }
    @Transactional public Map<String,Object> reset(Identity actor) {
        actor.requireAdmin(); db.queryForObject("SELECT id FROM workspaces WHERE id=? FOR UPDATE",String.class,actor.workspaceId());
        db.update("DELETE FROM model_settings WHERE workspace_id=?",actor.workspaceId()); identities.audit(actor,"model.settings.reset",actor.workspaceId()); return view(actor.workspaceId());
    }
    public Map<String,Object> test(Identity actor,JsonNode body) {
        var values=candidate(actor,body); long started=System.nanoTime();
        try {
            var payload=Map.of("model",values.get("model"),"messages",List.of(Map.of("role","user","content","Reply with OK.")),"max_tokens",16,"stream",false);
            var request=HttpRequest.newBuilder(URI.create(values.get("base_url")+"/chat/completions")).timeout(Duration.ofSeconds(20))
                .header("Authorization","Bearer "+values.get("api_key")).header("Content-Type","application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(payload))).build();
            var response=client().send(request,HttpResponse.BodyHandlers.ofString());
            if(response.statusCode()!=200) throw new ResponseStatusException(BAD_GATEWAY,"模型连接失败（HTTP "+response.statusCode()+"），请检查地址、模型名称和密钥");
            var data=json.readTree(response.body());
            if(!data.path("choices").isArray() || data.path("choices").isEmpty()) throw new ResponseStatusException(BAD_GATEWAY,"响应不符合Chat Completions格式");
            identities.audit(actor,"model.settings.test",actor.workspaceId());
            return Map.of("ok",true,"model",values.get("model"),"latency_ms",(System.nanoTime()-started)/1000000);
        } catch(ResponseStatusException ex) { throw ex; }
        catch(Exception ex) { throw new ResponseStatusException(BAD_GATEWAY,"模型连接超时或响应异常，请检查API配置"); }
    }
    public Map<String,Object> resolved(String space) {
        var rows=db.queryForList("SELECT * FROM model_settings WHERE workspace_id=?",space);
        if(rows.isEmpty()) return Map.of();
        var value=new LinkedHashMap<>(rows.getFirst());
        value.put("api_key",crypt(space,(String)value.remove("encrypted_key"),false)); value.remove("workspace_id"); return value;
    }
    private void requireEncryption() {
        if(encryptionKey==null) throw new ResponseStatusException(SERVICE_UNAVAILABLE,"服务器尚未配置模型密钥加密，请运行环境初始化脚本");
    }
    private String crypt(String space,String value,boolean encrypt) {
        requireEncryption();
        try {
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding"); byte[] nonce=new byte[12],payload;
            if(encrypt) {new SecureRandom().nextBytes(nonce);payload=value.getBytes(StandardCharsets.UTF_8);}
            else {byte[] packed=Base64.getDecoder().decode(value);nonce=Arrays.copyOfRange(packed,0,12);payload=Arrays.copyOfRange(packed,12,packed.length);}
            cipher.init(encrypt?Cipher.ENCRYPT_MODE:Cipher.DECRYPT_MODE,encryptionKey,new GCMParameterSpec(128,nonce));
            cipher.updateAAD(space.getBytes(StandardCharsets.UTF_8)); byte[] result=cipher.doFinal(payload);
            if(!encrypt) return new String(result,StandardCharsets.UTF_8);
            byte[] packed=Arrays.copyOf(nonce,nonce.length+result.length);System.arraycopy(result,0,packed,nonce.length,result.length);
            return Base64.getEncoder().encodeToString(packed);
        } catch(Exception ex) {throw new ResponseStatusException(SERVICE_UNAVAILABLE,"模型密钥解密失败，请检查服务器加密配置");}
    }
}
