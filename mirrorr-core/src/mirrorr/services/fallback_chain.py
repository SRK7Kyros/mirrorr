"""The fallback chain: what a run tries after its own source fails.

A rung is a *patch* over the run's own capture, not a kind of thing and not a
change to the rung before it. Naming a profile takes that profile whole; naming
a resolver swaps where the stream comes from; naming an engine changes what runs
it. A rung may name any combination, and whatever it leaves out is inherited
from its base — the profile when the rung names one, otherwise the run's own
capture.

Every rung is read against that same base, so no rung can quietly inherit a
neighbour's engine or config, and the order is only the order they are tried:
``[{"profile_id": 2}, {"resolver_id": 9}]`` runs that profile whole and then the
**run's own** engine at a different stream.

That is the whole model: ``{"profile_id": 2}`` is the old profile fallback,
``{"resolver_id": 9}`` is the old source fallback, and
``{"profile_id": 2, "engine_id": 4}`` is something neither could express.

Everything here is pure except :func:`resolve`, which takes the row loaders it
needs to prove a rung (a profile the caller may use, an engine and a resolver
that exist) so the API can apply the caller's access rules and the scheduler can
apply none.
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, AsyncIterator, Awaitable, Callable, Sequence

from loguru import logger
from sqlalchemy import inspect as sa_inspect

# The fields a rung may set. A rung that sets none of them names nothing.
RUNG_FIELDS = ("profile_id", "engine_id", "resolver_id", "resolver_config")

# A resolved capture carries everything the supervisor needs to run it, so a
# plan is a snapshot: editing a profile afterwards cannot change a scheduled run.
SPEC_FIELDS = (
    "source",
    "profile_id",
    "profile_name",
    "engine_id",
    "resolver_id",
    "resolver_config",
    "retry_mode",
    "retry_config",
)


class ChainError(Exception):
    """A chain a caller declared that cannot be run, with the rule it broke."""

    def __init__(self, status_code: int, detail: str, rule: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.rule = rule


# ── reading a chain, whatever shape it was stored in ───────────────────


def normalise(raw: Any) -> dict[str, Any]:
    """One entry as a rung, whatever shape it arrived in.

    The shapes stored before rungs existed are still read: ``None`` is the run's
    own capture (a bare placeholder in an old plan), an int is a profile id, and
    a dict naming only a resolver is a source rung.
    """
    if raw is None:
        return {}
    if isinstance(raw, int):
        return {"profile_id": raw}
    if not isinstance(raw, dict):
        dump = getattr(raw, "model_dump", None)
        if dump is None:
            raise ChainError(
                422, "A fallback must name a profile, an engine or a resolver", "fallback-shape"
            )
        raw = dump()
    rung: dict[str, Any] = {}
    for field in ("profile_id", "engine_id", "resolver_id"):
        if raw.get(field) is not None:
            rung[field] = int(raw[field])
    # Only a config the rung actually names counts: a dumped rung carries every
    # field, and reading its ``None`` as an empty config would blank the config
    # of the profile the rung names.
    if raw.get("resolver_config") is not None:
        rung["resolver_config"] = dict(raw["resolver_config"])
    return rung


def fold_legacy(
    profile_ids: Sequence[int] | None, sources: Sequence[Any] | None
) -> list[dict[str, Any]]:
    """The two old columns as one chain, profile rungs first.

    That is the order they always ran in: every profile fallback, then every
    source fallback.
    """
    rungs = [{"profile_id": int(pid)} for pid in (profile_ids or []) if pid is not None]
    for raw in sources or []:
        rungs.append(normalise(raw))
    return rungs


def declared_chain(raw: Sequence[Any] | None) -> list[dict[str, Any]]:
    """A chain a caller declared, normalised to the rungs that get stored."""
    return [normalise(entry) for entry in raw or []]


def rungs_of(row: Any) -> list[dict[str, Any]]:
    """This row's declared chain.

    ``fallback_chain`` is the source of truth once anything has saved it — an
    empty list means "no fallbacks", which is why NULL (a row that predates it)
    is what selects the legacy fold.
    """
    declared = getattr(row, "fallback_chain", None)
    if declared is not None:
        return [normalise(entry) for entry in declared]
    return fold_legacy(
        getattr(row, "fallback_profile_ids", None), getattr(row, "fallback_sources", None)
    )


def legacy_views(rungs: Sequence[dict[str, Any]]) -> tuple[list[int], list[dict[str, Any]]]:
    """A chain as the pre-rung client reads it.

    Only rungs that *are* a profile or *are* a source have an old-name
    equivalent; a mixed rung has none and is simply absent until the client
    understands chains.
    """
    ids: list[int] = []
    sources: list[dict[str, Any]] = []
    for rung in rungs:
        legacy = _legacy_shape(rung)
        if legacy is None:
            continue
        kind, value = legacy
        if kind == "profile":
            ids.append(int(value))
        else:
            sources.append(
                {
                    "resolver_id": int(value["resolver_id"]),
                    "resolver_config": dict(value.get("resolver_config") or {}),
                }
            )
    return ids, sources


def _legacy_shape(rung: dict[str, Any]) -> tuple[str, Any] | None:
    """This rung as the old pair spells it, or ``None`` when they cannot.

    A rung that names only a profile is the old *profile* fallback and one that
    names only a resolver is the old *source* fallback. Any other combination —
    an engine, a profile with its own engine, a config beside a profile — has
    no old-name equivalent.
    """
    keys = set(rung)
    if keys == {"profile_id"}:
        return ("profile", rung["profile_id"])
    if keys in ({"resolver_id"}, {"resolver_id", "resolver_config"}):
        return ("source", rung)
    return None


def hidden_from_legacy(rungs: Sequence[dict[str, Any]]) -> int:
    """How many rungs a pre-rung client cannot see — and so would delete.

    Such a client reads a chain through :func:`legacy_views` and writes back the
    pair it read. A mixed rung is absent from that list, so that round trip would
    drop it without the caller ever seeing it existed. Counting them lets a write
    path refuse such a save **by name** instead of destroying a chain the caller
    never saw.
    """
    return sum(1 for rung in rungs if _legacy_shape(rung) is None)


# ── the run's own capture ──────────────────────────────────────────────


@dataclass(frozen=True)
class Base:
    """The capture a run makes before any fallback: what a rung is a patch over."""

    engine_id: int
    resolver_id: int
    resolver_config: dict[str, Any]
    retry_mode: str
    retry_config: dict[str, Any]
    profile_id: int | None = None
    profile_name: str = ""


def loaded(row: Any, attr: str) -> Any:
    """A relationship's value when it is already loaded, else ``None``.

    Reading an unloaded relationship here would start a lazy load, and every
    caller is an async handler or supervisor: SQLAlchemy answers that with
    ``MissingGreenlet`` rather than fetching it, because no greenlet is there to
    await. A name we do not already hold is simply absent — the caller either
    supplies it or has it filled in from the row it names.
    """
    state = sa_inspect(row, raiseerr=False)
    if state is None or attr in state.unloaded:
        return None
    return getattr(row, attr, None)


def base_of(row: Any, profile_name: str | None = None) -> Base:
    """The run's own capture, from an autorun, a session or a profile.

    ``profile_name`` is supplied by a caller holding a row it already loaded;
    otherwise it comes from the relationship only when that is loaded (see
    :func:`loaded`).
    """
    engine_id = getattr(row, "engine_id", None)
    if engine_id is None:
        engine_id = getattr(row, "default_engine_id", None)
    profile = loaded(row, "profile")
    profile_id = getattr(row, "profile_id", None)
    if profile_name is None:
        profile_name = (getattr(profile, "name", "") or "") if profile is not None else ""
    return Base(
        engine_id=int(engine_id or 0),
        resolver_id=int(getattr(row, "resolver_id", 0) or 0),
        resolver_config=dict(getattr(row, "resolver_config", None) or {}),
        retry_mode=str(getattr(row, "retry_mode", None) or "none"),
        retry_config=dict(getattr(row, "retry_config", None) or {}),
        profile_id=profile_id,
        profile_name=profile_name,
    )


def base_spec(base: Base) -> dict[str, Any]:
    """The run's own capture as a resolved spec, the first entry of a plan."""
    return {
        "source": "profile" if base.profile_id is not None else "resolver",
        "profile_id": base.profile_id,
        "profile_name": base.profile_name,
        "engine_id": base.engine_id,
        "resolver_id": base.resolver_id,
        "resolver_config": dict(base.resolver_config or {}),
        "retry_mode": base.retry_mode,
        "retry_config": dict(base.retry_config or {}),
    }


