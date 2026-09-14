from __future__ import annotations

import asyncio
import json

import aio_pika

from .config import get_settings
from .main import run_task, store


async def main() -> None:
    settings = get_settings()
    connection = await aio_pika.connect_robust(settings.rabbitmq_url)
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=1)
    queue = await channel.declare_queue(settings.task_queue_name, durable=True)
    async with queue.iterator() as messages:
        async for message in messages:
            try:
                payload = json.loads(message.body)
                task_id = payload.get("task_id") if isinstance(payload, dict) else None
                if not isinstance(task_id, str) or not task_id:
                    await message.reject(requeue=False)
                    continue
            except (ValueError, UnicodeDecodeError):
                await message.reject(requeue=False)
                continue
            try:
                async with message.process(requeue=True):
                    if store.get(task_id):
                        await run_task(task_id)
            except Exception:
                # Temporary Java/database failures must not drop the durable task command.
                await asyncio.sleep(2)


if __name__ == "__main__":
    asyncio.run(main())
