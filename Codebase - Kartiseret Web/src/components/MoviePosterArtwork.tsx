import { forwardRef, useCallback, useState } from "react";

type MoviePosterArtworkProps = {
  title: string;
  imageSrc?: string;
  alt?: string;
  className?: string;
  fallbackClassName?: string;
  fallbackTitleClassName?: string;
  loading?: "eager" | "lazy";
  decoding?: "async" | "auto" | "sync";
  fetchPriority?: "high" | "low" | "auto";
  draggable?: boolean;
  showFallbackWhileLoading?: boolean;
};

type PosterFallbackProps = {
  title: string;
  fallbackClassName?: string;
  fallbackTitleClassName?: string;
  isDecorative: boolean;
};

type LoadingFallbackPosterImageProps = PosterFallbackProps & {
  resolvedAlt: string;
  resolvedImageSrc: string;
  className?: string;
  loading?: "eager" | "lazy";
  decoding: "async" | "auto" | "sync";
  fetchPriority?: "high" | "low" | "auto";
  draggable: boolean;
};

function PosterFallback({
  title,
  fallbackClassName,
  fallbackTitleClassName,
  isDecorative,
}: PosterFallbackProps) {
  return (
    <div
      className={["movie-poster-fallback", fallbackClassName]
        .filter(Boolean)
        .join(" ")}
      aria-hidden={isDecorative ? "true" : undefined}
    >
      <span
        className={["movie-poster-fallback-title", fallbackTitleClassName]
          .filter(Boolean)
          .join(" ")}
      >
        {title}
      </span>
    </div>
  );
}

const LoadingFallbackPosterImage = forwardRef<
  HTMLImageElement,
  LoadingFallbackPosterImageProps
>(function LoadingFallbackPosterImage(
  {
    title,
    resolvedImageSrc,
    resolvedAlt,
    className,
    fallbackClassName,
    fallbackTitleClassName,
    loading,
    decoding,
    fetchPriority,
    draggable,
    isDecorative,
  },
  ref,
) {
  const [imageStatus, setImageStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const showFallback = imageStatus !== "loaded";

  const setImageNode = useCallback(
    (node: HTMLImageElement | null) => {
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }

      if (!node || !node.complete) {
        return;
      }

      setImageStatus(node.naturalWidth > 0 ? "loaded" : "error");
    },
    [ref],
  );

  return (
    <div className="movie-poster-artwork-shell">
      {showFallback ? (
        <PosterFallback
          title={title}
          fallbackClassName={fallbackClassName}
          fallbackTitleClassName={fallbackTitleClassName}
          isDecorative={isDecorative}
        />
      ) : null}
      <img
        ref={setImageNode}
        src={resolvedImageSrc}
        alt={resolvedAlt}
        aria-hidden={isDecorative ? "true" : undefined}
        loading={loading}
        decoding={decoding}
        fetchPriority={fetchPriority}
        draggable={draggable}
        className={className}
        onLoad={() => {
          setImageStatus("loaded");
        }}
        onError={() => {
          setImageStatus("error");
        }}
        style={showFallback ? { opacity: 0 } : undefined}
      />
    </div>
  );
});

export const MoviePosterArtwork = forwardRef<
  HTMLImageElement,
  MoviePosterArtworkProps
>(function MoviePosterArtwork(
  {
    title,
    imageSrc,
    alt,
    className,
    fallbackClassName,
    fallbackTitleClassName,
    loading,
    decoding = "async",
    fetchPriority,
    draggable = false,
    showFallbackWhileLoading = false,
  },
  ref,
) {
  const resolvedImageSrc = imageSrc?.trim();
  const resolvedAlt = alt ?? title;
  const isDecorative = resolvedAlt.length === 0;
  const shouldShowLoadingFallback =
    Boolean(resolvedImageSrc) && showFallbackWhileLoading;

  if (resolvedImageSrc) {
    if (shouldShowLoadingFallback) {
      return (
        <LoadingFallbackPosterImage
          key={resolvedImageSrc}
          ref={ref}
          title={title}
          resolvedImageSrc={resolvedImageSrc}
          resolvedAlt={resolvedAlt}
          className={className}
          fallbackClassName={fallbackClassName}
          fallbackTitleClassName={fallbackTitleClassName}
          loading={loading}
          decoding={decoding}
          fetchPriority={fetchPriority}
          draggable={draggable}
          isDecorative={isDecorative}
        />
      );
    }

    return (
      <img
        ref={ref}
        src={resolvedImageSrc}
        alt={resolvedAlt}
        aria-hidden={isDecorative ? "true" : undefined}
        loading={loading}
        decoding={decoding}
        fetchPriority={fetchPriority}
        draggable={draggable}
        className={className}
      />
    );
  }

  return (
    <PosterFallback
      title={title}
      fallbackClassName={[className, fallbackClassName].filter(Boolean).join(" ")}
      fallbackTitleClassName={fallbackTitleClassName}
      isDecorative={isDecorative}
    />
  );
});
