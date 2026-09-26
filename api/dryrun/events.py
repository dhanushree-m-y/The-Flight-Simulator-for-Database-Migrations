"""In-process pub/sub for live Server-Sent Events. Engine code runs in worker threads, so publishing is
thread-safe and hops onto the event loop."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any

_loop: asyncio.AbstractEventLoop | None = None
_subs: dict[str, set[asyncio.Queue]] = defaultdict(set)


def bind_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def publish(channel: str, event: dict[str, Any]) -> None:
    if _loop is None:
        return

    def _deliver() -> None:
        for q in list(_subs.get(channel, ())):
            q.put_nowait(event)

    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        running = None
    if running is _loop:
        _deliver()
    else:
        _loop.call_soon_threadsafe(_deliver)


def subscribe(channel: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    _subs[channel].add(q)
    return q


def unsubscribe(channel: str, q: asyncio.Queue) -> None:
    _subs[channel].discard(q)
