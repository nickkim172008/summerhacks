# Spatial memory atlas

Places captured as photorealistic 3D Gaussian Splats, walkable in the browser.
You film one slow walkthrough of a room; what comes back is the room itself,
carrying the sound that was in the air while you filmed it. Walk in and that
audio fades up under the scene.

The video answers for the memory as well as the geometry: where it was shot and
when are read out of the file's own container, so a place lands on the map and
in the timeline without anyone typing anything.

It presents as a photo library — albums, a Recents grid, a public profile per
person, and a map of everywhere you have been. Each place is its own
independent splat scene; hotspot markers link them, and clicking one swaps the
loaded scene and drops you at that place's entry point.

## Setup

```bash
npm install
cp .env.local.example .env.local   # then fill it in
npm run dev
```

`.env.local` needs:

- `NEXT_PUBLIC_FIREBASE_*` — from the Firebase console (Project settings → Your
  apps → Web app config). Enable **Firestore**, **Storage**, and **Google
  sign-in** under Authentication.
- `KIRI_API_KEY` — from the KIRI Engine developer dashboard. Server-side only;
  never prefix it with `NEXT_PUBLIC_`.
- `NEXT_PUBLIC_DEMO_CAPTURE` — optional. `true` puts `/capture` in pitch mode:
  the walkthrough really uploads to Storage, but nothing is sent to KIRI, so
  the flow finishes in seconds instead of an hour.

Without Firebase keys the library says so explicitly instead of hanging.

## Routes

| Route               | What it does                                              |
| ------------------- | --------------------------------------------------------- |
| `/`                 | Albums and Recents (Firestore `onSnapshot`); Library tab  |
| `/album/[id]`       | One album's places. `recents` is virtual — everything     |
| `/place/[id]`       | Walk a place, hear the walkthrough, jump to linked places |
| `/map`              | Heatmap of every geotagged place; Map tab                 |
| `/capture`          | Upload a walkthrough video → KIRI → render → save         |
| `/u/[username]`     | Public profile: that person's albums and environments     |
| `/signin`, `/setup` | Google sign-in, then claim a username                     |
| `/dev`              | Two linked sample scenes; no Firebase or KIRI needed      |

Signed out, `/` shows every place so browsing still works; signed in it narrows
to yours. `/dev` is the fastest way to see the interaction loop working.

Arriving at a place from an album carries `?album=` along, so Back and every
hotspot jump stay inside that album.

## Capture pipeline

One walkthrough video per place, reconstructed by KIRI Engine. Everything only
the file can answer is read the moment it is picked, in the browser, before
anything is uploaded:

1. Duration and frame size, checked against KIRI's limits so a bad file never
   costs credits; where and when it was filmed, read out of the container; and
   the audio track, lifted off in parallel with the upload
2. The walkthrough is archived to Firebase Storage, then a copy goes to
   `POST /api/capture/submit` → KIRI `/3dgs/video`, which returns a `serialize`
   job id
3. The job id, the metadata and the archive URL go to `localStorage`; the WAV
   goes to Cache Storage under the same serialize
4. `GET /api/capture/status` polls KIRI every 20s until status `2` (successful)
5. `GET /api/capture/model` downloads the result zip server-side and extracts
   the `.ply`. The browser renders it immediately from an object URL and keeps
   the blob
6. Saving transcodes the PLY to SPZ (64.7MB → 4.9MB on a 260k-splat room),
   uploads it and the WAV, and writes one place document holding the URLs and
   everything step 1 found

Reconstruction takes roughly 30–90 minutes, so seed places ahead of a demo
rather than generating one live. KIRI's limits: video ≤ 3 minutes, ≤ 1920×1080.

`/capture` survives that wait: the job is in `localStorage`, so closing the tab
and coming back resumes the same job — which is also why the metadata and audio
have to be put aside in step 3, since by the time the splat lands the form is
long gone and no `File` survives a reload. Steps 4–5 need no Firebase; without
it the splat still renders and can be downloaded, it just cannot be saved.

`scripts/kiri_3dgs.py` drives the same three endpoints from the command line
(`--video` to start, `--serialize` to resume). Paste the task id it prints into
`/capture` to render that job's splat in the app.

## Where media lives

Every byte is in **Firebase Storage**. Firestore holds download URLs and
metadata and nothing else (documents cap at 1 MiB).

- `splats/{placeId}/{name}.spz` — walkable Gaussian splat
- `audio/{placeId}/walkthrough.wav` — the audio lifted off the video
- `videos/{uid}/{timestamp}/walkthrough.*` — the original walkthrough, filed
  under who uploaded it and when, because it is archived before there is a
  place to hang it on

