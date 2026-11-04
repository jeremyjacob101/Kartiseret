import logging, os, sys, traceback, re, signal
logger = logging.getLogger("sel")
SUPPRESS_ERRORS = False


def setup_logging() -> None:
    def _handler(sig, frame):
        global SUPPRESS_ERRORS
        SUPPRESS_ERRORS = True
        signal.default_int_handler(sig, frame)

    try:
        signal.signal(signal.SIGINT, _handler)
    except Exception:
        pass

    logging.basicConfig(level=logging.ERROR, format="%(asctime)s %(levelname)s %(filename)s:%(lineno)d %(message)s", handlers=[logging.StreamHandler(sys.stdout)], force=True)
    logger.setLevel(logging.ERROR)


def _redact_sensitive_text(value: str) -> str:
    value = re.sub(
        r"(?i)(api[_-]?key|access[_-]?token|secret[_-]?access[_-]?key|password|authorization)(\s*[=:]\s*)([^&\s,;]+)",
        r"\1\2[REDACTED]",
        value,
    )
    return re.sub(r"(?i)Bearer\s+[A-Za-z0-9._~+/-]+=*", "Bearer [REDACTED]", value)


def artifactPrinting(obj, run_id, *, item_name: str | None = None, attempt: int | None = None):
    if SUPPRESS_ERRORS:
        return

    name = item_name or (getattr(obj, "_artifact_item_name", None) if obj is not None else None) or (obj.__class__.__name__ if obj else "Unknown")
    attempt_number = attempt or (getattr(obj, "_artifact_attempt", None) if obj is not None else None) or 1
    drv = getattr(obj, "driver", None) if obj is not None else None

    try:
        url = getattr(drv, "current_url", "?") if drv else "?"
    except Exception:
        url = "?"

    exc_type, exc_value, tb = sys.exc_info()
    if tb is None or exc_type in (KeyboardInterrupt, SystemExit) or isinstance(exc_value, KeyboardInterrupt):
        return

    frames, filtered = traceback.extract_tb(tb), []
    for frame in frames:
        path = frame.filename.replace("\\", "/")
        if any(s in path for s in ("/site-packages/", "/dist-packages/", "/lib/python", "/.venv/", "/venv/", "/pyenv/", "/conda/", "/selenium/", "selenium")):
            continue
        if os.path.basename(path) in {"webdriver.py", "errorhandler.py", "remote_connection.py", "service.py"}:
            continue
        filtered.append(frame)

    tail = (filtered or frames)[-5:]
    call_chain = " > ".join(f"{os.path.basename(f.filename)}:{f.lineno}" for f in tail)

    exc_type_name = exc_type.__name__ if exc_type else "Exception"
    raw_msg = str(exc_value) if exc_value else ""
    cleaned_msg = "\n".join(ln for ln in raw_msg.splitlines() if not any(b in ln.lower() for b in ("stacktrace", "documentation", "<unknown>", "chromedriver", "libsystem_pthread.dylib")))
    exception_msg = cleaned_msg if exc_type_name == "Exception" else f"{exc_type_name} - {cleaned_msg}"
    exception_msg = _redact_sensitive_text(exception_msg)

    match = re.search(r'"selector":\s*"([^"]+)"', cleaned_msg)
    selector = match.group(1) if match else None

    cleaned_name = name.replace(" ", "_").strip()
    screenshot_key = None
    from backend.utils.log.run_storage import RunArtifactStore
    store = RunArtifactStore()
    if drv:
        try:
            screenshot = drv.get_screenshot_as_png()
        except Exception as error:
            screenshot_key = f"unavailable ({type(error).__name__})"
        else:
            saved = store.save_file_artifact(
                run_id=int(run_id),
                artifact_type="screenshots",
                name=f"{cleaned_name}-{attempt_number}",
                content=screenshot,
                content_type="image/png",
                metadata={"source": "selenium", "item_name": name, "attempt": attempt_number},
                compress_screenshot=True,
            )
            screenshot_key = saved["object_key"]

    safe_url = _redact_sensitive_text(str(url or "?"))
    lines = [
        "- - -", "ERROR", "- - -", f"Name: {name or ''}", f"URL: {safe_url}",
        f"Exception: {exception_msg or ''}", f"Call Chain: {call_chain or ''}",
        f"Selector: {_redact_sensitive_text(selector or '')}",
        f"Screenshot R2 key: {screenshot_key or ''}",
    ]
    store.save_text_artifact(
        run_id=int(run_id), artifact_type="scrape_error",
        name=f"{cleaned_name}-{attempt_number}", text="\n".join(lines),
        metadata={"item_name": name, "attempt": attempt_number, "exception_type": exc_type_name},
    )
