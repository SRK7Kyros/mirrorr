"""One POST to the operator's webhook when an unattended run fails.

A scheduled capture is the one thing nobody is watching: the row turns
``failed``, the console shows it, and that is all — until someone opens the
console. The webhook is the out-of-band half, and it is deliberately trivial:
one JSON object, one attempt, and a webhook that is down never fails the
event handler that reported the failure.
"""

from __future__ import annotations

import httpx
from loguru import logger

from mirrorr.startup.config import MirrorrSettings

_TIMEOUT = 10.0


async def send_alert(
    settings: MirrorrSettings,
    event: str,
    title: str,
    body: str = "",
    **fields: object,
) -> None:
    """POST one alert, or do nothing when no webhook is configured."""
    if not settings.alert_webhook_url:
        return
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.post(
                settings.alert_webhook_url,
                json={"event": event, "title": title, "body": body, **fields},
            )
        if response.status_code >= 400:
            logger.warning(f"Alert webhook answered {response.status_code}: {title}")
    except Exception as e:
        logger.warning(f"Alert webhook failed ({title}): {e}")
