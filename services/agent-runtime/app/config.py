from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field


class Settings(BaseSettings):
    app_name: str = "enterprise-agent-runtime"
    environment: str = "development"
    llm_base_url: str = "https://api.openai.com/v1"
    llm_api_key: str = ""
    llm_model: str = ""
    llm_temperature: float = 0.2
    llm_max_tokens: int = 1800
    llm_workspace_id: str = ""
    embedding_model: str = ""
    embedding_dim: int = 384
    embedding_base_url: str = ""
    knowledge_min_similarity: float = Field(default=0.42, ge=0, le=1)
    knowledge_similarity_window: float = Field(default=0.12, ge=0, le=2)
    rabbitmq_url: str = "amqp://workspace:workspace@rabbitmq:5672/"
    elasticsearch_url: str = "http://elasticsearch:9200"
    elasticsearch_index: str = "knowledge_chunks_v3"
    database_path: str = "/data/workspace.db"
    cors_origins: str = "*"
    max_task_seconds: int = 300
    max_task_retries: int = 2
    task_queue_name: str = "enterprise.tasks"
    task_queue_enabled: bool = True
    workspace_service_url: str = ""
    workspace_internal_token: str = ""
    minio_endpoint: str = "minio:9000"
    minio_access_key: str = ""
    minio_secret_key: str = ""
    minio_bucket: str = "workspace-documents"
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
