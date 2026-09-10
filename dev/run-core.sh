#!/bin/bash
# Wrapper for systemd: invoke mirrorr's entrypoint through the venv python
# directly, avoiding the console-script shebang/symlink chain that SELinux
# denies (203/EXEC) when spawned from a service unit.
exec /home/opc/everything/kyros/code/mirrorr/mirrorr-core/.venv/bin/python -c 'from mirrorr.main import main; main()' "$@"