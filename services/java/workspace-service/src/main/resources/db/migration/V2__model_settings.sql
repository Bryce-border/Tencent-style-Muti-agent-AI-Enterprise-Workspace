CREATE TABLE model_settings (
  workspace_id VARCHAR(64) PRIMARY KEY,
  base_url VARCHAR(500) NOT NULL,
  model VARCHAR(150) NOT NULL,
  encrypted_key TEXT NOT NULL,
  temperature DOUBLE NOT NULL,
  max_tokens INT NOT NULL,
  revision BIGINT NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);
