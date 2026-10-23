const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

function install(current, available = "24.22.1") {
  const folder = fs.mkdtempSync(
    path.join(os.tmpdir(), "campaign-forge-runtime-")
  );
  const stateFile = path.join(folder, "state.json");
  fs.writeFileSync(
    stateFile,
    JSON.stringify({ current, available, clean: false, calls: [] })
  );
  const stub = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const stateFile = process.env.CAMPAIGN_FORGE_RUNTIME_TEST_STATE;
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
if (command === 'node') {
  if (args[0] === '-e') {
    const source = 'Object.defineProperty(process.versions, "node", {value:' + JSON.stringify(state.current) + '});' + args[1];
    const result = spawnSync(${JSON.stringify(process.execPath)}, ['-e', source], {encoding:'utf8'});
    process.stdout.write(result.stdout); process.stderr.write(result.stderr);
    process.exit(result.status);
  }
  console.log('v' + state.current);
} else if (command === 'curl') {
  fs.writeFileSync(args[args.indexOf('-o') + 1], '#!/usr/bin/env bash\\nexit 0\\n');
} else if (command === 'dnf') {
  state.calls.push(args);
  if (args.includes('clean') && args.includes('metadata')) state.clean = true;
  // Reproduce the production failure: unversioned installs keep the old runtime.
  if (args.includes('install') && args.includes('nodejs-24.*') && args.includes('--refresh') && state.clean) {
    state.current = state.available;
  }
  fs.writeFileSync(stateFile, JSON.stringify(state));
}
`;
  for (const command of ["node", "curl", "dnf"]) {
    fs.writeFileSync(path.join(folder, command), stub, { mode: 0o755 });
  }
  try {
    const result = spawnSync(
      "bash",
      [path.resolve(__dirname, "../install-node-runtime.sh")],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${folder}:${process.env.PATH}`,
          CAMPAIGN_FORGE_RUNTIME_TEST_STATE: stateFile
        }
      }
    );
    return { ...result, state: JSON.parse(fs.readFileSync(stateFile, "utf8")) };
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

test("replaces Node 20 despite stale metadata after switching repositories", () => {
  const result = install("20.20.0");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.state.current, "24.22.1");
});

test("leaves a patched Node 24 installation in place", () => {
  const result = install("24.22.2");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.state.calls, []);
});

test("refuses a repository candidate older than the security patch", () => {
  const result = install("20.20.0", "24.22.0");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /24\.22\.1/);
});
