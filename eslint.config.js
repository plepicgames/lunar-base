import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

function imports(allowed) {
  const names = allowed.map((entry) => {
    const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return entry.endsWith("/") || entry.endsWith(":")
      ? `${escaped}(?!\\.\\.(?:/|$)|.*\\/\\.\\.(?:/|$)).+`
      : `${escaped}$`;
  });
  return [
    "error",
    {
      patterns: [
        {
          regex: `^(?!${names.join("|")}).+`,
          message: "Import crosses a directory boundary or uses an unapproved package.",
        },
      ],
    },
  ];
}

// Relative import paths gain one ../ for each directory below a layer root.
// Apply an exact-depth override so ../ can reach the layer root but cannot
// escape into a sibling layer without that layer being on the allow-list.
function nestedImports(layer, allowed) {
  return Array.from({ length: 12 }, (_, index) => {
    const depth = index + 1;
    const up = "../".repeat(depth);
    const own = ["./", ...Array.from({ length: depth }, (_, i) => "../".repeat(i + 1))];
    const reachable = allowed
      .filter((entry) => entry !== "./")
      .map((entry) => (entry.startsWith("../") ? up + entry : entry));
    return {
      files: [`src/${layer}/${"*/".repeat(depth)}*.ts`, `src/${layer}/${"*/".repeat(depth)}*.tsx`],
      ignores: ["**/*.test.ts", "**/*.test.tsx"],
      rules: { "no-restricted-imports": imports([...own, ...reachable]) },
    };
  });
}

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      ".cache/**",
      ".worktrees/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts", "**/*.tsx"],
  })),
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["vite.config.ts"],
          defaultProject: "./tsconfig.tests.json",
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },
  {
    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "test/**/*.ts",
      "tools/**/*.ts",
      "e2e/**/*.ts",
      "vitest.config.ts",
      "playwright.config.ts",
    ],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: "./tsconfig.tests.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["src/engine/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": imports(["./", "../../docs/design/cards.json"]),
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Use the seeded generator." },
        { object: "Date", property: "now", message: "Engine code cannot read the clock." },
      ],
    },
  },
  {
    files: ["src/protocol/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: { "no-restricted-imports": imports(["./", "../engine/", "zod"]) },
  },
  {
    files: ["src/bots/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": imports([
        "./",
        "../engine/index.ts",
        "../engine/rng.ts",
        "../protocol/",
        "@typesafe-ai/sdk",
        "zod",
      ]),
    },
  },
  {
    files: ["src/server/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": imports([
        "./",
        "../engine/",
        "../protocol/",
        "../bots/",
        "node:",
        "ws",
        "sirv",
        "zod",
      ]),
    },
  },
  {
    files: ["src/client/**/*.ts", "src/client/**/*.tsx"],
    ignores: ["**/*.test.ts", "**/*.test.tsx"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      "no-restricted-imports": imports([
        "./",
        "../protocol/",
        "react",
        "react-dom",
        "react-dom/",
        "../../docs/design/cards.json",
        "@fontsource-variable/outfit",
      ]),
    },
  },
  ...nestedImports("engine", ["./", "../../docs/design/cards.json"]),
  ...nestedImports("protocol", ["./", "../engine/", "zod"]),
  ...nestedImports("bots", [
    "./",
    "../engine/index.ts",
    "../engine/rng.ts",
    "../protocol/",
    "@typesafe-ai/sdk",
    "zod",
  ]),
  ...nestedImports("server", [
    "./",
    "../engine/",
    "../protocol/",
    "../bots/",
    "node:",
    "ws",
    "sirv",
    "zod",
  ]),
  ...nestedImports("client", [
    "./",
    "../protocol/",
    "react",
    "react-dom",
    "react-dom/",
    "../../docs/design/cards.json",
    "@fontsource-variable/outfit",
  ]),
);
