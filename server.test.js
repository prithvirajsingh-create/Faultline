const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("./server");
const http = require("node:http");


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