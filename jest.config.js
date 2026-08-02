const fs = require("fs");
const path = require("path");

// FOUR projects, and the root `pnpm test` runs all of them in ONE invocation.
//
// It used to run `--filter @apps/backend test && --filter @apps/frontend test`, which quietly
// excluded the `types` and `utils` projects: the model-registry capability tests — written after a
// model change 400'd every background run — never executed in CI at all. A suite that does not run
// is worse than no suite, because the green check says otherwise.
//
// The root script also BUILDS packages/types first. The backend and frontend projects resolve
// `@packages/*` to `packages/*/dist` (see moduleNameMapper below), so without that build a test can
// pass against a stale copy of the very file the change is in. `dev:backend` builds it for the same
// reason: nest --watch recompiles the backend but not the workspace package, and a new export then
// fails at runtime as "completionBudget is not a function" rather than as a compile error.

/**
 * Names of the ESM-only packages in the dependency closure of `roots`.
 *
 * The markdown stack (react-markdown → unified → micromark, ~80 packages) publishes ESM only, so
 * requiring it from a CommonJS test throws "Unexpected token 'export'" unless Jest is told to
 * transform it. Deriving the list beats hardcoding one: adding a remark plugin pulls in a fresh
 * handful of micromark utilities, and a stale hardcoded list fails as a confusing parse error in
 * an unrelated test. Costs a few dozen package.json reads at config load.
 */
function esmOnlyDependencies(roots) {
  const seen = new Set();
  const esm = new Set();

  // Node's own lookup: walk up from `fromDir` trying <dir>/node_modules/<name>. Necessary because a
  // package can be nested — pnpm puts a second copy under unified/node_modules/ when versions
  // diverge, and that copy is ESM even where the hoisted one is not.
  const resolvePackage = (name, fromDir) => {
    let dir = fromDir;
    for (;;) {
      const candidate = path.join(dir, "node_modules", name);
      if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  };

  const visit = (name, fromDir) => {
    const dir = resolvePackage(name, fromDir);
    if (!dir || seen.has(dir)) return; // Not installed, or already walked.
    seen.add(dir);
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    } catch {
      return;
    }
    // The name is what lands in the pattern, and the pattern matches any node_modules/<name>
    // segment — so one entry covers the hoisted copy and every nested one.
    if (pkg.type === "module") esm.add(name);
    for (const dep of Object.keys(pkg.dependencies || {})) visit(dep, dir);
  };

  roots.forEach((name) => visit(name, __dirname));
  return [...esm];
}

