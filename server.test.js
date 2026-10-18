const test = require("node:test");
const assert = require("node:assert/strict");
const { app, scenarios } = require("./server");
const http = require("node:http");

const { spawnSync } = require("node:child_process");

async function startServer(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  return `http://127.0.0.1:${server.address().port}`;
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

async function withLocalUpstream(handler, run) {
  const upstream = http.createServer(handler);
  const upstreamUrl = await startServer(upstream);
  const previous = process.env.FAULTLINE_UPSTREAM;

  process.env.FAULTLINE_UPSTREAM = upstreamUrl;

  const server = http.createServer(app);

  try {
    const appUrl = await startServer(server);
    await run(appUrl);
  } finally {
    if (previous === undefined) {
      delete process.env.FAULTLINE_UPSTREAM;
    } else {
      process.env.FAULTLINE_UPSTREAM = previous;
    }

    await closeServer(server);
    await closeServer(upstream);
  }
}

test("invalid delay returns 400", async () => {
  const server = app.listen(0);

  try {
    const address = server.address();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/proxy/get?faultDelayMs=6000`
    );

    assert.equal(response.status, 400);
    assert.match(await response.text(), /faultDelayMs/);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});

test("invalid fault status returns 400", async () => {
  const server = app.listen(0);

  try {
    const address = server.address();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/proxy/get?faultStatus=200`
    );

    assert.equal(response.status, 400);
    assert.match(await response.text(), /faultStatus/);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});

test("fault injection returns the requested HTTP error", async () => {
  const server = app.listen(0);

  try {
    const address = server.address();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/proxy/get?faultStatus=503`
    );

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Fault injected by Faultline",
      injectedStatus: 503
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});

test("forwards requests and strips Faultline parameters", async () => {
  await withLocalUpstream((req, res) => {
    const url = new URL(req.url, "http://upstream.test");

    res.writeHead(201, {
      "content-type": "application/json"
    });

    res.end(JSON.stringify({
      path: url.pathname,
      args: Object.fromEntries(url.searchParams)
    }));
  }, async appUrl => {
    const response = await fetch(
      `${appUrl}/proxy/get?foo=bar&faultDelayMs=0`
    );

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      path: "/get",
      args: { foo: "bar" }
    });
  });
});

test("injects the requested delay", async () => {
  await withLocalUpstream((req, res) => {
    res.end("ok");
  }, async appUrl => {
    const start = Date.now();

    const response = await fetch(
      `${appUrl}/proxy/get?faultDelayMs=200`
    );

    const elapsed = Date.now() - start;

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
    assert.ok(
      elapsed >= 180,
      `Expected at least 180ms, received ${elapsed}ms`
    );
  });
});

test("upstream timeout returns 504", async () => {
  await withLocalUpstream(() => {}, async appUrl => {
    const startedAt = Date.now();

    const response = await fetch(`${appUrl}/proxy/get`);
    const body = await response.json();

    const elapsed = Date.now() - startedAt;

    assert.equal(response.status, 504);
    assert.deepEqual(body, {
      error: "Upstream request timed out"
    });
    assert.ok(elapsed >= 1800);
  });
});

test("a timed-out request does not block another request", async () => {
  await withLocalUpstream((req, res) => {
    if (req.url === "/hang") {
      return;
    }

    res.writeHead(200, {
      "content-type": "text/plain"
    });
    res.end("fast response");
  }, async appUrl => {
    const slowRequest = fetch(`${appUrl}/proxy/hang`);

    const fastStartedAt = Date.now();
    const fastResponse = await fetch(`${appUrl}/proxy/fast`);
    const fastBody = await fastResponse.text();
    const fastElapsed = Date.now() - fastStartedAt;

    assert.equal(fastResponse.status, 200);
    assert.equal(fastBody, "fast response");
    assert.ok(
      fastElapsed < 1000,
      `Fast request took ${fastElapsed}ms`
    );

    const slowResponse = await slowRequest;
    const slowBody = await slowResponse.json();

    assert.equal(slowResponse.status, 504);
    assert.deepEqual(slowBody, {
      error: "Upstream request timed out"
    });
  });
});

test("accepts valid timeout configuration", () => {
  for (const timeout of ["500", "2000", "30000"]) {
    const result = spawnSync(
      process.execPath,
      ["-e", "require('./server')"],
      {
        cwd: __dirname,
        encoding: "utf8",
        env: {
          ...process.env,
          FAULTLINE_TIMEOUT_MS: timeout
        }
      }
    );

    assert.equal(
      result.status,
      0,
      `Timeout ${timeout} should be valid: ${result.stderr}`
    );
  }
});

test("rejects timeout values outside the allowed range", () => {
  for (const timeout of ["99", "30001"]) {
    const result = spawnSync(
      process.execPath,
      ["-e", "require('./server')"],
      {
        cwd: __dirname,
        encoding: "utf8",
        env: {
          ...process.env,
          FAULTLINE_TIMEOUT_MS: timeout
        }
      }
    );

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /FAULTLINE_TIMEOUT_MS must be an integer/
    );
  }
});

test("rejects non-integer timeout configuration", () => {
  for (const timeout of ["abc", "500.5"]) {
    const result = spawnSync(
      process.execPath,
      ["-e", "require('./server')"],
      {
        cwd: __dirname,
        encoding: "utf8",
        env: {
          ...process.env,
          FAULTLINE_TIMEOUT_MS: timeout
        }
      }
    );

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /FAULTLINE_TIMEOUT_MS must be an integer/
    );
  }
});

test("rejects an invalid fault rate", async () => {
  const invalidRates = ["-0.1", "1.1", "abc"];

  for (const rate of invalidRates) {
    await withLocalUpstream(
      (req, res) => res.end("upstream reached"),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/proxy/get?faultRate=${rate}`
        );

        assert.equal(response.status, 400);
      }
    );
  }
});

