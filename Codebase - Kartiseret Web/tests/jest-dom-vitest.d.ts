import "vitest";
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";
import type { ExpectStatic } from "vitest";

type AsymmetricMatcher = ReturnType<ExpectStatic["stringContaining"]>;

declare module "vitest" {
  interface Matchers<R, T> extends TestingLibraryMatchers<
    AsymmetricMatcher,
    R
  > {}

  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<
    AsymmetricMatcher,
    any
  > {}
}
