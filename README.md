# Repose — AI Pose-Transfer Web App

Upload a photo, describe (or show) the pose you want, and get back the same
person — same face, skin tone, outfit, and background — in the new pose.

## What's in this folder

| File | Purpose |
|---|---|
| `index.html` | Full frontend: upload, prompt, optional reference-pose image, generate button, before/after slider, download. Self-contained, no build step. |
| `server.js` | Express backend that validates uploads and calls the AI image provider server-side, so the API key never reaches the browser. |
| `package.json` | Backend dependencies. |
| `.env.example` | Template for the environment variables the backend needs. |

## How the pieces fit together

```
Browser (index.html)
   │  POST /api/generate-pose  (multipart: image, prompt, reference_pose, strength)
   ▼
Backend (server.js)
   │  validates file type/size, prompt length, rate limit
   │  calls AI provider with your server-side API key
   ▼
AI image provider (Replicate / fal.ai / Stability / your own model)
   │  returns generated image URL
   ▼
Backend → Browser: { imageUrl }
```

The frontend never talks to the AI provider directly and never sees an API
key — this is what "secure backend integration" means in practice for an
app like this. Anything client-side (a key embedded in `index.html`) can be
extracted from the page source in seconds, so all provider calls must go
through your own server.

## Choosing an AI model

`server.js` is wired to [Replicate](https://replicate.com) as a working
example, but the actual pose-transfer model is up to you — search for a
model explicitly designed to preserve identity, such as:

- An **IP-Adapter + ControlNet (OpenPose)** pipeline — IP-Adapter locks the
  face/identity, OpenPose ControlNet drives the target pose.
- A dedicated **pose-transfer** or **virtual try-on** model built for
  exactly this task.

Once you've picked one, set `POSE_MODEL_ID` in `.env` and adjust the
`input` object in `callPoseModel()` in `server.js` to match that model's
expected parameters (names vary by provider).

## Running it locally

```bash
npm install
cp .env.example .env
# edit .env with your real API token and model id
npm start
```

Then open `index.html` in a browser (or serve it statically) — it calls
`/api/generate-pose` on the same origin as the backend.

## Security measures already in place

- **API key isolation** — the provider key lives only in `.env` on the
  server; it's read via `process.env` and never sent to the client.
- **File validation** — uploads are restricted to JPG/PNG/WEBP, capped at
  10MB, and held in memory only (never written to disk).
- **Input limits** — prompt length and pose-strength range are checked
  before any paid API call is made.
- **Rate limiting** — `express-rate-limit` caps generation requests per IP
  to protect against abuse and runaway provider costs.
- **CORS lockdown** — `ALLOWED_ORIGIN` restricts which frontend domains may
  call the API in production.
- **`helmet`** — sets sensible default security headers.

## Before going to production

- Put the backend behind HTTPS (e.g. via your host or a reverse proxy).
- Add authentication if this won't be a fully public tool (even a simple
  API key or session check per user).
- Consider a virus/content-safety scan on uploads if the app will be
  open to the public.
- Log generation failures/costs somewhere you can monitor.
