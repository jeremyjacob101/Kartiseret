from dotenv import load_dotenv

load_dotenv()

from backend.config.runners import runGroup
from backend.dataflow.comingsoons.ComingSoonsPreview import ComingSoonsPreview
from backend.dataflow.nowplayings.NowPlayingsPreview import NowPlayingsPreview
from backend.utils.log import artifact_logging, run_logging
import os


PREVIEW_PLAN = [("dataflow", "comingSoonsData", [ComingSoonsPreview]), ("dataflow", "nowPlayingData", [NowPlayingsPreview])]


def main():
    artifact_logging.setup_logging()
    with run_logging.RunLogSession() as run:
        run.run_groups(PREVIEW_PLAN, run_group_fn=runGroup)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        artifact_logging.SUPPRESS_ERRORS = True
        os._exit(0)
