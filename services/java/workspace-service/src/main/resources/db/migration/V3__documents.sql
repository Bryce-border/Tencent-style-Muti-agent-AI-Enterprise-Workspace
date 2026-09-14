CREATE TABLE documents (
  id VARCHAR(64) PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  latest_version INT NOT NULL DEFAULT 0,
  active_version INT NOT NULL DEFAULT 0,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at VARCHAR(40) NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);
CREATE TABLE document_versions (
  document_id VARCHAR(64) NOT NULL,
  version INT NOT NULL,
  filename VARCHAR(255) NOT NULL,
  object_key VARCHAR(500) NOT NULL,
  byte_size BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL,
  extracted_text LONGTEXT,
  chunk_count INT NOT NULL DEFAULT 0,
  error TEXT,
  job_token VARCHAR(64),
  started_ms BIGINT NOT NULL DEFAULT 0,
  created_at VARCHAR(40) NOT NULL,
  PRIMARY KEY(document_id,version),
  FOREIGN KEY(document_id) REFERENCES documents(id)
);
