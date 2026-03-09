import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { getCssTimeMs } from "../../lib/cssVariables";
import { type AppPathname } from "./appRouting";

type UseFloatingTopbarOptions = {
  pathname: AppPathname;
  showTopbarIntro: boolean;
  topbarShellRef: RefObject<HTMLDivElement | null>;
};

type FloatingTopbarState = {
  floatingTopbarVisible: boolean;
  renderFloatingTopbar: boolean;
};

export function useFloatingTopbar({
  pathname,
  showTopbarIntro,
  topbarShellRef,
}: UseFloatingTopbarOptions): FloatingTopbarState {
  const [showFloatingTopbar, setShowFloatingTopbar] = useState(false);
  const [renderFloatingTopbar, setRenderFloatingTopbar] = useState(false);
  const [floatingTopbarVisible, setFloatingTopbarVisible] = useState(false);
  const floatingTopbarEnterFrameRef = useRef<number | null>(null);
  const floatingTopbarExitTimeoutRef = useRef<number | null>(null);
  const floatingTopbarExitDurationMs = useMemo(
    () => getCssTimeMs("--floating-topbar-exit-duration", 620),
    [],
  );

  useEffect(() => {
    let frameId: number | null = null;

    const updateFloatingTopbar = () => {
      frameId = null;
      const topbarBottom =
        topbarShellRef.current?.getBoundingClientRect().bottom ?? 0;

      setShowFloatingTopbar(topbarBottom <= 0);
    };

    const requestFloatingTopbarUpdate = () => {
      if (frameId !== null) {
        return;
      }

      frameId = window.requestAnimationFrame(updateFloatingTopbar);
    };

    updateFloatingTopbar();

    window.addEventListener("scroll", requestFloatingTopbarUpdate, {
      passive: true,
    });
    window.addEventListener("resize", requestFloatingTopbarUpdate);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      window.removeEventListener("scroll", requestFloatingTopbarUpdate);
      window.removeEventListener("resize", requestFloatingTopbarUpdate);
    };
  }, [pathname, topbarShellRef]);

  useEffect(() => {
    if (showTopbarIntro) {
      if (floatingTopbarEnterFrameRef.current !== null) {
        window.cancelAnimationFrame(floatingTopbarEnterFrameRef.current);
        floatingTopbarEnterFrameRef.current = null;
      }

      if (floatingTopbarExitTimeoutRef.current !== null) {
        window.clearTimeout(floatingTopbarExitTimeoutRef.current);
        floatingTopbarExitTimeoutRef.current = null;
      }

      return;
    }

    if (showFloatingTopbar) {
      if (floatingTopbarExitTimeoutRef.current !== null) {
        window.clearTimeout(floatingTopbarExitTimeoutRef.current);
        floatingTopbarExitTimeoutRef.current = null;
      }

      if (!renderFloatingTopbar) {
        floatingTopbarEnterFrameRef.current = window.requestAnimationFrame(
          () => {
            setRenderFloatingTopbar(true);
            setFloatingTopbarVisible(false);
            floatingTopbarEnterFrameRef.current = window.requestAnimationFrame(
              () => {
                floatingTopbarEnterFrameRef.current = null;
                setFloatingTopbarVisible(true);
              },
            );
          },
        );
        return;
      }

      floatingTopbarEnterFrameRef.current = window.requestAnimationFrame(() => {
        floatingTopbarEnterFrameRef.current = null;
        setFloatingTopbarVisible(true);
      });
      return;
    }

    if (floatingTopbarEnterFrameRef.current !== null) {
      window.cancelAnimationFrame(floatingTopbarEnterFrameRef.current);
      floatingTopbarEnterFrameRef.current = null;
    }

    floatingTopbarEnterFrameRef.current = window.requestAnimationFrame(() => {
      floatingTopbarEnterFrameRef.current = null;
      setFloatingTopbarVisible(false);
    });

    if (!renderFloatingTopbar) {
      return;
    }

    floatingTopbarExitTimeoutRef.current = window.setTimeout(() => {
      floatingTopbarExitTimeoutRef.current = null;
      setRenderFloatingTopbar(false);
    }, floatingTopbarExitDurationMs);
  }, [
    floatingTopbarExitDurationMs,
    renderFloatingTopbar,
    showFloatingTopbar,
    showTopbarIntro,
  ]);

  useEffect(() => {
    return () => {
      if (floatingTopbarEnterFrameRef.current !== null) {
        window.cancelAnimationFrame(floatingTopbarEnterFrameRef.current);
      }

      if (floatingTopbarExitTimeoutRef.current !== null) {
        window.clearTimeout(floatingTopbarExitTimeoutRef.current);
      }
    };
  }, []);

  return {
    floatingTopbarVisible,
    renderFloatingTopbar,
  };
}
