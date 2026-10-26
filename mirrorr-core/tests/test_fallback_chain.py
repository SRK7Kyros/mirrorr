"""The fallback chain is a list of patches, one change per rung.

Pure model tests: the loaders are fakes, so nothing here opens a database.
"""

import asyncio
from types import SimpleNamespace

import pytest

from mirrorr.services import fallback_chain as fc
from mirrorr.services.fallback_chain import ChainError

PROFILES = {
    2: SimpleNamespace(
        id=2,
        name="profile 2",
        default_engine_id=7,
        resolver_id=77,
        resolver_config={"channel": 577},
        retry_mode="always",
        retry_config={"delay": 5},
    ),
    3: SimpleNamespace(
        id=3,
        name="profile 3",
        default_engine_id=8,
        resolver_id=88,
        resolver_config={"channel": 60},
        retry_mode="none",
        retry_config={},
    ),
}
ENGINES = {1, 7, 8}
RESOLVERS = {1, 9, 77, 88}


def _loaders(profiles=PROFILES, engines=ENGINES, resolvers=RESOLVERS) -> fc.Loaders:
    async def profile(profile_id: int):
        row = profiles.get(profile_id)
        if row is None:
            raise ChainError(
                422, f"Profile {profile_id} does not exist", "fallback-profile-missing"
            )
        return row

    async def engine(engine_id: int):
        return object() if engine_id in engines else None

    async def resolver(resolver_id: int):
        return object() if resolver_id in resolvers else None

    return fc.Loaders(profile=profile, engine=engine, resolver=resolver)


def _base(**over) -> fc.Base:
    values = dict(
        engine_id=1, resolver_id=1, resolver_config={}, retry_mode="none", retry_config={}
    )
    values.update(over)
    return fc.Base(**values)


def test_a_profile_rung_takes_that_profile_whole():
    async def scenario():
        chain = await fc.resolve(_loaders(), _base(), [{"profile_id": 2}], strict=True)
        assert chain.captures == [
            {
                "source": "profile",
                "profile_id": 2,
                "profile_name": "profile 2",
                "engine_id": 7,
                "resolver_id": 77,
                "resolver_config": {"channel": 577},
                "retry_mode": "always",
                "retry_config": {"delay": 5},
            }
        ]

    asyncio.run(scenario())


def test_a_source_rung_keeps_the_engine_and_policy_above_it():
    async def scenario():
        base = _base(retry_mode="count", retry_config={"count": 2})
        chain = await fc.resolve(
            _loaders(), base, [{"resolver_id": 9, "resolver_config": {"a": 1}}], strict=True
        )
        spec = chain.captures[0]
        assert (spec["engine_id"], spec["resolver_id"]) == (1, 9)
        assert spec["resolver_config"] == {"a": 1}
        assert (spec["retry_mode"], spec["retry_config"]) == ("count", {"count": 2})
        assert (spec["source"], spec["profile_id"]) == ("resolver", None)

    asyncio.run(scenario())


def test_a_config_belongs_to_its_resolver_so_a_swap_drops_it():
    async def scenario():
        base = _base(resolver_config={"channel": 1})
        chain = await fc.resolve(_loaders(), base, [{"resolver_id": 9}], strict=True)
        assert chain.captures[0]["resolver_config"] == {}

    asyncio.run(scenario())


def test_a_rung_on_the_same_resolver_keeps_the_config():
    async def scenario():
        base = _base(resolver_config={"channel": 1})
        chain = await fc.resolve(_loaders(), base, [{"engine_id": 7}], strict=True)
        assert chain.captures[0]["engine_id"] == 7
        assert chain.captures[0]["resolver_config"] == {"channel": 1}

    asyncio.run(scenario())


def test_a_rung_after_a_profile_inherits_from_that_profile():
    async def scenario():
        chain = await fc.resolve(
            _loaders(), _base(), [{"profile_id": 2}, {"resolver_id": 9}], strict=True
        )
        spec = chain.captures[1]
        assert (spec["engine_id"], spec["resolver_id"]) == (7, 9)
        assert spec["resolver_config"] == {}
        assert spec["profile_id"] is None
        assert spec["retry_mode"] == "always"

    asyncio.run(scenario())


def test_a_rung_may_name_a_profile_and_another_engine():
    async def scenario():
        chain = await fc.resolve(
            _loaders(), _base(), [{"profile_id": 2, "engine_id": 1}], strict=True
        )
        spec = chain.captures[0]
        assert (spec["engine_id"], spec["resolver_id"]) == (1, 77)
        assert spec["resolver_config"] == {"channel": 577}

    asyncio.run(scenario())


def test_a_declared_rung_that_names_nothing_is_refused():
    async def scenario():
        with pytest.raises(ChainError) as caught:
            await fc.resolve(_loaders(), _base(), [{}], strict=True)
        assert caught.value.rule == "fallback-empty"

    asyncio.run(scenario())


def test_a_rung_that_is_the_runs_own_source_is_named_apart():
    async def scenario():
        with pytest.raises(ChainError) as caught:
            await fc.resolve(
                _loaders(), _base(), [{"engine_id": 1}], strict=True, subject="profile"
            )
        assert caught.value.rule == "fallback-is-primary"
        assert "profile's own source" in caught.value.detail

    asyncio.run(scenario())