def is_spec(entry: Any) -> bool:
    """Whether a stored plan entry is already a resolved capture.

    A plan written before rungs existed holds ids, ``None`` and bare source
    dicts; none of those name an engine, so this is what tells them apart.
    """
    return isinstance(entry, dict) and "engine_id" in entry and "resolver_id" in entry


def source_key(engine_id: int, resolver_id: int, config: Any) -> str:
    """Identity of a capture: the same stream, through the same engine."""
    return f"{engine_id}:{resolver_id}:{json.dumps(config or {}, sort_keys=True, default=str)}"


# ── resolving a chain into captures ────────────────────────────────────


@dataclass(frozen=True)
class Loaders:
    """How to fetch the rows a rung names, so access rules stay the caller's."""

    profile: Callable[[int], Awaitable[Any]]
    engine: Callable[[int], Awaitable[Any | None]]
    resolver: Callable[[int], Awaitable[Any | None]]


def loaders_for(db: Any) -> Loaders:
    """Loaders over an open transaction, with no access rule of their own.

    For a caller that is not answering a request (the scheduler) or one that
    layers its own rules on top (the API wraps ``profile`` with a visibility
    check). Nothing here is cached: a chain is resolved once, per run.
    """
    from mirrorr.storage import crud
    from mirrorr.storage.models import Engine, Profile, Resolver

    async def profile(profile_id: int):
        row = await crud.get_by_id(db, Profile, profile_id)
        if row is None:
            raise ChainError(
                422, f"Profile {profile_id} does not exist", "fallback-profile-missing"
            )
        return row

    async def by_id(model: Any, row_id: int):
        return await crud.get_by_id(db, model, row_id)

    return Loaders(
        profile=profile,
        engine=lambda row_id: by_id(Engine, row_id),
        resolver=lambda row_id: by_id(Resolver, row_id),
    )


