package com.enterprise.workspace;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.text.Normalizer;
import java.util.HashSet;
import java.util.Locale;
import java.util.regex.Pattern;

/** Public presentation of legacy snapshots; stored reports and audit events stay intact. */
final class CitationView {
    private static final Pattern MARKER=Pattern.compile("\\[来源\\s*[:：]\\s*([^\\]]+)\\]");
    private static final Pattern RUN=Pattern.compile("(.)\\1{31,}");
    private static final Pattern REPEATED=Pattern.compile("(.{2,40}?)\\1{7,}");
    private CitationView() {}

    static ObjectNode task(ObjectNode stored) {
        ObjectNode view=stored.deepCopy();
        if (view.get("result") instanceof ObjectNode result) {
            filter(result,result.path("data").path("output").asText());
            for (JsonNode node:result.path("data").path("node_results"))
                if (node instanceof ObjectNode object) filter(object,node.path("output").asText());
        }
        return view;
    }

    private static void filter(ObjectNode result,String output) {
        var markers=new HashSet<String>(); var matcher=MARKER.matcher(output);
        while(matcher.find()) markers.add(matcher.group(1).strip());
        ArrayNode selected=result.arrayNode(); var seen=new HashSet<String>();
        for(JsonNode source:result.path("citations")) {
            String key=Normalizer.normalize(source.path("content").asText(),Normalizer.Form.NFKC).replaceAll("\\s+","").toLowerCase(Locale.ROOT);
            if (!markers.contains(source.path("chunkId").asText()) && !markers.contains(source.path("title").asText())) continue;
            if (key.isBlank() || source.path("metadata").path("retrieval_excluded").asBoolean() || !usable(key) || !seen.add(key)) continue;
            selected.add(source);
        }
        result.set("citations",selected);
    }

    private static boolean usable(String text) {
        var runs=RUN.matcher(text);
        while(runs.find()) {
            String value=runs.group(1);
            if ((text.length()-text.replace(value,"").length())>text.length()*0.25) return false;
        }
        int repeated=0; var matches=REPEATED.matcher(text);
        while(matches.find()) repeated+=matches.group().length();
        return repeated<=text.length()*0.5;
    }
}
