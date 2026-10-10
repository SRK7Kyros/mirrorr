#!/bin/bash
# systemd wrapper: invoke mirrorr's entrypoint through the venv python
# directly, avoiding the console-script shebang/symlink chain that SELinux
# denies (203/EXEC) when spawned from a service unit.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$HERE/../mirrorr-core/.venv/bin/python" -c 'from mirrorr.main import main; main()' "$@"
