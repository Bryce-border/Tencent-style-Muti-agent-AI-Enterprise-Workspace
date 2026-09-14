from __future__ import annotations

import json

import aio_pika

from .config import Settings


async def publish_task(settings: Settings, task_id: str) -> None:
    connection = await aio_pika.connect_robust(settings.rabbitmq_url)
    try:
        channel = await connection.channel()
        queue = await channel.declare_queue(settings.task_queue_name, durable=True)
        await channel.default_exchange.publish(
            aio_pika.Message(body=json.dumps({"task_id": task_id}).encode(), delivery_mode=aio_pika.DeliveryMode.PERSISTENT),
            routing_key=queue.name,
        )
    finally:
        await connection.close()
