ALTER TABLE tasks ADD COLUMN owner_user_id VARCHAR(64) NULL;
CREATE TABLE conversations (
 id VARCHAR(64) PRIMARY KEY, workspace_id VARCHAR(128) NOT NULL,
 user_id VARCHAR(64) NOT NULL, employee_id VARCHAR(64) NOT NULL,
 title VARCHAR(120) NOT NULL, created_at VARCHAR(40) NOT NULL
);
CREATE INDEX idx_conversation_owner ON conversations(workspace_id,user_id);
CREATE TABLE conversation_turns (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, conversation_id VARCHAR(64) NOT NULL,
 task_id VARCHAR(64) NOT NULL UNIQUE,
 FOREIGN KEY (conversation_id) REFERENCES conversations(id),
 FOREIGN KEY (task_id) REFERENCES tasks(task_id)
);
CREATE TABLE agent_memories (
 id VARCHAR(64) PRIMARY KEY, workspace_id VARCHAR(128) NOT NULL,
 user_id VARCHAR(64) NOT NULL, employee_id VARCHAR(64) NOT NULL,
 kind VARCHAR(20) NOT NULL, content VARCHAR(1000) NOT NULL,
 source_task_id VARCHAR(64) NULL, created_at VARCHAR(40) NOT NULL
);
CREATE INDEX idx_memory_owner ON agent_memories(workspace_id,user_id,employee_id);
