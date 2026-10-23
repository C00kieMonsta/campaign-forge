const { spawnSync } = require("node:child_process");
const path = require("node:path");

const levels = { low: 0, moderate: 1, high: 2, critical: 3 };

function backendAdvisories(report) {
  if (
    report.error ||
    !report.metadata ||
    !Number.isInteger(report.metadata.dependencies) ||
    !report.advisories ||
    typeof report.advisories !== "object" ||
    Array.isArray(report.advisories)
  ) {
    throw new Error("The registry did not return a valid pnpm audit report");
  }
  const matches = new Map();
  for (const advisory of Object.values(report.advisories)) {
    if (!Array.isArray(advisory.findings) || !(advisory.severity in levels)) {
      throw new Error("The registry returned an invalid advisory");
    }
    const paths = advisory.findings.flatMap((finding) => finding.paths);
    if (!paths.every((entry) => typeof entry === "string")) {
      throw new Error("The registry returned invalid dependency paths");
    }
    const backendPaths = paths.filter((entry) => entry.startsWith("apps__backend>"));
    if (backendPaths.length && levels[advisory.severity] >= levels.moderate) {
      matches.set(advisory.url, { ...advisory, paths: backendPaths });
    }
  }
  return [...matches.values()];
}

function main() {
  // pnpm 10 cannot filter audit by workspace. Scope its production dependency paths here.
  const result = spawnSync("pnpm", ["audit", "--prod", "--json"], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error || result.signal || ![0, 1].includes(result.status)) {
    throw new Error(`pnpm audit failed: ${result.error?.message || result.stderr || result.status}`);
  }
  const matches = backendAdvisories(JSON.parse(result.stdout));
  for (const advisory of matches) {
    console.error(`${advisory.severity}: ${advisory.module_name}: ${advisory.title}`);
    console.error(`  ${advisory.url}\n  ${advisory.paths[0]}`);
  }
  if (matches.length) {
    console.error(`${matches.length} backend production advisories at moderate severity or above`);
    process.exitCode = 1;
  } else {
    console.log("No backend production advisories at moderate severity or above");
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { backendAdvisories };
