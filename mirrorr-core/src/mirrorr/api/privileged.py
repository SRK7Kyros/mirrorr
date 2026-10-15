"""Admin-only response fields.

One declaration drives every gate on the server: the payload a non-admin
receives, and the OpenAPI document they are served. A non-admin never gets the
field in a response body and never reads it described in the schema; an admin
gets both.

The other half of this lives in the web app, which is built twice. The bundle
served to an admin carries the admin surfaces; the bundle served to everyone
else carries no component, string or role gate that mentions them. Nothing is
decided in the browser — see ``api.py`` (schema) and ``routers/auth.py``
(the nginx gate).
"""

from __future__ import annotations

import copy
import json
from types import UnionType
from typing import Any, Union, get_args, get_origin

from fastapi import Request
from fastapi.routing import APIRoute
from pydantic import BaseModel
from starlette.responses import JSONResponse, Response

from mirrorr.api.schemas import (
    AutorunResponse,
    ProfileResponse,
    RecordingResponse,
    ResolverSourceResponse,
    SessionResponse,
)

# Response model -> fields only an admin may receive.
PRIVILEGED_FIELDS: dict[type[BaseModel], frozenset[str]] = {
    SessionResponse: frozenset({"requester_user_token"}),
    AutorunResponse: frozenset({"requester_user_token"}),
    RecordingResponse: frozenset({"requester_user_token"}),
    ProfileResponse: frozenset({"requester_user_token"}),
    ResolverSourceResponse: frozenset({"requester_user_token"}),
}


def _fields_for(model: Any) -> frozenset[str]:
    """Admin-only fields reachable from a response model.

    Walks list/union wrappers and nested models, so an envelope
    (``SessionListResponse.items: list[SessionResponse]``) resolves to the
    fields of the model it wraps.
    """
    origin = get_origin(model)
    if origin is Union or origin is UnionType:
        found: frozenset[str] = frozenset()
        for arg in get_args(model):
            found |= _fields_for(arg)
        return found
    if origin in (list, tuple, set, frozenset):
        args = get_args(model)
        return _fields_for(args[0]) if args else frozenset()
    if isinstance(model, type) and issubclass(model, BaseModel):
        found = PRIVILEGED_FIELDS.get(model, frozenset())
        for field in model.model_fields.values():
            found |= _fields_for(field.annotation)
        return found
    return frozenset()


def _drop(node: Any, hidden: frozenset[str]) -> Any:
    if isinstance(node, dict):
        return {key: _drop(value, hidden) for key, value in node.items() if key not in hidden}
    if isinstance(node, list):
        return [_drop(item, hidden) for item in node]
    return node


class PrivilegedRoute(APIRoute):
    """Serves ``response_model`` minus the admin-only fields to a non-admin.

    The route knows its own response model, so nothing maps paths to schemas:
    a model listed in ``PRIVILEGED_FIELDS`` — directly or inside a list
    envelope — is stripped for every principal that is not an admin.
    ``response_model`` stays declared, so OpenAPI is unaffected.
    """

    def get_route_handler(self):
        handler = super().get_route_handler()
        hidden = _fields_for(self.response_model)
        if not hidden:
            return handler

        async def without_privileged(request: Request) -> Response:
            response = await handler(request)
            if getattr(request.state, "is_admin", False) or response.media_type != "application/json":
                return response
            body = getattr(response, "body", None)
            if body is None:
                body = b"".join([chunk async for chunk in response.body_iterator])
            headers = {k: v for k, v in response.headers.items() if k.lower() != "content-length"}
            return JSONResponse(_drop(json.loads(body), hidden), status_code=response.status_code, headers=headers)

        return without_privileged


def strip_openapi(spec: dict) -> dict:
    """A copy of ``spec`` with every admin-only property removed."""
    spec = copy.deepcopy(spec)
    schemas = spec.get("components", {}).get("schemas", {})
    for model, fields in PRIVILEGED_FIELDS.items():
        for name in (model.__name__, f"{model.__name__}-Output"):
            schema = schemas.get(name)
            if not schema:
                continue
            for field in fields:
                schema.get("properties", {}).pop(field, None)
            if "required" in schema:
                schema["required"] = [key for key in schema["required"] if key not in fields]
    return spec
