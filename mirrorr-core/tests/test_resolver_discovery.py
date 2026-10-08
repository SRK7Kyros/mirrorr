from __future__ import annotations

import asyncio
from pathlib import Path

from pydantic import BaseModel

from mirrorr.plugins.interfaces import (
    DiscoveryItem,
    DiscoveryPage,
    ResolverContext,
    ResolverInterface,
    Source,
)
from mirrorr.startup.ensure_resolvers import _extract_db_fields, _schema_changed
from mirrorr.storage.models import Resolver


class _Filters(BaseModel):
    country: str = "us"


class _Plain(ResolverInterface[_Filters]):
    @property
    def name(self) -> str:
        return "plain"

    @property
    def description(self) -> str:
        return ""

    @property
    def config_model(self) -> type[_Filters]:
        return _Filters

    async def resolve(self, config: _Filters, context: ResolverContext) -> Source:
        return Source(url="u")


class _Discoverable(_Plain):
    @property
    def name(self) -> str:
        return "discoverable"

    @property
    def discovery_model(self) -> type[BaseModel] | None:
        return _Filters

    @property
    def discovery_has_catalog(self) -> bool:
        return True

    async def browse(
        self, params: BaseModel, cursor: str | None, context: ResolverContext
    ) -> DiscoveryPage | None:
        return DiscoveryPage(items=[DiscoveryItem(id="a", title="A", config={"url": "u"})])

    async def search(
        self, query: str, params: BaseModel, cursor: str | None, context: ResolverContext
    ) -> DiscoveryPage | None:
        return DiscoveryPage(items=[DiscoveryItem(id=query, title=query, config={})])


def _context() -> ResolverContext:
    return ResolverContext(bus=None, session_folder=Path("."))


def _row(instance: ResolverInterface) -> Resolver:
    return Resolver(**_extract_db_fields(instance, "h"))


def test_discovery_defaults_are_inert():
    inst = _Plain()
    assert inst.discovery_model is None
    assert inst.discovery_has_catalog is False
    assert asyncio.run(inst.browse(_Filters(), None, _context())) is None
    assert asyncio.run(inst.search("q", _Filters(), None, _context())) is None


def test_extract_empty_search_schema_without_discovery():
    assert _extract_db_fields(_Plain(), "h")["search_schema"] == {}


def test_extract_search_schema_from_discovery_model():
    assert "country" in _extract_db_fields(_Discoverable(), "h")["search_schema"]["properties"]


def test_schema_unchanged_when_row_matches():
    inst = _Plain()
    assert _schema_changed(inst, _row(inst), "h") is False


def test_schema_changed_when_search_schema_missing():
    inst = _Plain()
    row = _row(inst)
    row.search_schema = None
    assert _schema_changed(inst, row, "h") is True


def test_schema_changed_when_discovery_appears():
    row = _row(_Plain())
    assert _schema_changed(_Discoverable(), row, "h") is True


def test_discovery_search_returns_items():
    page = asyncio.run(_Discoverable().search("hello", _Filters(), None, _context()))
    assert page is not None
    assert page.items[0].id == "hello"
