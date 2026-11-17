import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDemoGateway } from "./demo-gateway.mjs";

test("demo boundary gates API and assets, checks origin, hides source, and preserves CSRF", async () => {
  const dir = await mkdtemp(join(tmpdir(), "muse-gateway-"));
  await writeFile(join(dir, "index.html"), "BUILT APP");
  await writeFile(join(dir, "asset.js"), "BUILT SCRIPT");
  await writeFile(join(dir, ".env"), "SECRET");
  await symlink(join(dir, ".."), join(dir, "outside")).catch((error) => {
    if (error.code !== "EPERM") throw error;
  });
  let hits = 0,
    received;
  const upstream = createServer((req, res) => {
    hits++;
    received = req.headers;
    res.setHeader(
      "Set-Cookie",
      "muse_session=example; Path=/; HttpOnly; SameSite=Lax",
    );
    res.end("API RESPONSE");
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  let origin = "https://demo.trycloudflare.com";
  let healthy = true;
  const gateway = createDemoGateway({
    password: "test-password-only-12345",
    dist: dir,
    upstream: `http://127.0.0.1:${upstream.address().port}`,
    getOrigin: () => origin,
    health: async () => healthy,
  });
  await new Promise((r) => gateway.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${gateway.address().port}`;
  const call = (path, options = {}) =>
    new Promise((done, reject) => {
      const req = request(
        base + path,
        {
          method: options.method,
          headers: { host: "demo.trycloudflare.com", ...options.headers },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () =>
            done({
              status: res.statusCode,
              headers: {
                get: (key) =>
                  Array.isArray(res.headers[key])
                    ? res.headers[key].join(", ")
                    : res.headers[key],
              },
              text: async () => body,
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(options.body);
    });
  try {
    assert.match(await (await call("/")).text(), /演示口令/);
    assert.equal((await call("/api/v1/me")).status, 401);
    assert.equal(hits, 0);
    assert.equal((await call("/healthz")).status, 200);
    healthy = false;
    assert.equal((await call("/healthz")).status, 503);
    assert.equal(
      (await call("/", { headers: { host: "attacker.test" } })).status,
      403,
    );
    assert.equal(
      (
        await call("/__demo/login", {
          method: "POST",
          body: "password=test-password-only-12345",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("/__demo/login", {
          method: "POST",
          headers: { origin },
          body: "password=wrong",
        })
      ).status,
      401,
    );
    const login = await call("/__demo/login", {
      method: "POST",
      headers: { origin },
      body: "password=test-password-only-12345",
    });
    assert.equal(login.status, 303);
    const setCookie = login.headers.get("set-cookie");
    assert.match(setCookie, /HttpOnly; Secure; SameSite=Lax/);
    const cookie = setCookie.split(";")[0];
    const headers = { cookie };
    assert.equal(await (await call("/", { headers })).text(), "BUILT APP");
    assert.equal(
      await (await call("/asset.js", { headers })).text(),
      "BUILT SCRIPT",
    );
    assert.equal((await call("/.env", { headers })).status, 404);
    assert.equal((await call("/%2eenv", { headers })).status, 404);
    assert.equal((await call("/outside/.env", { headers })).status, 404);
    assert.equal(
      (await call("/api/v1/me", { headers: { cookie: cookie + "tampered" } }))
        .status,
      401,
    );
    assert.equal(
      (
        await call("/api/v1/drafts", {
          method: "PATCH",
          headers: { ...headers, origin: "https://attacker.test" },
        })
      ).status,
      403,
    );
    const api = await call("/api/v1/drafts", {
      method: "PATCH",
      headers: {
        ...headers,
        cookie: cookie + "; muse_session=existing",
        origin,
        "x-csrf-token": "csrf",
        "x-test-user-id": "forged",
        authorization: "untrusted",
      },
      body: "{}",
    });
    assert.equal(api.status, 200);
    assert.equal(received.origin, "http://localhost:5179");
    assert.equal(received["x-csrf-token"], "csrf");
    assert.equal(received.cookie, "muse_session=existing");
    assert.equal(received["x-test-user-id"], undefined);
    assert.equal(received.authorization, undefined);
    assert.match(api.headers.get("set-cookie"), /; Secure/);
    assert.equal(
      (await call("/api/v1/tasks/example/events", { headers })).status,
      200,
    );
    assert.equal(hits, 2);
    origin = "";
    assert.equal((await call("/", { headers })).status, 503);
  } finally {
    gateway.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise((r) => gateway.close(r)),
      new Promise((r) => upstream.close(r)),
    ]);
    await rm(dir, { recursive: true, force: true });
  }
});
