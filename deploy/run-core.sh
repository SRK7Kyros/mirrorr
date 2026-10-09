#!/bin/bash
# systemd wrapper: invoke mirrorr's entrypoint through the venv python
# directly, avoiding the console-script shebang/symlink chain that SELinux
# denies (203/EXEC) when spawned from a service unit.
exec __REPO_ROOT__/mirrorr-core/.venv/bin/python -c 'from mirrorr.main import main; main()' "$@"
