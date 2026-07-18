"""Import/Export router — bundle-based data portability for profiles and autoruns.

Export: serialises a profile (or autorun + its profile) into a portable bundle
        that references plugins by name + origin_hash instead of numeric FKs.

Validate: inspects an incoming bundle against the current installation,
          reports issues (missing plugins, name conflicts, hash mismatches).

Apply: creates profiles and autoruns from a validated bundle, using a
       plugin_map to resolve any hash mismatches.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from mirrorr.api.dependencies import AuthState, _get_db_session, require_auth
from mirrorr.storage import crud
from mirrorr.storage.models import Autorun, Engine, Profile, Resolver

import_export_router = APIRouter(prefix="/import-export")

BUNDLE_VERSION = 1


# ═══════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════


def _content_hash(data: dict[str, Any]) -> str:
    """Deterministic hash of a serialisable dict (order-independent)."""
    raw = json.dumps(data, sort_keys=True, default=str).encode()
    return hashlib.sha256(raw).hexdigest()


def _profile_to_bundle(p: Profile, engine: Engine, resolver: Resolver) -> dict[str, Any]:
    """Serialise a Profile into a portable bundle entry."""
    return {
        "name": p.name,
        "default_engine": {
            "name": engine.name,
            "origin_hash": engine.origin_hash,
        },
        "resolver": {
            "name": resolver.name,
            "origin_hash": resolver.origin_hash,
        },
        "resolver_config": p.resolver_config,
        "retry_mode": p.retry_mode,
        "retry_config": p.retry_config,
        "content_hash": _content_hash({
            "default_engine": engine.origin_hash,
            "resolver": resolver.origin_hash,
            "resolver_config": p.resolver_config,
            "retry_mode": p.retry_mode,
            "retry_config": p.retry_config,
        }),
    }


def _autorun_to_bundle(
    a: Autorun,
    profile: Profile,
    engine: Engine,
    resolver: Resolver,
) -> dict[str, Any]:
    """Serialise an Autorun into a portable bundle entry."""
    data: dict[str, Any] = {
        "user_friendly_name": a.user_friendly_name,
        "profile_name": profile.name,
        "profile": _profile_to_bundle(profile, engine, resolver),
        "start_time": a.start_time.isoformat() if a.start_time else None,
        "end_time": a.end_time.isoformat() if a.end_time else None,
        "recording": a.recording,
    }
    if a.engine_id != profile.default_engine_id:
        data["engine_override"] = {
            "name": engine.name,
            "origin_hash": engine.origin_hash,
        }
    content = {
        "profile_name": profile.name,
        "start_time": data.get("start_time"),
        "end_time": data.get("end_time"),
        "recording": a.recording,
    }
    if a.engine_id != profile.default_engine_id:
        content["engine_override"] = engine.origin_hash
    data["content_hash"] = _content_hash(content)

    return data


async def _resolve_plugin(
    db: AsyncSession,
    origin_hash: str,
    model: type[Engine] | type[Resolver],
) -> Engine | Resolver | None:
    """Look up a plugin by origin_hash."""
    stmt = select(model).where(model.origin_hash == origin_hash)
    result = await db.exec(stmt)
    return result.first()


async def _find_plugin_by_name(
    db: AsyncSession,
    name: str,
    model: type[Engine] | type[Resolver],
) -> Engine | Resolver | None:
    """Look up a plugin by name."""
    stmt = select(model).where(model.name == name)
    result = await db.exec(stmt)
    return result.first()


async def _list_plugins(
    db: AsyncSession,
    model: type[Engine] | type[Resolver],
) -> list[Engine | Resolver]:
    """List all installed plugins of a type."""
    result = await db.exec(select(model))
    return list(result.all())


def _plugin_ref(plugin: Engine | Resolver) -> dict[str, Any]:
    return {"id": plugin.id, "name": plugin.name, "origin_hash": plugin.origin_hash}




# ═══════════════════════════════════════════════════════════════════════
# Export endpoints
# ═══════════════════════════════════════════════════════════════════════


@import_export_router.get("/profiles/{id}/export")
async def export_profile(
    id: int,
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(require_auth),
):
    """Export a single profile as a portable bundle."""
    profile = await crud.get_by_id(db, Profile, id)
    if not profile:
        raise HTTPException(404, "Profile not found")
    if not auth.is_admin and profile.requester_user_token != auth.user.username:
        raise HTTPException(status_code=403, detail="Not authorized to export this resource")

    engine = await crud.get_by_id(db, Engine, profile.default_engine_id)
    resolver = await crud.get_by_id(db, Resolver, profile.resolver_id)
    if not engine or not resolver:
        raise HTTPException(500, "Profile references missing plugin(s)")

    entry = _profile_to_bundle(profile, engine, resolver)
    return {
        "version": BUNDLE_VERSION,
        "exported_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
        "profiles": [entry],
        "autoruns": [],
    }


@import_export_router.get("/autoruns/{id}/export")
async def export_autorun(
    id: int,
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(require_auth),
):
    """Export a single autorun (and its linked profile) as a portable bundle."""
    autorun = await crud.get_by_id(db, Autorun, id)
    if not autorun:
        raise HTTPException(404, "Autorun not found")
    if not auth.is_admin and autorun.requester_user_token != auth.user.username:
        raise HTTPException(status_code=403, detail="Not authorized to export this resource")

    profile = await crud.get_by_id(db, Profile, autorun.profile_id)
    if not profile:
        raise HTTPException(500, "Autorun references missing profile")

    engine = await crud.get_by_id(db, Engine, profile.default_engine_id)
    resolver = await crud.get_by_id(db, Resolver, profile.resolver_id)
    if not engine or not resolver:
        raise HTTPException(500, "Profile references missing plugin(s)")

    autorun_engine = await crud.get_by_id(db, Engine, autorun.engine_id)
    if not autorun_engine:
        raise HTTPException(500, "Autorun references missing engine")

    profile_entry = _profile_to_bundle(profile, engine, resolver)
    autorun_entry = _autorun_to_bundle(autorun, profile, autorun_engine, resolver)

    # De-duplicate profile if it was already included
    profiles = [profile_entry]
    return {
        "version": BUNDLE_VERSION,
        "exported_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
        "profiles": profiles,
        "autoruns": [autorun_entry],
    }


# ═══════════════════════════════════════════════════════════════════════
# Validate endpoint
# ═══════════════════════════════════════════════════════════════════════


@import_export_router.post("/validate")
async def validate_bundle(
    bundle: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(require_auth),
):
    """Validate an import bundle against the current installation.

    Returns a structured report with per-profile and per-autorun issues.
    The frontend renders this report without knowing the business logic.
    """
    version = bundle.get("version")
    if version != BUNDLE_VERSION:
        raise HTTPException(400, f"Unsupported bundle version: {version}")

    raw_profiles = bundle.get("profiles", [])
    raw_autoruns = bundle.get("autoruns", [])

    all_engines = await _list_plugins(db, Engine)
    all_resolvers = await _list_plugins(db, Resolver)
    engine_map = {e.origin_hash: e for e in all_engines}
    engine_name_map = {e.name: e for e in all_engines}
    resolver_map = {r.origin_hash: r for r in all_resolvers}
    resolver_name_map = {r.name: r for r in all_resolvers}

    # Fetch existing profiles for name-conflict and content-hash checks
    existing_profiles = await crud.get_all(db, Profile)
    existing_by_name = {p.name: p for p in existing_profiles}

    profile_reports: list[dict[str, Any]] = []
    autorun_reports: list[dict[str, Any]] = []

    # ── Validate profiles ──────────────────────────────────────────

    for p in raw_profiles:
        name = p.get("name", "untitled")
        issues: list[dict[str, Any]] = []

        eng_ref = p.get("default_engine", {})
        res_ref = p.get("resolver", {})

        # Check engine
        eng_hash = eng_ref.get("origin_hash", "")
        eng_name = eng_ref.get("name", "")
        installed_engine = engine_map.get(eng_hash)
        if not installed_engine:
            # Try by name as fallback
            installed_engine = engine_name_map.get(eng_name)
            if installed_engine:
                # Name match but hash mismatch → updated plugin
                issues.append({
                    "field": "engine",
                    "problem": "hash_mismatch",
                    "bundled": {"name": eng_name, "origin_hash": eng_hash},
                    "installed": _plugin_ref(installed_engine),
                    "alternatives": [_plugin_ref(e) for e in all_engines],
                })
            else:
                # Not installed at all
                issues.append({
                    "field": "engine",
                    "problem": "not_installed",
                    "bundled": {"name": eng_name, "origin_hash": eng_hash},
                    "alternatives": [_plugin_ref(e) for e in all_engines],
                })

        # Check resolver
        res_hash = res_ref.get("origin_hash", "")
        res_name = res_ref.get("name", "")
        installed_resolver = resolver_map.get(res_hash)
        if not installed_resolver:
            installed_resolver = resolver_name_map.get(res_name)
            if installed_resolver:
                issues.append({
                    "field": "resolver",
                    "problem": "hash_mismatch",
                    "bundled": {"name": res_name, "origin_hash": res_hash},
                    "installed": _plugin_ref(installed_resolver),
                    "alternatives": [_plugin_ref(r) for r in all_resolvers],
                })
            else:
                issues.append({
                    "field": "resolver",
                    "problem": "not_installed",
                    "bundled": {"name": res_name, "origin_hash": res_hash},
                    "alternatives": [_plugin_ref(r) for r in all_resolvers],
                })

        # Check name conflict / identical content
        content_hash = _content_hash({
            "default_engine": eng_hash,
            "resolver": res_hash,
            "resolver_config": p.get("resolver_config", {}),
            "retry_mode": p.get("retry_mode", "none"),
            "retry_config": p.get("retry_config", {}),
        })

        existing = existing_by_name.get(name)
        if existing:
            existing_eng = await crud.get_by_id(db, Engine, existing.default_engine_id)
            existing_res = await crud.get_by_id(db, Resolver, existing.resolver_id)
            existing_hash = _content_hash({
                "default_engine": existing_eng.origin_hash if existing_eng else "",
                "resolver": existing_res.origin_hash if existing_res else "",
                "resolver_config": existing.resolver_config,
                "retry_mode": existing.retry_mode,
                "retry_config": existing.retry_config,
            })
            if existing_hash == content_hash:
                issues.append({
                    "problem": "already_exists",
                    "existing_id": existing.id,
                })
            else:
                # Name conflict — different content
                issues.append({
                    "problem": "name_conflict",
                    "existing_id": existing.id,
                    "new_name": _unique_name(name, existing_by_name),
                })

        profile_reports.append({
            "name": name,
            "content_hash": content_hash,
            "valid": not any(
                i["problem"] in ("not_installed", "hash_mismatch")
                for i in issues
            ),
            "issues": issues,
        })

    # ── Validate autoruns ──────────────────────────────────────────

    for a in raw_autoruns:
        a_name = a.get("user_friendly_name", "untitled")
        issues: list[dict[str, Any]] = []

        # Check referenced profile exists in bundle or in DB
        profile_name = a.get("profile_name", "")
        bundle_profile_names = {p.get("name") for p in raw_profiles}
        if profile_name not in bundle_profile_names and profile_name not in existing_by_name:
            issues.append({
                "problem": "profile_missing",
                "profile_name": profile_name,
            })

        # Check engine override if present
        eng_override = a.get("engine_override")
        if eng_override:
            eng_hash = eng_override.get("origin_hash", "")
            eng_name = eng_override.get("name", "")
            installed = engine_map.get(eng_hash)
            if not installed:
                installed = engine_name_map.get(eng_name)
                if installed:
                    issues.append({
                        "field": "engine",
                        "problem": "hash_mismatch",
                        "bundled": {"name": eng_name, "origin_hash": eng_hash},
                        "installed": _plugin_ref(installed),
                        "alternatives": [_plugin_ref(e) for e in all_engines],
                    })
                else:
                    issues.append({
                        "field": "engine",
                        "problem": "not_installed",
                        "bundled": {"name": eng_name, "origin_hash": eng_hash},
                        "alternatives": [_plugin_ref(e) for e in all_engines],
                    })

        autorun_reports.append({
            "name": a_name,
            "valid": not any(
                i["problem"] in ("not_installed", "hash_mismatch", "profile_missing")
                for i in issues
            ),
            "issues": issues,
        })

    all_valid = all(r["valid"] for r in profile_reports) and all(
        r["valid"] for r in autorun_reports
    )

    return {
        "valid": all_valid,
        "profiles": profile_reports,
        "autoruns": autorun_reports,
    }


def _unique_name(base: str, existing: dict[str, Any]) -> str:
    """Find the next available name: base_2, base_3, …"""
    for i in range(2, 200):
        candidate = f"{base}_{i}"
        if candidate not in existing:
            return candidate
    return f"{base}_199"


def _slugify(name: str) -> str:
    """Convert a name to a filesystem-safe snake_case slug.

    Lowercases, replaces spaces/dashes with underscores, strips non-alphanumeric
    characters (except underscores), and collapses runs of underscores.
    """
    import re
    slug = name.lower().replace(" ", "_").replace("-", "_")
    slug = re.sub(r"[^a-z0-9_]", "", slug)
    slug = re.sub(r"_+", "_", slug).strip("_")
    return slug or "untitled"


async def _unique_snake_case_name(db: AsyncSession, base: str) -> str:
    """Find the next available snake_case_name not already in the autoruns table."""
    from sqlmodel import col as sa_col
    for i in range(2, 200):
        candidate = base if i == 2 else f"{base}_{i}"
        stmt = select(Autorun).where(sa_col(Autorun.snake_case_name) == candidate)
        result = await db.exec(stmt)
        if result.first() is None:
            return candidate
    return f"{base}_199"


# ═══════════════════════════════════════════════════════════════════════
# Apply endpoint
# ═══════════════════════════════════════════════════════════════════════


@import_export_router.post("/apply")
async def apply_bundle(
    payload: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(require_auth),
):
    """Apply a validated import bundle.

    Expects ``{ bundle, plugin_map, removed_profiles, removed_autoruns }`` where:
    - plugin_map maps origin_hash → { type: "engine"|"resolver", id: <installed_plugin_id> }
    - removed_profiles is a list of profile names the user chose to exclude
    - removed_autoruns is a list of autorun names the user chose to exclude
    """
    bundle = payload.get("bundle")
    plugin_map: dict[str, dict[str, Any]] = payload.get("plugin_map", {})
    removed_profiles: list[str] = payload.get("removed_profiles", [])
    removed_autoruns: list[str] = payload.get("removed_autoruns", [])

    if not bundle or not isinstance(bundle, dict):
        raise HTTPException(400, "Missing or invalid bundle")

    # Body size guard — prevent a malicious bundle with thousands of
    # profiles/autoruns from OOMing the server. 500 items per type is
    # generous for any legitimate import.
    MAX_BUNDLE_ITEMS = 500
    raw_profiles = bundle.get("profiles", [])
    raw_autoruns = bundle.get("autoruns", [])
    if not isinstance(raw_profiles, list) or not isinstance(raw_autoruns, list):
        raise HTTPException(400, "Bundle profiles and autoruns must be arrays")
    if len(raw_profiles) > MAX_BUNDLE_ITEMS or len(raw_autoruns) > MAX_BUNDLE_ITEMS:
        raise HTTPException(
            400,
            f"Bundle too large: max {MAX_BUNDLE_ITEMS} profiles/autoruns each",
        )

    version = bundle.get("version")
    if version != BUNDLE_VERSION:
        raise HTTPException(400, f"Unsupported bundle version: {version}")

    # Filter out items the user chose to remove
    raw_profiles = [p for p in raw_profiles if p.get("name", "untitled") not in removed_profiles]
    raw_autoruns = [a for a in raw_autoruns if a.get("user_friendly_name", "untitled") not in removed_autoruns]

    if auth.user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    requester = auth.user.username

    # Cache for resolved plugins
    _plugin_cache: dict[str, Engine | Resolver | None] = {}
    # Cache for created profiles (by name → Profile obj)
    created_profiles: dict[str, Profile] = {}

    existing_profiles = await crud.get_all(db, Profile)
    existing_by_name = {p.name: p for p in existing_profiles}

    profiles_created = 0
    profiles_skipped = 0
    autoruns_created = 0

    # ── Import profiles ────────────────────────────────────────────

    for p in raw_profiles:
        name = p.get("name", "untitled")
        eng_ref = p.get("default_engine", {})
        res_ref = p.get("resolver", {})

        # Check for skip (already exists with identical content)
        content_hash = _content_hash({
            "default_engine": eng_ref.get("origin_hash", ""),
            "resolver": res_ref.get("origin_hash", ""),
            "resolver_config": p.get("resolver_config", {}),
            "retry_mode": p.get("retry_mode", "none"),
            "retry_config": p.get("retry_config", {}),
        })
        existing = existing_by_name.get(name)
        if existing:
            existing_eng = await crud.get_by_id(db, Engine, existing.default_engine_id)
            existing_res = await crud.get_by_id(db, Resolver, existing.resolver_id)
            existing_hash = _content_hash({
                "default_engine": existing_eng.origin_hash if existing_eng else "",
                "resolver": existing_res.origin_hash if existing_res else "",
                "resolver_config": existing.resolver_config,
                "retry_mode": existing.retry_mode,
                "retry_config": existing.retry_config,
            })
            if existing_hash == content_hash:
                profiles_skipped += 1
                created_profiles[name] = existing
                continue
            # Name conflict — use resolved name from validation
            # The frontend should have sent the new_name via the validate step,
            # but we handle it here too for safety.
            # Actually the frontend doesn't modify the bundle name — it just shows
            # the rename info. We apply the rename ourselves.
            name = _unique_name(name, existing_by_name)

        # Resolve engine
        engine = await _resolve_with_map(db, eng_ref, plugin_map, Engine, _plugin_cache)
        if not engine:
            raise HTTPException(400, f"Cannot resolve engine for profile '{name}'")

        # Resolve resolver
        resolver = await _resolve_with_map(db, res_ref, plugin_map, Resolver, _plugin_cache)
        if not resolver:
            raise HTTPException(400, f"Cannot resolve resolver for profile '{name}'")

        profile_obj = Profile(
            name=name,
            default_engine_id=engine.id,
            resolver_id=resolver.id,
            resolver_config=p.get("resolver_config", {}),
            retry_mode=p.get("retry_mode", "none"),
            retry_config=p.get("retry_config", {}),
            requester_user_token=requester,
        )
        db.add(profile_obj)
        await db.flush()  # flush to get ID without committing
        profiles_created += 1
        created_profiles[p.get("name", "untitled")] = profile_obj
        existing_by_name[name] = profile_obj

    # ── Import autoruns ────────────────────────────────────────────

    for a in raw_autoruns:
        a_name = a.get("user_friendly_name", "untitled")
        profile_name = a.get("profile_name", "")

        # Resolve profile — either just created or already existing
        linked_profile = created_profiles.get(profile_name) or existing_by_name.get(profile_name)
        if not linked_profile:
            raise HTTPException(400, f"Autorun '{a_name}' references missing profile '{profile_name}'")

        # Resolve engine — override or profile default
        eng_override = a.get("engine_override")
        if eng_override:
            engine = await _resolve_with_map(db, eng_override, plugin_map, Engine, _plugin_cache)
            if not engine:
                raise HTTPException(400, f"Cannot resolve engine override for autorun '{a_name}'")
            engine_id = engine.id
        else:
            engine_id = linked_profile.default_engine_id

        # Generate a unique snake_case_name. Slugify the user-friendly name
        # and append a numeric suffix if it collides with an existing autorun.
        snake = _slugify(a_name)
        snake = await _unique_snake_case_name(db, snake)

        autorun_obj = Autorun(
            user_friendly_name=a_name,
            snake_case_name=snake,
            profile_id=linked_profile.id,
            engine_id=engine_id,
            resolver_id=linked_profile.resolver_id,
            resolver_config=a.get("resolver_config", linked_profile.resolver_config),
            retry_mode=a.get("retry_mode", linked_profile.retry_mode),
            retry_config=a.get("retry_config", linked_profile.retry_config),
            start_time=datetime.fromisoformat(a["start_time"]) if a.get("start_time") else datetime.now(timezone.utc).replace(tzinfo=None),
            end_time=datetime.fromisoformat(a["end_time"]) if a.get("end_time") else datetime.now(timezone.utc).replace(tzinfo=None),
            recording=a.get("recording", True),
            requester_user_token=requester,
        )
        db.add(autorun_obj)
        await db.flush()  # flush to get ID without committing
        autoruns_created += 1

    # Single commit for all changes (atomic)
    await db.commit()

    return {
        "profiles_created": profiles_created,
        "profiles_skipped": profiles_skipped,
        "autoruns_created": autoruns_created,
    }


async def _resolve_with_map(
    db: AsyncSession,
    ref: dict[str, Any],
    plugin_map: dict[str, dict[str, Any]],
    model: type[Engine] | type[Resolver],
    cache: dict[str, Engine | Resolver | None],
) -> Engine | Resolver | None:
    """Resolve a plugin reference using the plugin_map (for hash mismatches)
    or direct origin_hash lookup."""
    origin_hash = ref.get("origin_hash", "")
    name = ref.get("name", "")

    # Check if the user mapped this hash to a specific installed plugin
    mapping = plugin_map.get(origin_hash)
    if mapping:
        mapped_id = mapping.get("id")
        if mapped_id:
            cache_key = f"{model.__name__}:{mapped_id}"
            if cache_key not in cache:
                cache[cache_key] = await crud.get_by_id(db, model, mapped_id)
            return cache[cache_key]

    # Direct hash lookup
    cache_key = f"{model.__name__}:hash:{origin_hash}"
    if cache_key not in cache:
        cache[cache_key] = await _resolve_plugin(db, origin_hash, model)
    if cache[cache_key]:
        return cache[cache_key]

    # Fallback: try by name
    cache_key = f"{model.__name__}:name:{name}"
    if cache_key not in cache:
        cache[cache_key] = await _find_plugin_by_name(db, name, model)
    return cache[cache_key]
