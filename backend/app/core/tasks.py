"""Background task spawner that keeps strong references.

asyncio.create_task() alone is not enough for fire-and-forget work: the event
loop only holds a weak reference, so a task with no other referent can be
garbage-collected mid-flight and silently vanish (observed: download pipelines
lost, jobs stuck at status='queued' forever). Route all fire-and-forget spawns
through spawn() so the task stays referenced until it finishes.
"""
import asyncio
import logging
from typing import Coroutine

log = logging.getLogger(__name__)

_TASKS: set[asyncio.Task] = set()


def spawn(coro: Coroutine, name: str | None = None) -> asyncio.Task:
    task = asyncio.get_event_loop().create_task(coro, name=name)
    _TASKS.add(task)
    task.add_done_callback(_on_done)
    return task


def _on_done(task: asyncio.Task) -> None:
    _TASKS.discard(task)
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        log.error("background task %s crashed: %s", task.get_name(), exc, exc_info=exc)
