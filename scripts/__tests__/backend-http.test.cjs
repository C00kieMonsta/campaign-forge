const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { mkdtemp, rm } = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");

let child;
let temporaryDirectory;
let base;
let output = "";

before(async () => {
  const reservation = net.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  base = `http://127.0.0.1:${port}`;
  temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "campaign-forge-http-")
  );
  // An empty working directory prevents dotenv from loading development or production secrets.
  child = spawn(
    process.execPath,
    [path.resolve(__dirname, "../../apps/backend/dist/main.js")],
    {
      cwd: temporaryDirectory,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        PORT: String(port),
        AWS_REGION: "eu-north-1",
        AWS_ACCESS_KEY_ID: "test",
        AWS_SECRET_ACCESS_KEY: "test",
        AWS_EC2_METADATA_DISABLED: "true",
        CONTACTS_TABLE: "test-contacts",
        CAMPAIGNS_TABLE: "test-campaigns",
        GROUPS_TABLE: "test-groups",
        S3_BUCKET: "test-attachments",
        SES_FROM_EMAIL: "test@example.com",
        UNSUBSCRIBE_SECRET: "u".repeat(32),
        JWT_SECRET: "j".repeat(32),
        ADMIN_CREDENTIALS: JSON.stringify([
          { email: "admin@example.com", hash: "test" }
        ]),
        PUBLIC_BASE_URL: "https://example.com/api"
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Backend did not start: ${output}`)),
      20_000
    );
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Backend exited ${code}: ${output}`));
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => {
        output = (output + chunk).slice(-16_000);
        if (output.includes('"event":"server:started"')) {
          clearTimeout(timeout);
          resolve();
        }
      });
    }
  });
});

after(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }
  if (temporaryDirectory)
    await rm(temporaryDirectory, { recursive: true, force: true });
});

test("the compiled backend starts and serves health outside the API prefix", async () => {
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
  assert.equal((await fetch(`${base}/api/health`)).status, 404);
});

test("admin authentication runs before multipart upload parsing", async () => {
  assert.equal((await fetch(`${base}/api/admin/contacts`)).status, 401);
  const response = await fetch(`${base}/api/admin/contacts/assistant/extract`, {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=missing" },
    body: "invalid multipart body"
  });
  assert.equal(response.status, 401);
});

test("invalid login input returns 400 with the expected CORS headers", async () => {
  const origin = "https://admin.moniquepirson.be";
  const response = await fetch(`${base}/api/admin/auth/login`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "invalid", password: "" })
  });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
});

test("malformed JSON remains a 400 response with CORS headers", async () => {
  const origin = "https://admin.moniquepirson.be";
  const response = await fetch(`${base}/api/admin/auth/login`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: "{"
  });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
});
