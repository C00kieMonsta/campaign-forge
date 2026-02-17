const path = require("path");

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
              jsx: "react-jsx"
            }
          }
        ]
      },
      transformIgnorePatterns: ["node_modules/(?!(react-resizable-panels)/)"],
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
