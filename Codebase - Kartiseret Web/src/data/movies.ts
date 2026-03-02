export type Movie = {
  title: string;
  year: number;
  imageSrc: string;
  imdbRating: number;
  rtRating: number;
  runtime: number;
};

export const movies: Movie[] = [
  {
    title: "Citizen Kane",
    year: 1941,
    imageSrc: "/poster1.jpg",
    imdbRating: 8.6,
    rtRating: 98,
    runtime: 119,
  },
  {
    title: "Casablanca",
    year: 1942,
    imageSrc: "/poster2.jpg",
    imdbRating: 8.5,
    rtRating: 97,
    runtime: 102,
  },
  {
    title: "The Godfather",
    year: 1972,
    imageSrc: "/poster3.jpg",
    imdbRating: 9.1,
    rtRating: 99,
    runtime: 175,
  },
  {
    title: "2001: A Space Odyssey",
    year: 1968,
    imageSrc: "/poster4.jpg",
    imdbRating: 8.3,
    rtRating: 92,
    runtime: 149,
  },
  {
    title: "Seven Samurai",
    year: 1954,
    imageSrc: "/poster5.jpg",
    imdbRating: 8.7,
    rtRating: 96,
    runtime: 207,
  },
  {
    title: "Vertigo",
    year: 1958,
    imageSrc: "/poster6.jpg",
    imdbRating: 8.2,
    rtRating: 94,
    runtime: 128,
  },
  {
    title: "Psycho",
    year: 1960,
    imageSrc: "/poster7.jpg",
    imdbRating: 8.4,
    rtRating: 95,
    runtime: 109,
  },
  {
    title: "Lawrence of Arabia",
    year: 1962,
    imageSrc: "/poster8.jpg",
    imdbRating: 8.3,
    rtRating: 93,
    runtime: 222,
  },
  {
    title: "Schindler's List",
    year: 1993,
    imageSrc: "/poster9.jpg",
    imdbRating: 8.9,
    rtRating: 98,
    runtime: 195,
  },
  {
    title: "Pulp Fiction",
    year: 1994,
    imageSrc: "/poster10.jpg",
    imdbRating: 8.8,
    rtRating: 94,
    runtime: 154,
  },
];

// 600x900 poster size
