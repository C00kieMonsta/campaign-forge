const assert = require("node:assert/strict");
const { test } = require("node:test");
const { backendAdvisories } = require("../audit-backend.cjs");

function advisory(
  path,
  severity = "high",
  url = "https://example.test/advisory"
) {
  return { severity, url, findings: [{ paths: [path] }] };
}

function report(advisories = {}) {
  return { metadata: { dependencies: 10 }, advisories };
}

test("blocks vulnerable backend transitive dependencies", () => {
  const result = backendAdvisories(
    report({
      a: advisory("apps__backend>@packages/types>zod", "moderate")
    })
  );
  assert.equal(result.length, 1);
});

test("excludes other workspaces and low severity findings", () => {
  const result = backendAdvisories(
    report({
      a: advisory("apps__frontend>react-router", "critical"),
      b: advisory("infrastructure>aws-cdk-lib"),
      c: advisory("apps__backend>dependency", "low")
    })
  );
  assert.deepEqual(result, []);
});

test("deduplicates advisories reported for several package versions", () => {
  const result = backendAdvisories(
    report({
      a: advisory("apps__backend>one>dependency"),
      b: advisory("apps__backend>two>dependency")
    })
  );
  assert.equal(result.length, 1);
});

test("fails closed when the registry fails or the report format changes", () => {
  for (const invalid of [
    {},
    { error: { message: "unavailable" }, ...report() },
    { metadata: { dependencies: 10 } },
    report({ a: { severity: "high" } }),
    report({ a: advisory("apps__backend>dependency", "unknown") }),
    report({ a: advisory("apps__backend>dependency", "toString") }),
    report({ a: { severity: "high", findings: [], url: "test" } }),
    { metadata: { dependencies: 0 }, advisories: {} }
  ]) {
    assert.throws(() => backendAdvisories(invalid));
  }
});
