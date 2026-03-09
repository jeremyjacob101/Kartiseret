import { MovieScroller, type MovieScrollerJumpRequest } from "../MovieScroller";

const SCROLLER_CARD_WIDTH = 220;
const SCROLLER_CARD_HEIGHT = 330;
const SCROLLER_GAP = 22;
const SCROLLER_MAX_WIDTH = 1100;
const PLACEHOLDER_SECTION_COUNT = 8;

type LandingPageProps = {
  catalogError: string | null;
  catalogReady: boolean;
  comingSoonJumpRequest: MovieScrollerJumpRequest | null;
  nowPlayingJumpRequest: MovieScrollerJumpRequest | null;
};

function PlaceholderSections() {
  return Array.from({ length: PLACEHOLDER_SECTION_COUNT }, (_, index) => (
    <div className="section-heading" key={`placeholder-${index}`}>
      <p className="section-kicker">Placeholder</p>
      <h1 className="section-title">Placeholder</h1>
    </div>
  ));
}

export function LandingPage({
  catalogError,
  catalogReady,
  comingSoonJumpRequest,
  nowPlayingJumpRequest,
}: LandingPageProps) {
  return (
    <section className="scroller-panel" aria-label="Now Playing">
      {catalogError ? (
        <p className="app-inline-note" role="status">
          {catalogError}
        </p>
      ) : null}

      <div className="section-heading">
        <p className="section-kicker">Showtimes</p>
        <h1 className="section-title">Now Playing</h1>
      </div>
      <div className="scroller-slot">
        {catalogReady ? (
          <MovieScroller
            mode="nowPlaying"
            jumpRequest={nowPlayingJumpRequest}
            cardWidth={SCROLLER_CARD_WIDTH}
            cardHeight={SCROLLER_CARD_HEIGHT}
            gap={SCROLLER_GAP}
            maxWidth={SCROLLER_MAX_WIDTH}
          />
        ) : null}
      </div>
      <div className="section-heading">
        <p className="section-kicker">Coming soon</p>
        <h1 className="section-title">Coming Soon</h1>
      </div>
      <div className="scroller-slot">
        {catalogReady ? (
          <MovieScroller
            mode="comingSoon"
            jumpRequest={comingSoonJumpRequest}
            cardWidth={SCROLLER_CARD_WIDTH}
            cardHeight={SCROLLER_CARD_HEIGHT}
            gap={SCROLLER_GAP}
            maxWidth={SCROLLER_MAX_WIDTH}
          />
        ) : null}
      </div>

      <PlaceholderSections />
    </section>
  );
}