@asynccontextmanager
async def open_loaders(settings: Any) -> AsyncIterator[Loaders]:
    """Loaders for a caller with no request context (the scheduler, a supervisor).

    They apply no access rule — a scheduled run was authorised when it was
    written, and a supervisor is resuming a run that already started.
    """
    from mirrorr.storage.database import create_db_engine

    engine, db_factory = create_db_engine(settings)
    try:
        async with db_factory() as db:
            yield loaders_for(db)
    finally:
        await engine.dispose()


async def _spec_for(
    loaders: Loaders, own: dict[str, Any], rung: dict[str, Any], index: int
) -> dict[str, Any]:
    """One rung as a concrete capture, inheriting what it does not name.

    ``own`` is the run's own capture, and every rung is patched over it rather
    than over the rung before, so a rung means exactly the capture it describes
    however many rungs precede it.
    """
    profile = None
    profile_id = rung.get("profile_id")
    if profile_id is not None:
        profile = await loaders.profile(profile_id)
        if profile is None:
            raise ChainError(
                422, f"Fallback {index} names profile {profile_id}, which does not exist",
                "fallback-profile-missing",
            )

    engine_id = rung.get("engine_id")
    if engine_id is None:
        engine_id = getattr(profile, "default_engine_id", None) if profile is not None else None
    if engine_id is None:
        engine_id = own["engine_id"]

    resolver_id = rung.get("resolver_id")
    if resolver_id is None:
        resolver_id = getattr(profile, "resolver_id", None) if profile is not None else None
    if resolver_id is None:
        resolver_id = own["resolver_id"]

    # A config belongs to the resolver it configures, so it is only carried
    # over while the resolver is still the run's own.
    if "resolver_config" in rung:
        resolver_config = dict(rung["resolver_config"] or {})
    elif profile is not None:
        resolver_config = dict(getattr(profile, "resolver_config", None) or {})
    elif int(resolver_id) != int(own["resolver_id"]):
        resolver_config = {}
    else:
        resolver_config = dict(own["resolver_config"] or {})

    # A profile rung is also that profile's retry policy; a rung that names no
    # profile keeps the run's own, which is what makes it a *source* swap.
    retry_mode = own["retry_mode"]
    retry_config = dict(own["retry_config"] or {})
    if profile is not None:
        retry_mode = str(getattr(profile, "retry_mode", None) or "none")
        retry_config = dict(getattr(profile, "retry_config", None) or {})

    if await loaders.engine(int(engine_id)) is None:
        raise ChainError(
            422, f"Fallback {index} names engine {engine_id}, which does not exist",
            "fallback-engine-missing",
        )
    if await loaders.resolver(int(resolver_id)) is None:
        raise ChainError(
            422, f"Fallback {index} names resolver {resolver_id}, which does not exist",
            "fallback-resolver-missing",
        )

    return {
        "source": "profile" if profile is not None else "resolver",
        "profile_id": profile_id,
        "profile_name": (getattr(profile, "name", "") or "") if profile is not None else "",
        "engine_id": int(engine_id),
        "resolver_id": int(resolver_id),
        "resolver_config": resolver_config,
        "retry_mode": retry_mode,
        "retry_config": retry_config,
    }