def test_a_rung_that_repeats_the_rung_above_is_refused():
    async def scenario():
        rungs = [{"resolver_id": 9}, {"resolver_id": 9}]
        with pytest.raises(ChainError) as caught:
            await fc.resolve(_loaders(), _base(), rungs, strict=True)
        assert caught.value.rule == "fallback-duplicate"
        assert "repeats" in caught.value.detail

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "rung, rule",
    [
        ({"profile_id": 99}, "fallback-profile-missing"),
        ({"engine_id": 42}, "fallback-engine-missing"),
        ({"resolver_id": 42}, "fallback-resolver-missing"),
    ],
)
def test_a_rung_that_names_a_row_that_is_not_there_is_refused(rung, rule):
    async def scenario():
        with pytest.raises(ChainError) as caught:
            await fc.resolve(_loaders(), _base(), [rung], strict=True)
        assert caught.value.rule == rule

    asyncio.run(scenario())


def test_an_inherited_chain_drops_what_no_longer_stands():
    async def scenario():
        rungs = [{"profile_id": 99}, {}, {"engine_id": 1}, {"resolver_id": 9}]
        chain = await fc.resolve(_loaders(), _base(), rungs, strict=False)
        assert chain.rungs == [{"resolver_id": 9}]
        assert [capture["resolver_id"] for capture in chain.captures] == [9]

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "raw, rung",
    [
        (None, {}),
        (3, {"profile_id": 3}),
        ({"resolver_id": 9, "resolver_config": None}, {"resolver_id": 9}),
        ({"profile_id": 3, "junk": 1}, {"profile_id": 3}),
    ],
)
def test_a_rung_reads_in_every_shape_it_was_stored_in(raw, rung):
    assert fc.normalise(raw) == rung


def test_a_value_that_is_no_rung_at_all_is_refused():
    with pytest.raises(ChainError) as caught:
        fc.normalise("profile 2")
    assert caught.value.rule == "fallback-shape"


def test_the_two_old_columns_fold_profile_rungs_first():
    folded = fc.fold_legacy([3], [{"resolver_id": 9, "resolver_config": {"a": 1}}])
    assert folded == [{"profile_id": 3}, {"resolver_id": 9, "resolver_config": {"a": 1}}]


def test_an_empty_chain_is_a_decision_and_null_is_history():
    decided = SimpleNamespace(fallback_chain=[], fallback_profile_ids=[3], fallback_sources=None)
    historic = SimpleNamespace(fallback_chain=None, fallback_profile_ids=[3], fallback_sources=[])
    assert fc.rungs_of(decided) == []
    assert fc.rungs_of(historic) == [{"profile_id": 3}]


def test_the_old_client_sees_only_the_rungs_that_were_one_kind():
    ids, sources = fc.legacy_views(
        [
            {"profile_id": 3},
            {"resolver_id": 9},
            {"profile_id": 2, "engine_id": 4},
            {"resolver_id": 8, "resolver_config": {"a": 1}},
        ]
    )
    assert ids == [3]
    assert sources == [
        {"resolver_id": 9, "resolver_config": {}},
        {"resolver_id": 8, "resolver_config": {"a": 1}},
    ]


def test_the_same_stream_through_another_engine_is_another_source():
    assert fc.source_key(1, 1, {"a": 1, "b": 2}) == fc.source_key(1, 1, {"b": 2, "a": 1})
    assert fc.source_key(1, 1, {}) != fc.source_key(2, 1, {})


def test_base_of_reads_an_autorun_and_a_profile():
    row = SimpleNamespace(
        engine_id=4,
        resolver_id=5,
        resolver_config={"c": 1},
        retry_mode="count",
        retry_config={"count": 2},
        profile_id=7,
    )
    profile = SimpleNamespace(
        default_engine_id=4,
        resolver_id=5,
        resolver_config={"c": 1},
        retry_mode="count",
        retry_config={"count": 2},
    )
    assert fc.base_of(row).engine_id == 4
    assert fc.base_of(row).profile_id == 7
    assert fc.base_of(profile).engine_id == 4
    assert fc.base_of(profile).profile_id is None


def test_the_runs_own_capture_is_named_for_where_it_comes_from():
    by_profile = fc.Base(
        engine_id=1,
        resolver_id=1,
        resolver_config={},
        retry_mode="none",
        retry_config={},
        profile_id=7,
        profile_name="Edge",
    )
    custom = _base()
    assert fc.base_spec(by_profile)["source"] == "profile"
    assert fc.base_spec(by_profile)["profile_name"] == "Edge"
    assert fc.base_spec(custom)["source"] == "resolver"
    assert fc.base_spec(custom)["profile_id"] is None


def test_a_plan_is_the_runs_own_capture_then_each_rung():
    base = _base()
    other = fc.base_spec(_base(engine_id=7, resolver_id=9))
    plan = fc.plan_with(base, [other])
    assert plan[0] == fc.base_spec(base)
    assert plan[1] == other


def test_a_resolved_capture_is_told_apart_from_a_rung():
    assert fc.is_spec(fc.base_spec(_base()))
    assert not fc.is_spec(2)
    assert not fc.is_spec(None)
    assert not fc.is_spec({"profile_id": 2})
    assert not fc.is_spec({"resolver_id": 9})


def test_a_plan_stored_before_rungs_still_runs():
    base = _base()
    spec = fc.base_spec(base)
    assert fc.entry_patch(base, spec) == spec
    assert fc.entry_patch(base, None) == spec

    profile_entry = fc.entry_patch(base, 2)
    assert (profile_entry["source"], profile_entry["profile_id"]) == ("profile", 2)
    assert profile_entry["engine_id"] is None

    source_entry = fc.entry_patch(base, {"resolver_id": 9, "resolver_config": {"a": 1}})
    assert (source_entry["engine_id"], source_entry["resolver_id"]) == (1, 9)
    assert source_entry["resolver_config"] == {"a": 1}
