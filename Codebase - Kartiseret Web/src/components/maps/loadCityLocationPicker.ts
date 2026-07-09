import { preloadTheaters } from "../../data/theaters";

let cityLocationPickerPromise: Promise<
  typeof import("./CityLocationPicker")
> | null = null;
let theaterPreloadStarted = false;

export function loadCityLocationPicker(): Promise<
  typeof import("./CityLocationPicker")
> {
  cityLocationPickerPromise ??= import("./CityLocationPicker");

  return cityLocationPickerPromise;
}

export function preloadCityLocationPicker(): void {
  void loadCityLocationPicker();

  if (theaterPreloadStarted) {
    return;
  }

  theaterPreloadStarted = true;
  preloadTheaters();
}
