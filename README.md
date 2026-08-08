# Spatial memory atlas

Places captured as photorealistic 3D Gaussian Splats, walkable in the browser,
with voice memories pinned to specific coordinates inside them. Walk toward a
memory and it gets louder; walk past it and it moves to the other ear.

Each place is its own independent splat scene. Hotspot markers link them —
clicking one swaps the loaded scene and drops you at that place's entry point.

## Setup

```bash
npm install
cp .env.local.example .env.local   # then fill it in
npm run dev
```

`.env.local` needs:

- `NEXT_PUBLIC_FIREBASE_*` — from the Firebase console (Project settings → Your
  apps → Web app config). Enable **Firestore** and **Storage**.
- `KIRI_API_KEY` — from the KIRI Engine developer dashboard. Server-side only;
  never prefix it with `NEXT_PUBLIC_`.

Without Firebase keys the atlas says so explicitly instead of hanging.

## Routes

| Route             | What it does                                              |
| ----------------- | --------------------------------------------------------- |
| `/`               | Live atlas grid of all places (Firestore `onSnapshot`)    |
| `/place/[id]`     | Walk a place, hear its voices, leave one, link to others  |
| `/capture`        | Upload a walkthrough video → KIRI → render the splat      |
| `/dev`            | Two linked sample scenes; no Firebase or KIRI needed      |

`/dev` is the fastest way to see the whole interaction loop working.

## Capture pipeline

One walkthrough video per place, reconstructed by KIRI Engine:

1. `POST /api/capture/submit` → KIRI `/3dgs/video`, returns a `serialize` job id
2. `GET /api/capture/status` polls KIRI until status `2` (successful)
3. `GET /api/capture/model` downloads the result zip, extracts the `.ply`
4. The browser renders that PLY immediately — Spark reads it from an object URL
5. Optionally, it uploads to Firebase Storage and writes the place doc

Reconstruction takes roughly 30–90 minutes, so seed places ahead of a demo
rather than generating one live. KIRI's limits: video ≤ 3 minutes, ≤ 1920×1080.
Both are checked client-side before upload so a bad file never costs credits.

`/capture` survives that wait: the job id is stored in `localStorage`, so
closing the tab and coming back later resumes polling the same job. Steps 3–5
need no Firebase — without it the splat still renders and can be downloaded.

`scripts/kiri_3dgs.py` drives the same three endpoints from the command line
(`--video` to start, `--serialize` to resume). Paste the task id it prints into
`/capture` to render that job's splat in the app.

## Data model

```
places/{placeId}
  name, uploaderId, createdAt, splatUrl, thumbnailUrl
  hotspots?: [{ x, y, z, linksToPlaceId }]
  entryPoint?: { position: {x,y,z}, target: {x,y,z} }

places/{placeId}/audioPins/{pinId}
  x, y, z, audioUrl, duration, createdAt, caption?
```

## Implementation notes

Things that are non-obvious and cost time to rediscover:

- **Pin placement raycasts an infinite floor plane**, not the splat and not a
  finite proxy mesh. Rays hit stray floating splat particles, and a
  sized-to-the-room proxy is missed entirely at shallow viewing angles, which
  drops pins into empty space. Hits are clamped to the scene's bounding box.
- **The camera auto-frames to the splat's bounding box** on load. Captures come
  back at arbitrary scale and centering, and audio falloff plus marker sizes are
  derived from that radius so room- and object-scale scans both behave.
- **`AudioContext` starts suspended** until a user gesture — that is what the
  "Enter" button is for. Without it spatial audio silently never plays.
- **`MediaRecorder` container support differs per browser.** Chrome takes
  `audio/webm;codecs=opus`, iOS Safari needs `audio/mp4`; the recorder probes
  rather than hardcoding.
- **Spark detects the splat format from the file's magic bytes**, not the URL,
  so a `blob:` object URL with no `.ply` extension loads fine. That is what lets
  a freshly downloaded capture render without a round trip through Storage.
- **`/api/capture/submit` buffers the whole video** — `req.formData()` in, a
  fresh multipart body out to KIRI. Fine for a ≤ 3 minute clip; it would need to
  stream if the limit ever rises.
- **React StrictMode is off.** Its double-mount created two WebGL contexts and
  downloaded every splat twice.
- Splats load with `quaternion.set(1, 0, 0, 0)` because captures arrive Y-down
  relative to three.js.

## Stack

Next.js · TypeScript · Spark (`@sparkjsdev/spark`) for WebGL2 splat rendering ·
three.js · Web Audio `PannerNode` · Firebase Firestore + Storage · KIRI Engine
