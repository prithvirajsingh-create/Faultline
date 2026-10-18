const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("./server");

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