// Root Jest configuration for the monorepo
const config = {
  projects: [
    // Backend project configuration
    {
      displayName: "backend",
      testEnvironment: "node",
      rootDir: path.resolve(__dirname, "apps/backend"),
      testMatch: ["<rootDir>/src/**/*.spec.ts", "<rootDir>/test/**/*.spec.ts"],
      transform: {
        "^.+\\.(t|j)s$": [
          "ts-jest",
          {
            tsconfig: path.resolve(__dirname, "apps/backend/tsconfig.json")
          }
        ]
      },
      moduleFileExtensions: ["js", "json", "ts"],
      collectCoverageFrom: [
        "src/**/*.(t|j)s",
        "!src/**/*.spec.ts",
        "!src/**/*.interface.ts",
        "!src/main.ts"
      ],
      coverageDirectory: path.resolve(__dirname, "coverage/backend"),
      setupFilesAfterEnv: ["<rootDir>/test/setup.ts"],
      moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/src/$1",
        "^@packages/utils/(.*)$": path.resolve(
          __dirname,
          "packages/utils/src/$1"
        ),
        "^@packages/utils$": path.resolve(__dirname, "packages/utils/src"),
        "^../test/(.*)$": "<rootDir>/test/$1"
      },
      moduleDirectories: ["node_modules", path.resolve(__dirname, "packages")]
    },
    // Frontend project configuration
    {
      displayName: "frontend",
      testEnvironment: "jsdom",
      rootDir: path.resolve(__dirname, "apps/frontend"),
      testMatch: ["<rootDir>/src/**/*.(test|spec).(js|jsx|ts|tsx)"],
      moduleFileExtensions: ["js", "jsx", "ts", "tsx"],
      collectCoverageFrom: [
        "src/**/*.(js|jsx|ts|tsx)",
        "!src/**/*.(test|spec).(js|jsx|ts|tsx)",
        "!src/**/*.d.ts"
      ],
      coverageDirectory: path.resolve(__dirname, "coverage/frontend"),
      setupFilesAfterEnv: ["<rootDir>/test/setup.ts"],
      moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/src/$1",
        "^@packages/(.*)$": path.resolve(__dirname, "packages/$1/dist"),
        "\\.(css|less|scss|sass)$": "identity-obj-proxy",
        "\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$":
          "jest-transform-stub"
      },
      moduleDirectories: ["node_modules", path.resolve(__dirname, "packages")],
      transform: {
        "^.+\\.(js|jsx|ts|tsx)$": [
          "ts-jest",
          {
            useESM: true,
            tsconfig: {
              jsx: "react-jsx",
              // The transformed markdown stack default-imports CJS packages (unified does
              // `import extend from "extend"`). Without interop that compiles to `extend_1.default`,
              // which is undefined for a module that has no __esModule marker. Vite/esbuild does
              // this shimming natively, so only the test transform needs it stated.
              esModuleInterop: true
            }
          }
        ]
      },
      // node_modules is left untransformed except for the ESM-only markdown stack, which has to be
      // transpiled so the Markdown renderer can be tested against the REAL unified pipeline. That
      // matters: the citation-plugin bug that blanked the conversation view was in how the plugin
      // was handed to unified, which testing the plugin in isolation cannot catch.
      transformIgnorePatterns: [
        `node_modules/(?!(${[
          "react-resizable-panels",
          ...esmOnlyDependencies(["react-markdown", "remark-gfm"])
        ]
          // A scoped name contains a slash, which would otherwise close the path group early.
          .map((name) => name.replace(/\//g, "\\/"))
          .join("|")})/)`
      ],
      extensionsToTreatAsEsm: [".ts", ".tsx"]
    },
    // Utils package configuration
    {
      displayName: "utils",
      testEnvironment: "node",
      rootDir: path.resolve(__dirname, "packages/utils"),
      testMatch: [
        "<rootDir>/src/**/__tests__/**/*.ts",
        "<rootDir>/src/**/?(*.)+(spec|test).ts"
      ],
      transform: {
        "^.+\\.ts$": [
          "ts-jest",
          {
            tsconfig: path.resolve(__dirname, "packages/utils/tsconfig.json")
          }
        ]
      },
      moduleFileExtensions: ["ts", "js", "json"],
      collectCoverageFrom: [
        "src/**/*.ts",
        "!src/**/*.d.ts",
        "!src/**/*.spec.ts",
        "!src/**/*.test.ts"
      ],
      coverageDirectory: path.resolve(__dirname, "coverage/utils"),
      moduleDirectories: ["node_modules", path.resolve(__dirname, "packages")]
    },
    // Core-client package uses Vitest, not Jest - excluded from Jest config
    // Types package configuration
    {
      displayName: "types",
      testEnvironment: "node",
      rootDir: path.resolve(__dirname, "packages/types"),
      testMatch: [
        "<rootDir>/src/**/__tests__/**/*.ts",
        "<rootDir>/src/**/?(*.)+(spec|test).ts"
      ],
      transform: {
        "^.+\\.ts$": [
          "ts-jest",
          {
            tsconfig: path.resolve(__dirname, "packages/types/tsconfig.json")
          }
        ]
      },
      moduleFileExtensions: ["ts", "js", "json"],
      collectCoverageFrom: [
        "src/**/*.ts",
        "!src/**/*.d.ts",
        "!src/**/*.spec.ts",
        "!src/**/*.test.ts",
        "!src/test-factories/**"
      ],
      coverageDirectory: path.resolve(__dirname, "coverage/types"),
      moduleDirectories: ["node_modules", path.resolve(__dirname, "packages")]
    }
  ],
  // Global coverage settings
  collectCoverage: true,
  coverageDirectory: path.resolve(__dirname, "coverage"),
  coverageReporters: ["text", "lcov", "html", "json-summary"]
  // coverageThreshold: {
  //   global: {
  //     branches: 20,
  //     functions: 30,
  //     lines: 40,
  //     statements: 40
  //   }
  // }
};

module.exports = config;