test("faultRate=0 never injects a random failure", async () => {
  await withLocalUpstream(
    (req, res) => res.end("upstream reached"),
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/proxy/get?faultRate=0`
      );

      assert.equal(response.status, 200);
      assert.equal(await response.text(), "upstream reached");
    }
  );
});

test("faultRate=1 always injects a failure", async () => {
  await withLocalUpstream(
    (req, res) => res.end("upstream reached"),
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/proxy/get?faultRate=1`
      );

      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        error: "Fault injected by Faultline",
        injectedStatus: 503
      });
    }
  );
});

test("creates and retrieves a scenario", async () => {
  const server = http.createServer(app);
  const baseUrl = await startServer(server);
  const name = `test-${Date.now()}`;

  try {
    const created = await fetch(`${baseUrl}/scenarios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        faultDelayMs: 300,
        faultRate: 0.1,
        faultStatus: 0
      })
    });

    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), {
      name,
      faultDelayMs: 300,
      faultRate: 0.1,
      faultStatus: 0
    });

    const retrieved = await fetch(`${baseUrl}/scenarios/${name}`);

    assert.equal(retrieved.status, 200);
    assert.equal((await retrieved.json()).name, name);
  } finally {
    scenarios.delete(name);
    await closeServer(server);
  }
});

test("rejects invalid scenario configurations", async () => {
  const server = http.createServer(app);
  const baseUrl = await startServer(server);

  try {
    const response = await fetch(`${baseUrl}/scenarios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "invalid-scenario",
        faultRate: 2
      })
    });

    assert.equal(response.status, 400);
  } finally {
    await closeServer(server);
  }
});

test("rejects duplicate scenario names", async () => {
  const server = http.createServer(app);
  const baseUrl = await startServer(server);
  const name = `duplicate-${Date.now()}`;

  try {
    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, faultRate: 0 })
    };

    assert.equal(
      (await fetch(`${baseUrl}/scenarios`, options)).status,
      201
    );

    assert.equal(
      (await fetch(`${baseUrl}/scenarios`, options)).status,
      409
    );
  } finally {
    scenarios.delete(name);
    await closeServer(server);
  }
});


test("applies a saved scenario to proxy requests", async () => {
  const name = `scenario-delay-${Date.now()}`;

  await withLocalUpstream(
    (req, res) => res.end("upstream reached"),
    async (baseUrl) => {
      const created = await fetch(`${baseUrl}/scenarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          faultDelayMs: 300,
          faultRate: 0,
          faultStatus: 0
        })
      });

      assert.equal(created.status, 201);

      const start = Date.now();
      const response = await fetch(
        `${baseUrl}/proxy/get?scenario=${name}`
      );
      const elapsed = Date.now() - start;

      assert.equal(response.status, 200);
      assert.equal(await response.text(), "upstream reached");
      assert.ok(elapsed >= 250, `Expected delay, got ${elapsed}ms`);
    }
  );
});