@dataclass(frozen=True)
class Chain:
    """A resolved chain: the rungs that stood, and the captures they stand for.

    Both are kept because a caller stores the first and runs the second: a rung
    that could not be built, or that repeats an earlier capture, is in neither.
    """

    rungs: list[dict[str, Any]]
    captures: list[dict[str, Any]]


async def resolve(
    loaders: Loaders,
    base: Base,
    rungs: Sequence[Any],
    *,
    strict: bool,
    subject: str = "run",
) -> Chain:
    """A declared chain as the captures it stands for, in order.

    ``strict`` is for a chain the caller *declared*: every rung must name
    something runnable, and a repeat is refused because a chain that cannot
    advance is a mistake. A chain being inherited (from a profile, or a plan
    stored by an older build) is resolved non-strict: a rung that can no longer
    be built, or that now repeats an earlier capture, is dropped instead of
    failing a run whose caller wrote none of it.
    """
    kept: list[dict[str, Any]] = []
    specs: list[dict[str, Any]] = []
    own = base_spec(base)
    own_key = source_key(own["engine_id"], own["resolver_id"], own["resolver_config"])
    seen = {own_key}
    for index, raw in enumerate(rungs, start=1):
        rung = normalise(raw)
        if not rung:
            if strict:
                raise ChainError(
                    422, f"Fallback {index} names nothing to run", "fallback-empty"
                )
            continue
        try:
            spec = await _spec_for(loaders, own, rung, index)
        except ChainError:
            if strict:
                raise
            logger.warning(f"{subject}: dropping fallback {index} {rung} — it cannot be built")
            continue
        except Exception as e:  # noqa: broad-except — a broken rung must not stop a run
            if strict:
                raise ChainError(
                    422, f"Fallback {index} could not be loaded: {e}", "fallback-unusable"
                ) from e
            logger.warning(f"{subject}: dropping fallback {index} {rung} — {e}")
            continue
        key = source_key(spec["engine_id"], spec["resolver_id"], spec["resolver_config"])
        if key in seen:
            if strict:
                if key == own_key:
                    raise ChainError(
                        422,
                        f"Fallback {index} is the {subject}'s own source",
                        "fallback-is-primary",
                    )
                raise ChainError(
                    422,
                    f"Fallback {index} repeats a source already in the chain",
                    "fallback-duplicate",
                )
            logger.warning(f"{subject}: dropping fallback {index} — it repeats a source")
            continue
        seen.add(key)
        kept.append(rung)
        specs.append(spec)
    return Chain(rungs=kept, captures=specs)


