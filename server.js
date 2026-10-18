
const express = require("express");
const UPSTREAM_TIMEOUT_MS = 2000;

const app = express();
const PORT = 3000;
const UPSTREAM = "https://httpbin.org";

app.use("/proxy", async (req, res) => {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "GET requests only for now" });
    }

    const start = Date.now();
    try {
        const path = req.originalUrl.slice("/proxy".length) || "/";
        const upstreamBase = process.env.FAULTLINE_UPSTREAM || UPSTREAM;
        const upstreamUrl = new URL(path, upstreamBase);

        const delay = Number(
            upstreamUrl.searchParams.get("faultDelayMs") || 0
        );

        const faultStatus = Number(
            upstreamUrl.searchParams.get("faultStatus") || 0
        );

        upstreamUrl.searchParams.delete("faultDelayMs");
        upstreamUrl.searchParams.delete("faultStatus");

        if (!Number.isFinite(delay) || delay < 0 || delay > 5000) {
            return res.status(400).json({
                error: "faultDelayMs must be between 0 and 5000"
            });
        }

        if (
            faultStatus !== 0 &&
            (!Number.isInteger(faultStatus) ||
                faultStatus < 400 ||
                faultStatus > 599)
        ) {
            return res.status(400).json({
                error: "faultStatus must be an HTTP error status between 400 and 599"
            });
        }

        if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        if (faultStatus !== 0) {
            return res.status(faultStatus).json({
                error: "Fault injected by Faultline",
                injectedStatus: faultStatus
            });
        }

        const controller = new AbortController();

        const timeout = setTimeout(() => {
            controller.abort();
        }, UPSTREAM_TIMEOUT_MS);

        let upstream;
        let body;

        try {
            upstream = await fetch(upstreamUrl, {
                signal: controller.signal
            });

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
            injectedDelayMs: delay,
            totalMs: Date.now() - start
        });

        res.send(body);
    } catch (error) {
        console.error(error);
        res.status(502).json({ error: "Upstream request failed" });
    }
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Faultline running at http://localhost:${PORT}`);
    });
}

module.exports = app;
