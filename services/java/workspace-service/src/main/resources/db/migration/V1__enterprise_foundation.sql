CREATE TABLE users (
  id VARCHAR(64) PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  created_at VARCHAR(40) NOT NULL
);
CREATE TABLE workspaces (id VARCHAR(64) PRIMARY KEY, name VARCHAR(120) NOT NULL);
CREATE TABLE memberships (
  workspace_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  role VARCHAR(16) NOT NULL,
  PRIMARY KEY(workspace_id, user_id),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE tasks (
  task_id VARCHAR(64) PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  snapshot LONGTEXT NOT NULL,
  updated_ms BIGINT NOT NULL,
  lease_token VARCHAR(64),
  lease_until BIGINT NOT NULL DEFAULT 0,
  attempts INT NOT NULL DEFAULT 0,
  request_key VARCHAR(100),
  UNIQUE(workspace_id, request_key),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);
CREATE INDEX idx_tasks_space ON tasks(workspace_id, updated_ms);
CREATE TABLE task_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  task_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload LONGTEXT NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(task_id)
);
CREATE INDEX idx_events_task ON task_events(task_id, id);
CREATE TABLE reports (
  task_id VARCHAR(64) PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL,
  title TEXT NOT NULL,
  content LONGTEXT NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(task_id)
);
CREATE TABLE task_outbox (
  task_id VARCHAR(64) PRIMARY KEY,
  published_ms BIGINT NOT NULL DEFAULT 0,
  FOREIGN KEY(task_id) REFERENCES tasks(task_id)
);
CREATE TABLE audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  action VARCHAR(80) NOT NULL,
  resource_id VARCHAR(100) NOT NULL,
  created_at VARCHAR(40) NOT NULL
);