def plan_with(base: Base, specs: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """A run's whole capture plan: its own capture, then each resolved rung."""
    return [base_spec(base), *specs]


def entry_patch(base: Base, entry: Any) -> dict[str, Any]:
    """One stored plan entry as a spec to hand ``load_capture``.

    An entry that is already a resolved capture is passed through; a legacy one
    (a profile id, ``None``, a bare source) is expressed as a patch over the
    run's own capture so the supervisor's loader can complete it from the
    profile row it names.
    """
    if is_spec(entry):
        return dict(entry)
    rung = normalise(entry)
    spec = base_spec(base)
    if rung.get("profile_id") is not None:
        # A profile rung takes the profile whole: the run's own engine, resolver,
        # config and retry policy step aside and the loader fills them in.
        spec = {
            "source": "profile",
            "profile_id": rung["profile_id"],
            "profile_name": "",
            "engine_id": None,
            "resolver_id": None,
            "resolver_config": None,
            "retry_mode": None,
            "retry_config": None,
        }
    for key, value in rung.items():
        if rung.get("profile_id") is not None and key == "profile_id":
            continue
        spec[key] = value
    return spec


async def rungs_from_plan(
    loaders: Loaders, base: Base, plan: Sequence[Any]
) -> list[dict[str, Any]]:
    """A run's stored plan as the rungs that would rebuild it.

    A plan is resolved captures with every field filled; a rung is only what a
    capture *changed*. Saving a run as a profile therefore has to reduce its
    plan back to rungs, or the profile's chain would name every field of every
    capture and the old client's two lists would see none of them.

    The first entry is the run's own capture and is skipped. A capture naming a
    profile is reduced against that profile — a profile rung takes it whole, so
    only an engine, resolver or config that differs from the profile's own is
    kept — and one naming none is reduced against the run's own capture, which
    is what every rung patches.
    """
    rungs: list[dict[str, Any]] = []
    own = base_spec(base)
    for entry in list(plan)[1:]:
        spec = entry_patch(base, entry)
        profile = None
        if spec.get("profile_id") is not None:
            profile = await loaders.profile(int(spec["profile_id"]))
            reference = {
                "engine_id": getattr(profile, "default_engine_id", None),
                "resolver_id": getattr(profile, "resolver_id", None),
                "resolver_config": dict(getattr(profile, "resolver_config", None) or {}),
            }
            rung: dict[str, Any] = {"profile_id": int(spec["profile_id"])}
        else:
            reference = own
            rung = {}
        if spec.get("engine_id") is not None and int(spec["engine_id"]) != int(
            reference.get("engine_id") or 0
        ):
            rung["engine_id"] = int(spec["engine_id"])
        moved = int(spec.get("resolver_id") or 0) != int(reference.get("resolver_id") or 0)
        if moved:
            rung["resolver_id"] = int(spec["resolver_id"])
        config = dict(spec.get("resolver_config") or {})
        # A config belongs to the resolver it configures: a source rung that
        # swaps the resolver must carry its own config, or the swap would run
        # the new resolver with the old one's settings.
        if moved or config != dict(reference.get("resolver_config") or {}):
            rung["resolver_config"] = config
        if rung:
            rungs.append(rung)
    return rungs
