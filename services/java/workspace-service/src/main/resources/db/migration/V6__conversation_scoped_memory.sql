CREATE TABLE projects (
 id VARCHAR(64) PRIMARY KEY, workspace_id VARCHAR(128) NOT NULL,
 user_id VARCHAR(64) NOT NULL, title VARCHAR(120) NOT NULL,
 archived BOOLEAN NOT NULL DEFAULT FALSE,
 created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL
);
CREATE INDEX idx_project_owner ON projects(workspace_id,user_id,archived);
ALTER TABLE conversations ADD COLUMN project_id VARCHAR(64) NULL;
ALTER TABLE conversations ADD COLUMN memory_after_turn BIGINT NOT NULL DEFAULT 0;
-- Each historical conversation gets its own project to avoid merging unrelated work.
INSERT INTO projects(id,workspace_id,user_id,title,archived,created_at,updated_at)
 SELECT CONCAT('P-',SUBSTRING(id,3)),workspace_id,user_id,title,archived,created_at,updated_at FROM conversations;
UPDATE conversations SET project_id=CONCAT('P-',SUBSTRING(id,3));
ALTER TABLE conversations ADD CONSTRAINT fk_conversation_project FOREIGN KEY(project_id) REFERENCES projects(id);
CREATE INDEX idx_conversation_project ON conversations(project_id);
ALTER TABLE agent_memories ADD COLUMN project_id VARCHAR(64) NULL;
CREATE INDEX idx_memory_project ON agent_memories(project_id, enabled, updated_at);
UPDATE agent_memories SET project_id=(SELECT c.project_id FROM conversation_turns ct JOIN conversations c ON c.id=ct.conversation_id WHERE ct.task_id=agent_memories.source_task_id);
UPDATE agent_memories SET enabled=FALSE WHERE project_id IS NULL;
UPDATE conversations SET memory_after_turn=COALESCE((SELECT MAX(ct.id) FROM conversation_turns ct WHERE ct.conversation_id=conversations.id),0) WHERE archived=TRUE;
DELETE FROM agent_memories WHERE project_id IN (SELECT id FROM projects WHERE archived=TRUE);
