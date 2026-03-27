import { forwardRef } from "react";

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
};

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
  },
  ref,
) {
  const resolvedImageSrc = imageSrc?.trim();
  const resolvedAlt = alt ?? title;
  const isDecorative = resolvedAlt.length === 0;

  if (resolvedImageSrc) {
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
    <div
      className={["movie-poster-fallback", className, fallbackClassName]
        .filter(Boolean)
        .join(" ")}
      aria-hidden={isDecorative ? "true" : undefined}
    >
      <span
        className={["movie-poster-fallback__title", fallbackTitleClassName]
          .filter(Boolean)
          .join(" ")}
      >
        {title}
      </span>
    </div>
  );
});
