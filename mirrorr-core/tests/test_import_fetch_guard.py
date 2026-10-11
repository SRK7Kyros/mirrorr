"""``POST /import-export/fetch`` must not become a probe of the server's own network.

The endpoint makes an outbound request on a user's behalf, so every address the
target host resolves to is checked before the request is made. Cloud metadata
(169.254.169.254), the tailnet (100.64.0.0/10) and loopback are all non-global
and therefore refused.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from mirrorr.api.routers.import_export import _direct_file_url, _public_address


@pytest.mark.parametrize(
    "addr",
    [
        "127.0.0.1",
        "10.1.2.3",
        "192.168.1.1",
        "169.254.169.254",
        "100.64.0.1",
        "0.0.0.0",
        "::1",
        "fd00::1",
        "::ffff:127.0.0.1",
    ],
)
def test_non_public_addresses_are_refused(addr):
    with pytest.raises(HTTPException):
        _public_address("evil.example", addr)


@pytest.mark.parametrize("addr", ["8.8.8.8", "1.1.1.1", "2606:4700::1111"])
def test_public_addresses_pass(addr):
    _public_address("cdn.example", addr)


@pytest.mark.parametrize(
    "url",
    ["ftp://example.com/b.json", "file:///etc/passwd", "javascript:alert(1)", "https://"],
)
def test_only_http_urls_with_a_host_are_accepted(url):
    with pytest.raises(HTTPException):
        _direct_file_url(url)


def test_a_plain_http_url_is_returned_trimmed():
    assert _direct_file_url("  https://example.com/b.json  ") == "https://example.com/b.json"
