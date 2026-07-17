import multiprocessing
import sys
import logging
from loguru import logger

_NOISY_LOGGERS = frozenset({
    "websockets.server",
    "websockets.legacy.server",
    "websockets.legacy.protocol",
    "uvicorn.access",
})

# Websocket lifecycle messages that uvicorn logs through its own logger
_NOISY_MESSAGES = frozenset({"connection open", "connection closed"})


def _is_noisy(record: logging.LogRecord) -> bool:
    """Return True if this record should be silently dropped."""
    if record.name in _NOISY_LOGGERS:
        return True
    msg = record.getMessage()
    if msg in _NOISY_MESSAGES:
        return True
    # Uvicorn logs WebSocket access via its error logger with a
    # characteristic "WebSocket ..." [accepted] format — drop those too.
    if '"WebSocket ' in msg:
        return True
    return False


class InterceptHandler(logging.Handler):
    """Redirects standard library logs to Loguru with detailed format."""
    def emit(self, record):
        if _is_noisy(record):
            return

        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        logger.opt(exception=record.exc_info).bind(
            name=record.name,
        ).opt(depth=6).log(
            level, record.getMessage(),
        )

_process_name_length = 28

# 2. Configure standard logging to use our InterceptHandler
def setup_logging():
    sys.__stdout__.reconfigure(line_buffering=True)
    
    # Remove default handlers
    logger.remove()

    def patcher(record):
        process_name = multiprocessing.current_process().name
        # Se è il main process, chiamiamolo 'Main'
        if process_name == "MainProcess":
            process_name = "Master"
        record["extra"]["process"] = process_name
        # Ensure 'name' always exists in extra for the format string.
        record["extra"].setdefault("name", record["name"])

    logger.configure(patcher=patcher)

    start_str = "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | <level>{level: <8}</level> | "

    format_string = (
        start_str +
        "<cyan>{extra[process]: <###}</cyan> | ".replace("###", str(_process_name_length)) +
        "<magenta>{extra[name]}</magenta> - {message}"
    )

    def _is_uvicorn(rec):
        return rec["extra"].get("name", rec["name"]).startswith("uvicorn")

    def _is_nats_server(rec):
        return rec["name"].lower().startswith("nats-server")

    def not_any(rec):
        return not any([_is_uvicorn(rec), _is_nats_server(rec)])

    def magenta_format(name: str) -> str:
        return "<magenta>" + name.ljust(_process_name_length) + "</magenta> | {message}"

    def default_format() -> str:
        return "<cyan>{extra[process]: <###}</cyan> | ".replace("###", str(_process_name_length)) + "{message}"

    def raw_sink(msg):
        sys.__stdout__.write(msg)
        sys.__stdout__.flush()

    logger.add(raw_sink, filter=_is_nats_server,
        format=start_str + magenta_format("NATS-Server"), colorize=True)

    logger.add(raw_sink, filter=_is_uvicorn,
        format=start_str + magenta_format("uvicorn"), colorize=True)

    logger.add(raw_sink, filter=not_any, format=format_string, colorize=True)

    intercept_handler = InterceptHandler()
    logging.basicConfig(handlers=[intercept_handler], level=logging.INFO, force=True)

    noisy_libs = ["sqlalchemy"]
    for noisy_lib in noisy_libs:
        logging.getLogger(noisy_lib).setLevel(logging.WARNING)

    for name in logging.root.manager.loggerDict.keys():
        if any(name.startswith(lib) for lib in noisy_libs):
            continue
        log = logging.getLogger(name)
        log.handlers = [intercept_handler]
        log.propagate = False
        log.setLevel(logging.INFO)

    logging.root.handlers = [intercept_handler]
    logging.root.setLevel(logging.INFO)
