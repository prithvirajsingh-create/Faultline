# Faultline Frontend

React + Vite dashboard for the existing Faultline Express server.

## Start

From the Faultline repository root:

```bash
node server.js
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the URL printed by Vite (usually http://localhost:5173).

## Backend API

The frontend expects:

- `GET /scenarios`
- `POST /scenarios`
- `GET /scenarios/:name`
- `PUT /scenarios/:name`
- `DELETE /scenarios/:name`
- `GET /proxy/*` (with optional `scenario` query parameter)

Vite proxies `/scenarios` and `/proxy` to `http://localhost:3000` during development, avoiding CORS setup.

To use another API origin, set `VITE_API_URL` (for example in `.env.local`). If you use a different origin, the Express backend must allow CORS from the frontend origin.

The request history and overview request metrics are local to the current browser session and reset on refresh. They do not represent backend-wide metrics.

Scenarios are stored by the backend in memory and reset when it restarts.
