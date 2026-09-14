import argparse

from mirrorr.core import MirrorrCore
from mirrorr.startup.config import MirrorrSettings


def main():
    parser = argparse.ArgumentParser(
        prog="mirrorr",
        description="Mirrorr — live stream management service",
    )
    parser.add_argument(
        "-c", "--config",
        default=".env",
        help="path to .env config file (default: .env)",
    )
    parser.add_argument("--host", default=None, help="API bind host (default: localhost)")
    parser.add_argument("--port", type=int, default=None, help="API bind port (default: 8000)")
    parser.add_argument("--nats-port", type=int, default=None, help="NATS server port (default: 4222)")
    parser.add_argument("--base-dir", default=None, help="root directory for all Mirrorr state")
    parser.add_argument("--hls-window", type=int, default=None, help="sliding HLS manifest duration in seconds")
    parser.add_argument("--segment-duration", type=int, default=None, help="segment duration in seconds")
    parser.add_argument("--web-url", default=None, help="public base URL (e.g. https://domain.duckdns.org)")
    parser.add_argument("--dev-serve-files", action="store_true", default=None, help="mount content_dir as static files (dev only)")
    parser.add_argument("--dev-seed-admin", action="store_true", default=None, help="auto-create admin user (admin/admin123) on boot (dev only)")
    args = parser.parse_args()

    overrides = {}
    if args.host is not None:
        overrides["api_host"] = args.host
    if args.port is not None:
        overrides["api_port"] = args.port
    if args.nats_port is not None:
        overrides["nats_port"] = args.nats_port
    if args.base_dir is not None:
        overrides["base_dir"] = args.base_dir
    if args.hls_window is not None:
        overrides["hls_window"] = args.hls_window
    if args.segment_duration is not None:
        overrides["segment_duration"] = args.segment_duration
    if args.web_url is not None:
        overrides["web_url"] = args.web_url
    if args.dev_serve_files is not None:
        overrides["dev_serve_files"] = args.dev_serve_files
    if args.dev_seed_admin is not None:
        overrides["dev_seed_admin"] = args.dev_seed_admin

    settings = MirrorrSettings.create_from_env(args.config, **overrides)
    core = MirrorrCore(settings)

    try:
        core.run_blocking()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
