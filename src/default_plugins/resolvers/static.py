from __future__ import annotations

from typing import Type

from src.storage.models import ResolverInterface, ResolverContext, Source
from pydantic import BaseModel


class StaticConfig(BaseModel):
    url: str
    headers: dict = {}


class StaticResolver(ResolverInterface[StaticConfig]):
    """Static resolver that always serves the same url and headers."""

    @property
    def config_model(self) -> Type[StaticConfig]:
        return StaticConfig

    @property
    def name(self) -> str:
        return "static"

    @property
    def description(self) -> str:
        return "Static resolver that always serves the same url and headers."

    async def resolve(self, config: StaticConfig, context: ResolverContext) -> Source:
        return Source(url=config.url, headers=config.headers)
