"""Per-invocation usage collection; never persist prompts or provider credentials."""
from contextvars import ContextVar

usage_capture: ContextVar[list | None] = ContextVar("usage_capture", default=None)


def record_usage(usage):
    sink = usage_capture.get()
    if sink is None or usage is None:
        return
    data = usage.model_dump() if hasattr(usage, "model_dump") else usage
    if isinstance(data, dict):
        sink.append({key: value for key, value in data.items()
                     if key in ("total_tokens", "prompt_tokens", "completion_tokens", "successful_requests")
                     and isinstance(value, int) and not isinstance(value, bool) and value >= 0})
