# Spatial memory atlas

Places captured as photorealistic 3D Gaussian Splats, walkable in the browser.
You film one slow walkthrough of a room; what comes back is the room itself,
carrying the sound that was in the air while you filmed it. Walk in and that
audio fades up under the scene.

The video answers for the memory as well as the geometry: where it was shot and
when are read out of the file's own container, so a place lands on the map and
in the timeline without anyone typing anything.

It presents as a photo library — albums, a Recents grid, a public profile per
person, a map of everywhere you have been, and a trash that makes deleting
reversible. Each place is its own independent splat scene, opened from an album
or the map and left the way you came in.

## Quick start

```bash
npm install
cp .env.local.example .env.local   # then fill it in
npm run dev
```

Then open **`/dev`** — two linked sample scenes, no Firebase and no KIRI key
required. It is the fastest way to see the interaction loop working, and it
answers "is the renderer alive" before any account exists.

The library itself needs Firebase. Without those keys it says so explicitly
instead of hanging.

### Environment

Every variable, and what breaks without it:

| Variable                       | Needed for                    | Missing means                            |
| ------------------------------ | ----------------------------- | ---------------------------------------- |
| `NEXT_PUBLIC_FIREBASE_*`       | Auth, Firestore, Storage      | The library reports it rather than hangs |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | The Map tab                | `/map` explains itself and links the console |
| `KIRI_API_KEY`                 | Reconstruction                | `/capture` cannot submit                 |
| `NEXT_PUBLIC_DEMO_CAPTURE`     | Pitch mode (optional)         | Captures really go to KIRI               |

- The Firebase values come from the console: Project settings → Your apps → Web
  app config. Enable **Firestore**, **Storage**, and **Google sign-in** under
  Authentication. Storage on a new project requires the Blaze plan.
- `KIRI_API_KEY` is **server-side only** — never prefix it with `NEXT_PUBLIC_`,
  which would ship it to the browser. It holds one key or several separated by
  commas: a batch of walkthroughs can outrun one account's credits, so
  submission falls through to the next key when the current one is spent, and
  status and download follow whichever key started a job.
- `NEXT_PUBLIC_DEMO_CAPTURE=true` puts `/capture` in pitch mode: the walkthrough
  is accepted and the row walks through its phases without calling KIRI, so the
  flow finishes in seconds instead of an hour.

### Firebase setup

```bash
firebase deploy --only firestore:rules,storage    # rules in this repo
gsutil cors set cors.json gs://<bucket>           # or: gcloud storage buckets update --cors-file=cors.json
```

The CORS rule is what lets a browser read a splat straight out of Storage. A
bucket without one refuses the read, and a capture that saved perfectly renders
as a black screen — `/api/places/asset` exists as the fallback for exactly that
(see below), but setting the rule is the fix.

## Routes

| Route               | What it does                                               |
| ------------------- | ---------------------------------------------------------- |
| `/`                 | Albums and Recents (Firestore `onSnapshot`); Library tab    |
| `/album/[id]`       | One album's places. `recents` is virtual — everything       |
| `/place/[id]`       | Walk a place and hear the walkthrough it was filmed with    |
| `/discover`         | Search people, and who has joined lately; Discover tab      |
| `/map`              | Heatmap of every geotagged place; Map tab                   |
| `/capture`          | Upload a walkthrough → KIRI → render → save                 |
| `/notifications`    | New followers and captures from people you follow           |
| `/trash`            | Deleted places, restorable until emptied                    |
| `/u/[username]`     | Public profile: that person's albums and environments       |
| `/signin`, `/signup`, `/setup` | Google sign-in, then claim a username            |
| `/dev`              | Two linked sample scenes; no Firebase or KIRI needed        |

Signed out, `/` shows every place so browsing still works; signed in it narrows
to yours. Arriving at a place from an album carries `?album=` along, so Back
returns to that album rather than to the library.

### API

| Endpoint                    | Why it is server-side                                  |
| --------------------------- | ------------------------------------------------------ |
| `POST /api/capture/submit`  | Holds the KIRI key; returns the job's `serialize`       |
| `GET /api/capture/status`   | Same, polled every 20s                                  |
| `GET /api/capture/model`    | Downloads KIRI's zip and extracts the `.ply` out of it  |
| `GET /api/places/asset`     | Proxies stored bytes through this origin when CORS is not set |

