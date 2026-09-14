package com.enterprise.workspace;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import com.fasterxml.jackson.databind.ObjectMapper;
import static org.springframework.http.HttpStatus.*;

@Component
public class RuntimeClient {
    private final String url,token; private final ObjectMapper json;
    private final HttpClient client=HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(3)).build();
    public RuntimeClient(@Value("${workspace.runtime-url}") String url,@Value("${workspace.internal-token}") String token,ObjectMapper json) { this.url=url;this.token=token;this.json=json; }
    public JsonNode call(String path,JsonNode body) {
        return call(path,body,25);
    }
    public JsonNode call(String path,JsonNode body,int seconds) {
        try {
            var request=HttpRequest.newBuilder(URI.create(url+path)).timeout(Duration.ofSeconds(seconds)).header("X-Internal-Token",token);
            if (body!=null) request.header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(body.toString()));
            var response=client.send(request.build(),HttpResponse.BodyHandlers.ofString());
            if (response.statusCode()==422) throw new ResponseStatusException(UNPROCESSABLE_ENTITY,json.readTree(response.body()).path("detail").asText("文档内容无效，请检查文件格式和内容"));
            if (response.statusCode()!=200) throw new ResponseStatusException(SERVICE_UNAVAILABLE,"AI或检索服务暂不可用");
            return json.readTree(response.body());
        } catch (ResponseStatusException ex) { throw ex; }
        catch (Exception ex) { throw new ResponseStatusException(SERVICE_UNAVAILABLE,"AI或检索服务暂不可用"); }
    }
}
