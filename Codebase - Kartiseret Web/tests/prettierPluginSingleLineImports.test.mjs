import * as singleLineImportPlugin from "../config/prettier-plugin-single-line-imports.mjs";
import { describe, expect, it } from "vitest";
import * as prettier from "prettier";

async function format(source, options = {}) {
  return prettier.format(source, {
    filepath: options.filepath ?? "fixture.ts",
    parser: options.parser ?? "imports-typescript",
    plugins: [singleLineImportPlugin],
    singleLineImports: true,
    sortTopImportsByLength: true,
  });
}

describe("single-line import Prettier plugin", () => {
  it("sorts top imports by rendered length with stable ties", async () => {
    const formatted = await format(`
      import { x } from "aa";
      import { y } from "bb";
      import { extremelyLongName } from "long-module";
      const value = 1;
    `);

    expect(formatted).toBe(
      [
        'import { extremelyLongName } from "long-module";',
        'import { x } from "aa";',
        'import { y } from "bb";',
        "",
        "const value = 1;",
        "",
      ].join("\n"),
    );
  });

  it("supports TypeScript and TSX parser overrides", async () => {
    const typescript = await format(`
      import { x } from "x";
      import type { VeryLongType } from "very-long-types";
      export const value: VeryLongType = x as VeryLongType;
    `);
    const tsx = await format(
      `
        import { x } from "x";
        import { longValue } from "much-longer-module";
        export const Component = () => <div>{x}{longValue}</div>;
      `,
      { filepath: "fixture.tsx" },
    );

    expect(typescript.indexOf("import type { VeryLongType }")).toBeLessThan(
      typescript.indexOf("import { x }"),
    );
    expect(tsx.indexOf("import { longValue }")).toBeLessThan(
      tsx.indexOf("import { x }"),
    );
    expect(tsx).toContain("export const Component = () => (");
  });

  it("uses the same safe formatting path for Babel-family files", async () => {
    const formatted = await format(
      `
        import { x } from "x";
        import { muchLongerValue } from "much-longer-module";
        export const value = <div>{x}{muchLongerValue}</div>;
      `,
      { filepath: "fixture.jsx", parser: "imports-babel" },
    );

    expect(formatted.indexOf("import { muchLongerValue }")).toBeLessThan(
      formatted.indexOf("import { x }"),
    );
  });

  it("keeps side-effect imports as ordering barriers", async () => {
    const formatted = await format(`
      import { x } from "x";
      import { longerValue } from "a-long-module";
      import "./first.css";
      import { y } from "y";
      import { anotherLongValue } from "another-long-module";
      import "./second.css";
      const value = x + y + anotherLongValue + longerValue;
    `);

    expect(formatted).toBe(
      [
        'import { longerValue } from "a-long-module";',
        'import { x } from "x";',
        'import "./first.css";',
        'import { anotherLongValue } from "another-long-module";',
        'import { y } from "y";',
        'import "./second.css";',
        "",
        "const value = x + y + anotherLongValue + longerValue;",
        "",
      ].join("\n"),
    );
  });

  it("does not reorder a block when an import carries comments", async () => {
    const formatted = await format(`
      import { x } from "x";
      /* Keep this import in its original position. */
      import { veryLongValue } from "very-long-module";
      const value = x + veryLongValue;
    `);

    expect(formatted.indexOf("import { x }")).toBeLessThan(
      formatted.indexOf("import { veryLongValue }"),
    );
    expect(formatted).toContain("Keep this import in its original position.");
  });

  it("does not sort imports that appear after executable code", async () => {
    const formatted = await format(`
      import { x } from "x";
      const value = x;
      import { veryLongValue } from "very-long-module";
      export { value, veryLongValue };
    `);

    expect(formatted.indexOf("const value = x;")).toBeLessThan(
      formatted.indexOf("import { veryLongValue }"),
    );
  });
});