The first three exist only because the KIRI key must not reach the browser. The
asset proxy is a fallback and costs real bandwidth — every byte of a splat
travels through this process rather than straight from Google — so it is
restricted to this project's own bucket, or it would be an open proxy onto
whatever the server can reach.

## How a capture works

One walkthrough video per place, reconstructed by KIRI Engine. Everything only
the file can answer is read the moment it is picked, in the browser, before
anything is uploaded:

1. Duration and frame size, checked against KIRI's limits so a bad file never
   costs credits; where and when it was filmed, read out of the container; a
   frame for the thumbnail; and the audio track, lifted off in parallel with
   the upload
2. The walkthrough goes to `POST /api/capture/submit` → KIRI `/3dgs/video`,
   which returns a `serialize` job id. The video is not kept anywhere else:
   reconstruction is the only thing that reads it, and what outlives it is the
   splat, the details and the sound
3. The job id and the metadata go to `localStorage`; the WAV and the frame go to
   Cache Storage under the same serialize
4. `GET /api/capture/status` polls KIRI every 20s until status `2` (successful)
5. `GET /api/capture/model` downloads the result zip server-side and extracts
   the `.ply`. The browser renders it immediately from an object URL and keeps
   the blob
6. Saving transcodes the PLY to SPZ (64.7 MB → 4.9 MB on a 260k-splat room),
   uploads it with the WAV and the thumbnail, and writes one place document
   holding the URLs and everything step 1 found

**Reconstruction takes 30–90 minutes**, so seed places ahead of a demo rather
than generating one live. KIRI's limits: video ≤ 3 minutes, ≤ 1920×1080.

`/capture` survives that wait: the job is in `localStorage`, so closing the tab
and coming back resumes the same job — which is also why the metadata, audio and
thumbnail have to be put aside in step 3, since by the time the splat lands the
form is long gone and no `File` survives a reload. Steps 4–5 need no Firebase;
without it the splat still renders and can be downloaded, it just cannot be
saved.

`scripts/kiri_3dgs.py` drives the same three endpoints from the command line
(`--video` to start, `--serialize` to resume). Paste the task id it prints into
`/capture` to render that job's splat in the app.

## Where media lives

Every byte is in **Firebase Storage**. Firestore holds download URLs and
metadata and nothing else (documents cap at 1 MiB).

```
splats/{placeId}/{name}.spz        walkable Gaussian splat
audio/{placeId}/walkthrough.wav    the audio lifted off the video
thumbnails/{placeId}/cover.jpg     a frame off the walkthrough
albumCovers/{albumId}/cover.jpg    only when an album's cover is chosen by hand
avatars/{uid}/profile.jpg          only when a profile photo is uploaded
```

Source videos are not stored. They are uploaded to KIRI, reconstructed, and that
is the end of them — a few megabytes of splat, details and audio survive per
capture instead of the several hundred a copy of every walkthrough costs.

Emptying the trash lists and deletes the first three folders before the
document, in that order: bytes that nothing names can never be found again,
while a document whose files are gone at least renders as a missing capture and
can be cleared.

## Data model

```
places/{placeId}
  name, uploaderId, createdAt, splatUrl, thumbnailUrl
  audioUrl?, audioSeconds?
  capturedAt?          ISO 8601, off the video or typed in
  location?: { lat, lng }, locationName?
  entryPoint?: { position: {x,y,z}, target: {x,y,z} }
  deletedAt?           present only while in the trash

albums/{albumId}
  name, ownerId, placeIds, createdAt
  coverUrl?            absent is normal: the cover is a mosaic of what it holds

profiles/{uid}
  username, displayName, photoURL, bio?, createdAt

usernames/{username}
  uid                  lock doc, taken in the same transaction as the profile

follows/{followerId}_{followingId}
  followerId, followingId, createdAt
```

Every optional field is written only when it exists — Firestore rejects
`undefined` outright, so an unknown detail is left off the document rather than
stored as a blank.

