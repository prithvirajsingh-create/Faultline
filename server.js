
const express = require("express");

const app = express();
const PORT = 3000;
const UPSTREAM = "https://httpbin.org";

const UPSTREAM_TIMEOUT_MS = Number(
  process.env.FAULTLINE_TIMEOUT_MS ?? 2000
);

if (
  !Number.isInteger(UPSTREAM_TIMEOUT_MS) ||
  UPSTREAM_TIMEOUT_MS < 100 ||
  UPSTREAM_TIMEOUT_MS > 30000
) {
  throw new Error(
    "FAULTLINE_TIMEOUT_MS must be an integer between 100 and 30000"
  );
}

const scenarios = new Map();

app.use(express.json());

function validateScenario(config) {
  const { faultDelayMs, faultRate, faultStatus } = config;

  return (
    Number.isInteger(faultDelayMs) &&
    faultDelayMs >= 0 &&
    faultDelayMs <= 5000 &&
    Number.isFinite(faultRate) &&
    faultRate >= 0 &&
    faultRate <= 1 &&
    (
      faultStatus === 0 ||
      (
        Number.isInteger(faultStatus) &&
        faultStatus >= 400 &&
        faultStatus <= 599
      )
    )
  );
}

app.post("/scenarios", (req, res) => {
  const { name, ...config } = req.body ?? {};

  if (
    typeof name !== "string" ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(name)
  ) {
    return res.status(400).json({
      error:
        "Scenario name must be 1-64 characters: letters, numbers, _ or -"
    });
  }

  const normalizedConfig = {
    faultDelayMs: config.faultDelayMs ?? 0,
    faultRate: config.faultRate ?? 0,
    faultStatus: config.faultStatus ?? 0
  };

  if (!validateScenario(normalizedConfig)) {
    return res.status(400).json({
      error: "Invalid scenario configuration"
    });
  }

  if (scenarios.has(name)) {
    return res.status(409).json({
      error: "Scenario already exists"
    });
  }

  const scenario = {
    name,
    ...normalizedConfig
  };

  scenarios.set(name, scenario);

  return res.status(201).json(scenario);
});

app.get("/scenarios", (req, res) => {
  return res.json([...scenarios.values()]);
});

app.get("/scenarios/:name", (req, res) => {
  const scenario = scenarios.get(req.params.name);

  if (!scenario) {
    return res.status(404).json({
      error: "Scenario not found"
    });
  }

  return res.json(scenario);
});

app.use("/proxy", async (req, res) => {
  const start = Date.now();

  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        error: "Method not allowed"
      });
    }

    const path = req.originalUrl.slice("/proxy".length) || "/";
    const upstreamBase =
      process.env.FAULTLINE_UPSTREAM || UPSTREAM;

    const upstreamUrl = new URL(path, upstreamBase);

    const scenarioName = req.query.scenario;
    const scenario = scenarioName
      ? scenarios.get(scenarioName)
      : null;

    if (scenarioName && !scenario) {
      return res.status(404).json({
        error: "Scenario not found"
      });
    }

    const faultDelayMs = scenario
      ? scenario.faultDelayMs
      : Number(req.query.faultDelayMs ?? 0);

    const faultStatus = scenario
      ? scenario.faultStatus
      : Number(req.query.faultStatus ?? 0);

    const faultRate = scenario
      ? scenario.faultRate
      : Number(req.query.faultRate ?? 0);

    
if (
  !Number.isInteger(faultDelayMs) ||
  faultDelayMs < 0 ||
  faultDelayMs > 5000
) {
  return res.status(400).json({
    error: "faultDelayMs must be an integer between 0 and 5000"
  });
}

if (
  !Number.isFinite(faultRate) ||
  faultRate < 0 ||
  faultRate > 1
) {
  return res.status(400).json({
    error: "faultRate must be a number between 0 and 1"
  });
}

if (
  faultStatus !== 0 &&
  (
    !Number.isInteger(faultStatus) ||
    faultStatus < 400 ||
    faultStatus > 599
  )
) {
  return res.status(400).json({
    error: "faultStatus must be 0 or an integer between 400 and 599"
  });
}


    upstreamUrl.searchParams.delete("faultDelayMs");
    upstreamUrl.searchParams.delete("faultStatus");
    upstreamUrl.searchParams.delete("faultRate");
    upstreamUrl.searchParams.delete("scenario");

    if (faultDelayMs > 0) {
      await new Promise(resolve =>
        setTimeout(resolve, faultDelayMs)
      );
    }

    if (faultStatus !== 0) {
      return res.status(faultStatus).json({
        error: "Fault injected by Faultline",
        injectedStatus: faultStatus
      });
    }

    if (Math.random() < faultRate) {
      return res.status(503).json({
        error: "Fault injected by Faultline",
        injectedStatus: 503
      });
    }

    const controller = new AbortController();
    console.log("Upstream URL:", upstreamUrl.href);
console.log("Timeout configured:", UPSTREAM_TIMEOUT_MS);
console.log("Starting upstream fetch:", Date.now());

    const timeout = setTimeout(() => {
      controller.abort();
    }, UPSTREAM_TIMEOUT_MS);

    let upstream;
    let body;

    try {
      upstream = await fetch(upstreamUrl, {
        signal: controller.signal
      });
      console.log("Upstream headers received:", upstream.status, Date.now());

      body = await upstream.text();
    } catch (error) {
      if (error.name === "AbortError") {
        return res.status(504).json({
          error: "Upstream request timed out"
        });
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }

    res.status(upstream.status);

    const contentType = upstream.headers.get("content-type");

    if (contentType) {
      res.set("content-type", contentType);
    }

    console.log({
      path: upstreamUrl.pathname,
      status: upstream.status,
      injectedDelayMs: faultDelayMs,
      totalMs: Date.now() - start
    });

    return res.send(body);
  } catch (error) {
    console.error("Faultline proxy error:", error);

    if (!res.headersSent) {
      return res.status(502).json({
        error: "Upstream request failed"
      });
    }
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Faultline running at http://localhost:${PORT}`);
  });
}

module.exports = { app, scenarios };
