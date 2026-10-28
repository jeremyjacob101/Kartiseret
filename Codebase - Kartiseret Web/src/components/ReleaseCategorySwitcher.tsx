import { MOVIE_RELEASE_CATEGORY_LABELS, type MovieReleaseCategory } from "../domain/movieRelease";

const RELEASE_CATEGORIES: readonly MovieReleaseCategory[] = [
  "newReleases",
  "reReleases",
];

export function ReleaseCategorySwitcher({
  category,
  onChange,
  routeLabel,
}: {
  category: MovieReleaseCategory;
  onChange: (category: MovieReleaseCategory) => void;
  routeLabel: string;
}) {
  return (
    <div
      className="release-category-switcher"
      role="group"
      aria-label={`${routeLabel} release category`}
    >
      {RELEASE_CATEGORIES.map((option) => (
        <button
          key={option}
          type="button"
          className={`release-category-switcher-button${
            category === option ? " is-active" : ""
          }`}
          aria-pressed={category === option}
          onClick={() => {
            onChange(option);
          }}
        >
          {MOVIE_RELEASE_CATEGORY_LABELS[option]}
        </button>
      ))}
    </div>
  );
}
