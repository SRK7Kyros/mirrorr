"""Single source of truth for the Mirrorr Core version string.

Kept separate from the package ``__init__`` so it can be imported anywhere
(including API routes) without triggering circular imports. Bump alongside
``pyproject.toml``'s ``version``.
"""

__version__ = "0.1.0"