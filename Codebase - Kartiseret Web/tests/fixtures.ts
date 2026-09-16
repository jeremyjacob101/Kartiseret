import type { Movie, MovieShowtimeDay, TheaterShowtimes } from "../src/data/movieCatalog";

export const sampleMovie: Movie = {
  tmdbId: "101",
  movieCode: "Ab1",
  imdbId: "tt1234567",
  rtId: "/m/sample_movie",
  lbId: "/film/sample-movie/",
  title: "Sample Movie",
  year: 2026,
  releaseDate: "2026-09-18",
  genres: ["Drama", "Comedy"],
  imageSrc: "/posters/sample.jpg",
  backdropSrc: "/backdrops/sample.jpg",
  trailerKey: "dQw4w9WgXcQ",
  imdbRating: 8.25,
  lbRating: 4.2,
  lbVotes: 1200,
  tmdbRating: 8.34,
  tmdbVotes: 9876,
  rtCriticRating: 80,
  rtCriticVotes: 100,
  rtAudienceRating: 92,
  rtAudienceVotes: 600,
  runtime: 125,
  popularity: 42.5,
  altOptions: [],
};

export const sampleShowtimes: TheaterShowtimes[] = [
  {
    theater: "Cinema City",
    showtimes: [
      {
        time: "19:30",
        href: "https://tickets.example.test/sample",
        screeningTech: "2D IMAX",
        screeningType: "VIP",
        dubLanguage: "Hebrew",
      },
      {
        time: "21:00",
        href: null,
        screeningTech: "2D",
        screeningType: "Regular",
        dubLanguage: null,
      },
    ],
  },
  {
    theater: "Unknown Cinema",
    showtimes: [
      {
        time: "22:15",
        href: null,
        screeningTech: "3D",
        screeningType: "Premium",
        dubLanguage: "French",
      },
    ],
  },
];

export const sampleShowtimeDays: MovieShowtimeDay[] = [
  { date: "2026-09-16", theaters: [] },
  { date: "2026-09-17", theaters: sampleShowtimes },
];