**Notifications have no collection.** The feed is derived from `follows` and
`places` at read time. Storing it would mean fanning out on every capture — the
uploader writing a document into each follower's inbox — which no security rule
can distinguish from a client forging notifications for strangers. Server-side
fan-out is the usual answer and this project has no Cloud Functions, so the feed
is assembled from the source of truth instead: a few extra listeners, no new
rules, and nothing can be faked into someone else's inbox.

## Implementation notes

Things that are non-obvious and cost time to rediscover:

### Reading the video

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
- **The video's own GPS beats the device's.** `getLiveLocation()` only stands in
  for a walkthrough that carried none — otherwise a place captured last year
  would be pinned wherever you happened to be when you uploaded it.
- **KIRI's frame-size cap is not an orientation**, and phones record portrait.
  The check measures the long and short sides rather than width and height, or
  every handheld walkthrough gets rejected at 1080×1920.

### Audio

- **`decodeAudioData` reads audio straight out of an mp4/mov container**, so
  lifting the walkthrough's sound needs no transcoding service and the video
  never leaves the browser. Rendering into a one-channel `OfflineAudioContext`
  at 22050 Hz does the downmix and the resample in the same pass: 2.6 MB per
  minute as 16-bit WAV, which plays everywhere with no codec.
- **Failing to read the audio is an answer, not an error.** A video may carry no
  audio track, and some phone codecs are ones a given browser cannot open. The
  place saves silent rather than the capture being lost.
- **A media element that keeps its `src` goes on streaming after React detaches
  it,** which leaves one place audible underneath the next. Unmounting removes
  the attribute and calls `load()`.
- **A WAV served without a length answers `Infinity` for `duration`,** which is
  why `audioSeconds` is measured at extraction time and stored on the place.
- **Autoplay needs a gesture** — that is what the "Enter" button is for. Mobile
  Safari refuses even behind one in low power mode, so a rejected `play()` is
  swallowed and the transport just shows paused.

### Surviving the wait

- **The audio waits in Cache Storage, not localStorage.** It is lifted 30–90
  minutes before the splat it belongs to exists; megabytes of samples cannot sit
  in localStorage beside the job, so the job carries the length and the cache
  carries the bytes, both keyed by the KIRI serialize. Splats and thumbnails are
  cached the same way, in separate caches — a write keeps only the newest entry,
  and pruning one kind must not take the other half of the same job with it.
- **KIRI's error bodies are not always valid JSON.** The out-of-credit reply
  ends its message with a raw newline *inside* the string literal, which
  `JSON.parse` refuses: `Bad control character in string literal at position 71`.
  Replies are read as text and parsed defensively, because a `SyntaxError` is
  not a `KiriError` and would escape the fall-through to the next key — one
  spent key would end the whole batch, reporting a parse error instead of the
  reason.
- **KIRI answers business errors with HTTP 500 and `"ok": true`.** A rejected
  video and a working key look identical from the status line, so the envelope
  is what decides. Only account trouble is treated as worth another key: a video
  one account refuses every account refuses, and retrying uploads it N more
  times to arrive at the same answer.
- **`/api/capture/submit` buffers the whole video** — `req.formData()` in, a
  fresh multipart body out to KIRI. Fine for a ≤ 3 minute clip; it would need to
  stream if the limit ever rises.

### Rendering

- **The camera frames from inside the room, off percentiles rather than the
  bounding box.** Captures come back at arbitrary scale and centering, and
  reconstruction scatters floaters — haze over a window, a smear of sky — far
  enough out that one alone doubles the box and drags its center off. Nothing in
  the geometry distinguishes a room from an object; a capture that wants to open
  from outside says so with an explicit `entryPoint`.
- **Spark detects the splat format from the file's magic bytes**, not the URL,
  so a `blob:` object URL with no `.ply` extension loads fine. That is what lets
  a freshly downloaded capture render without a round trip through Storage.
- **React StrictMode is off.** Its double-mount created two WebGL contexts and
  downloaded every splat twice.
- Splats load with `quaternion.set(1, 0, 0, 0)` because captures arrive Y-down
  relative to three.js.

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · Spark
(`@sparkjsdev/spark`) for WebGL2 splat rendering · three.js · Google Maps
JavaScript API for the map · Web Audio `OfflineAudioContext` for audio
extraction · Firebase Auth + Firestore + Storage · KIRI Engine for
reconstruction