Enable Storage on the Firebase project (Blaze is required for new buckets).

## Data model

```
places/{placeId}
  name, uploaderId, createdAt, splatUrl, thumbnailUrl
  audioUrl?, audioSeconds?
  capturedAt?          ISO 8601, off the video or typed in
  location?: { lat, lng }, locationName?
  videoUrl?
  hotspots?: [{ x, y, z, linksToPlaceId, label? }]
  entryPoint?: { position: {x,y,z}, target: {x,y,z} }

albums/{albumId}
  name, ownerId, placeIds, createdAt

profiles/{uid}
  username, displayName, photoURL, createdAt

usernames/{username}
  uid                  lock doc, taken in the same transaction as the profile
```

Every field on a place past `thumbnailUrl` is optional and written only when it
exists — Firestore rejects `undefined` outright, so an unknown detail is left
off the document rather than stored as a blank.

## Implementation notes

Things that are non-obvious and cost time to rediscover:

- **A current iPhone writes no `udta`.** The documented QuickTime spot for
  location and date is `udta` holding `©xyz` and `©day`; a modern phone instead
  puts a `meta` box under `moov` with a `keys` table of reverse-DNS names and an
  `ilst` of values indexed into it — `com.apple.quicktime.location.ISO6709` and
  `…creationdate`. Both layouts are read; older phones and most cameras still
  use the first.
- **`moov` sits after `mdat`,** so all the metadata in a two-gigabyte recording
  is at the very end of the file. The parser reads box headers only and hops
  from one to the next by the length each announces, so a few hundred bytes come
  over the wire instead of the whole video.
- **`mvhd`'s `creation_time` is when the file was finalised,** which is the end
  of filming — it runs late by the length of the video. It is a fallback behind
  the metadata date for that reason, and a zeroed one lands in 1904, which is
  what the plausibility window catches.
- **`decodeAudioData` reads audio straight out of an mp4/mov container**, so
  lifting the walkthrough's sound needs no transcoding service and the video
  never leaves the browser. Rendering into a one-channel `OfflineAudioContext`
  at 22050 Hz does the downmix and the resample in the same pass: 2.6 MB per
  minute as 16-bit WAV, which plays everywhere with no codec.
- **Failing to read the audio is an answer, not an error.** A video may carry no
  audio track, and some phone codecs are ones a given browser cannot open. The
  place saves silent rather than the capture being lost.
- **The audio waits in Cache Storage, not localStorage.** It is lifted 30–90
  minutes before the splat it belongs to exists; megabytes of samples cannot sit
  in localStorage beside the job, so the job carries the length and the cache
  carries the bytes, both keyed by the KIRI serialize. Splats are cached the
  same way, in a separate cache — a write keeps only the newest entry, and
  pruning one kind must not take the other half of the same job with it.
- **A media element that keeps its `src` goes on streaming after React detaches
  it,** which leaves one place audible underneath the next. Unmounting removes
  the attribute and calls `load()`.
- **A WAV served without a length answers `Infinity` for `duration`,** which is
  why `audioSeconds` is measured at extraction time and stored on the place.
- **Autoplay needs a gesture** — that is what the "Enter" button is for. Mobile
  Safari refuses even behind one in low power mode, so a rejected `play()` is
  swallowed and the transport just shows paused.
- **The video's own GPS beats the device's.** `getLiveLocation()` only stands in
  for a walkthrough that carried none — otherwise a place captured last year
  would be pinned wherever you happened to be when you uploaded it.
- **KIRI's frame-size cap is not an orientation**, and phones record portrait.
  The check measures the long and short sides rather than width and height, or
  every handheld walkthrough gets rejected at 1080×1920.
- **Hotspot placement raycasts an infinite floor plane**, not the splat and not a
  finite proxy mesh. Rays hit stray floating splat particles, and a
  sized-to-the-room proxy is missed entirely at shallow viewing angles, which
  drops markers into empty space. Hits are clamped to the scene's bounding box.
- **The camera frames from inside the room, off percentiles rather than the
  bounding box.** Captures come back at arbitrary scale and centering, and
  reconstruction scatters floaters — haze over a window, a smear of sky — far
  enough out that one alone doubles the box and drags its center off. Nothing in
  the geometry distinguishes a room from an object; a capture that wants to open
  from outside says so with an explicit `entryPoint`.
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
three.js · MapLibre GL for the map · Web Audio `OfflineAudioContext` for audio
extraction · Firebase Auth + Firestore + Storage · KIRI Engine
