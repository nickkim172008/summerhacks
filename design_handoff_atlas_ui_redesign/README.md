# Handoff: Atlas UI redesign (desktop, light)

## Overview

Atlas is a spatial memory atlas — places captured as photorealistic 3D Gaussian splats, walkable in the browser, presented as a photo library (journeys, places, people, a map, a trash). This handoff covers a **complete visual redesign of the app shell and its six primary screens**. Atlas blue (`#0071E3`) becomes a rare, meaningful accent instead of the colour of every interactive element; typography, corner radii, spacing and surface colours become a fixed, named system.

**This is a UI-only change. No feature is added, removed, or altered.** Every route, listener, handler, and piece of state that exists today must exist and behave identically afterwards.

## About the design files

The files in this bundle (`Atlas Redesign.dc.html`, `Atlas Current UI.dc.html`) are **design references written as standalone HTML** — static prototypes of the intended look. They are not production code and must not be copied into the app.

The target codebase is the existing **Next.js 16 / React 19 / TypeScript / Tailwind CSS v4** app (`src/app`, `src/components`, `src/lib`). Recreate the designs there, in Tailwind utility classes, using the app's existing component structure. Where the prototype uses inline styles, translate to Tailwind (arbitrary values are fine and already used throughout this repo, e.g. `text-[15px]`, `bg-[#0071e3]`).

- `Atlas Redesign.dc.html` — **the target.** Six screens plus a spec sheet of the design system.
- `Atlas Current UI.dc.html` — the app as it renders today, rebuilt from source. Use it as the before/after diff, not as a target.

## Fidelity

**High fidelity.** Colours, type sizes, weights, radii, spacing and copy in the redesign file are final. Match them. Where the prototype shows a value this README does not name, read it off the prototype's inline styles — the prototype is the source of truth for anything ambiguous.

---

## Rules of engagement — read before writing code

These are the failure modes for this task. Avoid them explicitly.

1. **Do not preserve old styling out of caution.** Every screen listed below must visibly change. If a file in the "Files to change" list ends the task with its original class strings intact, the task is not done. `#0071e3` currently appears on ~40 elements; after this work it appears on the small set enumerated under "Where blue is allowed" and nowhere else.
2. **Do not break behaviour to achieve the look.** Do not delete `onClick`, `href`, `useEffect`, subscriptions, `disabled` logic, `aria-*`, `key` props, or conditional branches (`{loading && …}`, `{error && …}`, `{canEdit && …}`) in the course of restyling. If a redesigned element needs different markup, move the handler onto the new element — never drop it.
3. **Do not skip states.** Every screen has loading, empty, error and permission-gated variants in the existing code. Restyle all of them to the new system, not just the happy path the prototype shows. The prototype does not draw a loading state; use `text-[15px] text-[#6B7178]` for those strings and keep the exact copy that is there today.
4. **Do not invent new features.** No new routes, no new Firestore reads, no new libraries, no dark mode, no animation frameworks. The one net-new *presentational* element is the top-bar search field — see "Top bar" for exactly how to ship it without new behaviour.
5. **Do not restructure data flow.** `AppTopBar` must keep mounting `NotificationsBell` only for a signed-in profile (the hook opens listeners); `PlaceExperience` must keep its `lookingRef` / pointer plumbing and its `AmbientPlayer` effect exactly as written — that effect can only run once per mounted `<audio>` element.
6. **Work file by file, and finish each file.** After each file, re-read it and confirm no leftover `#0071e3`, no leftover `border-black/10`, no leftover `text-neutral-500` (see the token replacement table).
7. **When a value is not specified, take it from the prototype — never from memory or habit.**

---

## Design tokens

Add these as CSS custom properties in `src/app/globals.css` under `:root`, and expose them through the existing `@theme inline` block so Tailwind can reference them. Existing `--background` / `--foreground` are replaced by `--canvas` / `--ink`.

### Colour

| Token | Value | Use |
| --- | --- | --- |
| `--canvas` | `#FAF9F7` | Page background, top bar background (at 92% alpha) |
| `--surface` | `#FFFFFF` | Cards, fields, sheets, dialogs |
| `--ink` | `#14161A` | Primary text, primary buttons, icons |
| `--ink-70` | `#4A4F57` | Secondary body copy |
| `--ink-55` | `#6B7178` | Meta text, counts, timestamps, eyebrows. **Do not lighten** — this is the WCAG AA floor at 13px |
| `--ink-placeholder` | `#8A9098` | Input placeholders only |
| `--line` | `rgba(20,22,26,0.09)` | Hairlines, card borders |
| `--line-strong` | `rgba(20,22,26,0.14)` | Button borders, field borders |
| `--accent` | `#0071E3` | Atlas blue — see restrictions below |
| `--accent-soft` | `rgba(0,113,227,0.08)` | Accent chip backgrounds |
| `--danger` | `#C0362C` | Delete confirmations, fatal capture errors |

Replace, globally:

| Today | Becomes |
| --- | --- |
| `bg-white` (page) | `bg-[#FAF9F7]` |
| `text-[#1d1d1f]` | `text-[#14161A]` |
| `text-neutral-500` | `text-[#6B7178]` |
| `text-neutral-400` | `text-[#6B7178]` (never lighter) |
| `border-black/10`, `divide-black/5` | `border-[rgba(20,22,26,0.09)]` |
| `bg-neutral-100` (fills) | `bg-[rgba(20,22,26,0.05)]` |
| `bg-neutral-50` (fields) | `bg-white` + `border-[rgba(20,22,26,0.12)]` |
| `text-red-500` / `bg-red-500` | `text-[#C0362C]` / `bg-[#C0362C]` |

### Where blue is allowed

Atlas blue does exactly three jobs. Every other blue element in the app today becomes ink (`#14161A`) or a neutral.

1. **Where you are** — the active top-bar tab's 2px underline; the notification dot.
2. **What you chose** — selection ticks in the *Add to Journey* sheet; focus rings on fields (`focus:border-[#0071E3]`); the "From the video" provenance chip (`bg-[rgba(0,113,227,0.08)] text-[#0071E3]`); in-progress upload bars.
3. **The one action a screen is for** — Play walkthrough (journey), Add to journey / Save (a reconstructed capture), Next place (guided walkthrough). One per screen, at most.

Everything else that is blue today — Sign Out, Sign In, back links, "Change cover", "Edit bio", `.ply`, Cancel/Save in dialogs, the `+` buttons, tile menu items, Follow, Capture a Place, Try Again — becomes ink or a neutral. Cancel is `text-[#4A4F57]`; Save/confirm is `text-[#14161A] font-semibold`.

### Typography

Load from Google Fonts in `src/app/layout.tsx` via `next/font/google`:

```
Newsreader — opsz 6..72, weights 300/400/500  → --font-display
Archivo    — weights 400/500/600/700          → --font-sans
```

Wire both as CSS variables on `<html>` and set `--font-sans` as the `body` font in `globals.css`, replacing the current `-apple-system` stack in both `globals.css` and the `@theme inline` block.

**Newsreader is used for names a person gave something, and nothing else**: journey titles, place titles, people's display names, the page's own display heading. **Archivo carries everything the app says**: labels, counts, buttons, status, meta, body copy.

| Role | Font | Size / line-height | Weight | Tracking |
| --- | --- | --- | --- | --- |
| Display | Newsreader | 44 / 44 | 400 | -0.02em |
| Page title | Newsreader | 40 / 40 | 400 | -0.02em |
| Journey title (hero) | Newsreader | 46 / 47 | 400 | -0.02em |
| Card title | Newsreader | 19 / 24 | 400 | -0.01em |
| Tile title | Newsreader | 17 / 22 | 400 | -0.01em |
| Section heading | Archivo | 20 / 26 | 600 | -0.01em |
| Body | Archivo | 15 / 24 | 400 | 0 |
| Control / button | Archivo | 14–15 / 1 | 500 | 0 |
| Meta | Archivo | 13 / 18 | 400 | 0 |
| Micro / eyebrow | Archivo | 11 / 12 | 600 | 0.12em, uppercase |

Any numeral that sits in a column or updates live (counts, durations, coordinates, percentages, timestamps) gets `tabular-nums` — the repo already uses this in places; extend it.

### Radius

`8px` controls · `12px` fields and small media · `14px` place tiles · `16px` cards, sheets, dialogs, journey covers · `18px` the viewer's floating info card · `999px` pills, avatars, buttons.

Retire `rounded-2xl` on tiles (currently 16px on a square photo tile) in favour of the values above; keep 16px only for cards.

### Spacing

`4 · 8 · 12 · 16 · 24 · 32 · 40 · 64`. Page gutter `32px`. Content column `max-w-[1152px]` (up from `max-w-5xl` / 1024px) on Library, Journey, Capture and Profile; `max-w-[880px]` on Discover.

### Elevation

- Card: `0 1px 2px rgba(20,22,26,.04)` + `1px` `--line` border.
- Journey cover / raised media: `0 1px 2px rgba(20,22,26,.06), 0 12px 28px -18px rgba(20,22,26,.4)`.
- Journey hero cover: `0 2px 4px rgba(20,22,26,.06), 0 20px 40px -24px rgba(20,22,26,.5)`.
- Accent button: `0 6px 18px -8px rgba(0,113,227,.8)`.
- Viewer glass: `background: rgba(14,16,19,.5–.62)`, `border: 1px solid rgba(255,255,255,.16)`, `backdrop-blur(14–20px)`.

---

## Screens

### 0. App shell — `src/components/AppTopBar.tsx`, `src/components/AppTabs.tsx`, `src/app/layout.tsx`

**The single biggest change.** Today there are two bars: a top strip with the lockup plus the tagline "Capture a Place. Build a Journey. Explore Atlas.", and a fixed **bottom tab bar** (`AppTabs`) — a mobile pattern sitting across the bottom of a desktop window. The bottom bar is removed; navigation moves into one 64px top bar.

**Top bar (redesigned `AppTopBar`)**

- `sticky top-0 z-40`, height `64px`, `px-8`, `bg-[rgba(250,249,247,.92)] backdrop-blur-xl`, bottom border `--line`. Full width (keep today's decision not to constrain it to the content column).
- Left: `AtlasLogo` at `w-[78px]`. **The tagline `<p>` is deleted.**
- Then the nav, inline: Library / Discover / Map. Archivo 15px. Inactive `font-normal text-[#6B7178]`; active `font-medium text-[#14161A]` with a `2px` `#0071E3` bar pinned to the bottom edge of the bar (`absolute left-[14px] right-[14px] bottom-[-1px] h-[2px] rounded-[2px]`). **Move `tabForPath()` out of `AppTabs.tsx` and into `AppTopBar.tsx` unchanged** — same three tabs, same path matching, same `<Link href>` targets (`/`, `/discover`, `/map`). Keep the existing icons available but do not render them in the bar; the labels are enough at this size.
- Right cluster, `gap-3`:
  - **Search field.** `w-[248px] h-9 rounded-full bg-white border-[rgba(20,22,26,.12)]`, magnifier glyph at 15px in `--ink-55`, placeholder "Search places and people" in `--ink-placeholder`. **Ship it as a `<Link href="/discover">` styled as a field**, not as a new input with new query logic — Discover already owns search. Do not add state, debouncing, or a new endpoint.
  - **Capture** button: `h-9 rounded-full bg-[#14161A] text-white px-[18px] text-[14px] font-medium`, `+` glyph. `<Link href="/capture?new=1">`. This replaces the two circular `+` buttons on the Library and Journey headers as the app-wide way to start a capture — but see the Journey screen; the in-album `+` menu stays because it also offers "Add Existing Place".
  - `NotificationsBell` — unchanged logic, restyled: 36px hit area, icon 19px in `--ink-70`, and the count badge becomes a **7px blue dot** at `top-[6px] right-[7px]` with a `1.5px` canvas-coloured ring. Keep the `aria-label` that announces the count. Keep the component split so `useNotifications` still only runs for a signed-in profile.
  - `Avatar` at 34px with `shadow-[0_0_0_1px_rgba(20,22,26,.1)]`, wrapped in the same profile `<Link>`.
  - Signed out: `Sign In` as `text-[#14161A] text-[14px] font-medium`, `Sign Up` as the ink pill. Signed in: **Sign Out moves out of the bar** into the avatar's existing menu surface — if you do not want to build a menu, keep it in the bar as `text-[14px] text-[#4A4F57]`, not a blue outlined pill.

**`AppTabs.tsx`** — delete the component and its mount in `layout.tsx`. Remove the `pb-20` / `pb-24` bottom padding every page carries to clear it. `shouldHideAppChrome()` in `src/lib/appChrome.ts` stays exactly as it is and continues to gate the top bar; do not change its route list.

**Back links.** Journey, Capture and Profile each have a second sticky sub-nav bar containing a blue `‹ Journeys` link. Delete the sub-nav bar. The back affordance becomes an inline row at the top of the content column: a 14px chevron + label, `text-[13px] font-medium text-[#4A4F57]`, same `href` as today (including the `?album=` / `?from=` preservation logic — do not simplify those).

---

### 1. Library — `src/app/page.tsx`

**Purpose:** your journeys, plus Recents, plus journeys shared with you.

**Layout:** `max-w-[1152px]`, `px-8 py-10`.

- **Header row.** Eyebrow (micro, `--ink-55`) reading `{places} places · {journeys} journeys` from the data already in state. Below it `<h1>` "Your library", Newsreader 44. Right side: a 3-up segmented control (Journeys / All places / Shared) — `p-[3px] rounded-full bg-[rgba(20,22,26,.05)]`, selected segment `bg-white rounded-full px-4 py-1.5 text-[13px] font-medium shadow-[0_1px_2px_rgba(20,22,26,.06)]`. **Wire it to the state that already exists**: "Journeys" and "Shared" scroll/filter the two lists already rendered; "All places" navigates to `/album/recents`. Do not add a new data source. Then the trash link — same `href="/trash"`, same `aria-label`, restyled as a 36px white circle with `--line-strong` border and an `--ink-70` glyph.
- **Journey grid.** `grid-cols-4 gap-x-6 gap-y-7`. **Covers change from square to `aspect-[4/3]`, `rounded-2xl` (16px).** `AlbumCover`'s mosaic gets a `gap-[1px]` between quadrants. Under the cover: title in Newsreader 19, then meta 13px `--ink-55` reading `{n} places` — and `· {n} people` when `AlbumCollaborators` has members. The count today is a bare number with no noun; give it the noun.
- `AlbumCollaborators` moves from an overlay inside the cover link to a **facepile bottom-left inside the cover**, 22px circles, `-7px` overlap, each ringed `0 0 0 2px #FAF9F7`.
- `TileMenu` (`⋯`) — same items, same handlers, same outside-click and Escape behaviour. Restyle the trigger to a 26px `rgba(250,249,247,.92)` circle at `right-2.5 top-2.5`; the dropdown becomes `rounded-2xl border-[--line] shadow-[0_12px_28px_-18px_rgba(20,22,26,.4)]`, items `text-[14px]`, danger item `text-[#C0362C]`.
- **Recents card** keeps its position first in the grid and gains a `Recents` pill top-left in the cover; title reads "Everything", meta `{n} places · newest first`.
- **New journey** becomes a fourth grid cell: dashed `--line-strong` border, `+` glyph, "New journey", with a one-line explainer below the tile. It fires the same `setShowNewAlbum(true)` path, including its `!user` → `/signin` and `needsUsername` → `/setup` guards. **Keep those guards.**
- **Shared journeys** section: a `border-t` rule, `<h2>` "Shared with you" (Archivo 20/600), and — when `sharedAlbums` is non-empty — a 4-col grid of compact rows (56px `rounded-xl` cover + Newsreader 16 title + `from @{owner} · {n} places`). Keep the existing empty-state sentence verbatim, restyled to 15px `--ink-70`.
- **Dialogs** (`NewAlbumDialog`, `RenameAlbumDialog`, `ConfirmDialog`): keep every prop, guard and async path. Restyle: scrim `bg-[rgba(20,22,26,.35)]`, panel `rounded-2xl bg-white p-6 shadow-[0_24px_60px_-30px_rgba(20,22,26,.5)]`, title Newsreader 22, body 14px `--ink-70`, input `rounded-xl border-[rgba(20,22,26,.12)] bg-white focus:border-[#0071E3]`. The two-up divided footer becomes a right-aligned row: Cancel `text-[#4A4F57]`, primary an ink pill (`bg-[#C0362C]` when `danger`). Keep `disabled` states and the "Saving…" / "Working…" labels.

---

### 2. Journey — `src/app/album/[albumId]/page.tsx`

**Layout:** `max-w-[1152px]`, `px-8`. Sub-nav deleted; inline `‹ Library` back row at `pt-6`.

- **Hero.** A `212×212` cover at `rounded-2xl` with the hero shadow, then a column: eyebrow "Journey" (micro), `<h1>` in Newsreader 46, meta line 15px `--ink-70` — `{n} places` plus, where known, place names and a date range. (Derive the date range from `capturedAt` on the loaded places; if you would need a new query for it, omit it — do not add one.)
- **Action row**, `gap-3`: **Play walkthrough** — this is the screen's one blue action: `h-10 rounded-full bg-[#0071E3] text-white px-[22px] text-[15px] font-medium` with the accent shadow and a filled ▶ at 13px. It keeps today's `href` exactly, including `?album=&tour=1&from=` encoding, and keeps its condition (`!isRecents && !loading && !error && readyPlaces.length > 0`). Then **Add places** — white pill, `--line-strong` border — which opens `AddEnvironmentsSheet` for a named album; for Recents it must still route to `/capture?new=1`. Then a 40px `⋯` white circle absorbing the existing `+` menu (Capture New Place / Add Existing Place) and, for the owner, `CoverControls` (Choose/Change cover, Remove) — **keep the hidden file input, `prepareImage`, `uploadAlbumCover`, the busy flag, the `inputRef.current.value = ""` reset, and the error line.** Then the members facepile (28px) + "You, @mira and @jonah" from `AlbumMembers`.
- **Places grid.** Today: `grid-cols-5 gap-0.5`, names hidden until hover. New: **`grid-cols-4 gap-x-5 gap-y-6`**, tiles `aspect-square rounded-[14px]`, and the name and date move **below the tile, always visible** — Newsreader 17 + 13px `--ink-55`. Delete the hover gradient overlay; keep `PlaceTile`'s `href` (with `?album=`), its `TileMenu` items and every `onEdit` / `onRemoveFromAlbum` / `onAddToAlbum` / `onTrash` ownership condition exactly as written.
- A place that carries audio gets a small glass chip bottom-left in the tile: `rgba(20,22,26,.62)`, speaker glyph + `m:ss` from `audioSeconds`.
- **`CaptureRunner` in `mode="album"`** currently renders its rows below the grid. Instead, render each in-flight capture **as a cell in the same grid**: white tile, `--line` border, a 34px ring spinner, an animated micro label "Reconstructing" in blue, and the elapsed/remaining line — with the place name and uploader below the tile like any other cell. This is presentational only: the runner's polling, limiter, cache and dispatch logic is untouched.
- Empty state: Newsreader 22 "No places", 15px `--ink-70` body, primary ink pill. Keep both branches (Recents → capture link, album → open picker).
- **`AddEnvironmentsSheet`**: sheet `rounded-2xl`, header row Cancel `--ink-70` / title Newsreader 20 / Add `text-[#14161A] font-semibold` with its `disabled` rule intact. Candidate tiles `rounded-xl gap-2`; the selection tick stays `#0071E3` (that is job #2 for blue).

---

### 3. Discover — `src/app/discover/page.tsx`

**Layout:** `max-w-[880px]`, `px-8 py-11`.

- `<h1>` "Discover" Newsreader 44, plus a 15px `--ink-70` subtitle: "Find the people whose rooms you want to walk into."
- **Search field**: `h-[52px] rounded-[14px] bg-white border-[rgba(20,22,26,.12)]`, 18px magnifier, 16px input, placeholder "Search by name or handle", and a `⌘K` hint chip right-aligned (`border --line-strong, rounded-md, 11px`). Keep `value`/`onChange`, the 250ms debounce, the `stale` guard, `autoCapitalize`/`autoCorrect`/`spellCheck`. If you do not want to implement the shortcut, drop the chip — **do not draw a control that does nothing.**
- Replace the "Handles match from the start" helper line with the segmented control (People / Places / Journeys) **only if you can wire the extra segments to real queries.** Otherwise render People alone and keep the helper line, restyled to 13px `--ink-55`.
- **Results** move from a divided list to a `grid-cols-2 gap-4` of cards: `rounded-2xl bg-white border --line p-4`, 48px avatar, Newsreader 18 display name, `@handle · {n} places` meta, one-line clamped bio, and a right-aligned Follow button — ink pill when not following, white `--line-strong` pill labelled "Following" when following. **Preserve `isDemoOrganizerProfile`**: demo rows render as a `<div>`, not a `<Link>`, and organizers still sort first.
- Keep every empty/searching string exactly as it is today ("Searching…", `No one matches “…”`, "No accounts yet."), restyled to 15px `--ink-55`.

---

### 4. Capture — `src/app/capture/page.tsx`, `src/components/CaptureRunner.tsx`, `src/components/CaptureQueue.tsx`

Single column, `max-w-[1152px] p-8`. Inline back row (`‹ {album name}` or `‹ Library`, preserving the `albumId` branch).

- **Header row.** `<h1>` "New places" Newsreader 44; below it a 15px `--ink-70` line, max 62ch: "One slow walkthrough per room. Reconstruction takes 30–90 minutes and keeps going without you; the video itself is never stored." Right-aligned in the same row: the **Choose videos** ink pill — this is the file input's label. It replaces today's large dashed "Choose Videos" block *and* the separate "Start Capture" button; keep the hidden `<input type="file" multiple accept="video/*">`, the `formKey` remount trick, and `addVideos()`.
  - `dispatch({type:"start-requested"})` still needs a trigger. Put it on the row-level state: rows that are `ready-to-upload` show a **Start** control in the row's action cluster, still gated by `canStart(queue.items)`. Do not silently drop the dispatch.
- **Drop target.** One full-width `rounded-2xl` dashed card, `p-[22px_26px]`, laid out horizontally: 44px neutral circle with an upload glyph, then "Drop walkthroughs here" (15/500) over "Under 3 minutes · 1920×1080 or smaller · one continuous slow walk, no cuts" (13px `--ink-55`), then a right-aligned "or use **Choose videos** above". The limits must be interpolated from `MAX_VIDEO_SECONDS` / `MAX_VIDEO_WIDTH` / `MAX_VIDEO_HEIGHT` as they are today, not hard-coded.
- **"In flight" section.** `border-t`, `<h2>` "In flight" (Archivo 20/600), right-aligned 13px `--ink-55` note "Each one saves on its own · safe to close this tab". This absorbs the two trailing paragraphs the runner renders today (the 30–90 minute note and the "N captures are transferring" note); keep the transferring count if you want, as a chip in this row, driven by `activeCount()`.
- **Queue rows** (`CaptureQueue.tsx`). `rounded-2xl bg-white border --line p-4 shadow-[0_1px_2px_rgba(20,22,26,.04)]`, `gap-3` between rows. Each row is an **88px `rounded-xl` thumbnail** (use the row's poster once `grabPoster` has one; fall back to the per-id gradient) beside a content column:
  - Title: Newsreader 20. While `isNameable(phase)` it is still an editable input — style it as a borderless Newsreader 20 field on a transparent background that gains `--line-strong` on focus. **Keep it an input; keep `onRename`.**
  - Status: 13px `--ink-55`, from `describePhase()` unchanged. Phase chip right-aligned: micro caps, `bg-[rgba(0,113,227,.08)] text-[#0071E3]` for "Ready", `bg-[rgba(20,22,26,.05)] text-[#4A4F57]` for "Reconstructing", `text-[#C0362C]` for failure.
  - Progress: `h-1 rounded-full bg-[rgba(20,22,26,.07)]` with a `#0071E3` fill; the indeterminate phases keep a pulsing 46%-wide fill. Keep the `INDETERMINATE` set as-is.
  - Details editor: the two fields become a `grid-cols-2 gap-x-4 gap-y-2.5` of labelled boxes (micro caps label, `rounded-[10px] bg-[#FAF9F7] border-[rgba(20,22,26,.12)]` field). Keep `datetime-local`, `onWhenChange`, `onLocationName`, the coordinate line, the `Source` provenance chips (blue for "From the video", amber for "Guessed from the file — check it") and `describeAudio()`.
  - Actions: Preview = white pill; **Save / Add to journey = the blue pill** (the screen's one accent action); Try Again = ink pill; Open = white pill; the `.ply` download link becomes 12px `--ink-55`; remove `×` becomes a 28px ghost circle. Keep `canSave`, `isRetryable`, and every `disabled`.
- The preview `SplatViewer` panel keeps its `key={previewed.id}` and its single-context rule. Restyle the frame to `rounded-2xl ring-1 ring-[--line]`, heading Newsreader 22, "Close Preview" to `--ink-70`.

---

### 5. Place viewer — `src/components/PlaceExperience.tsx` (+ `src/app/place/[placeId]/page.tsx`)

Chrome only. **Do not touch** the pointer/look plumbing, the exit fade timer (`FADE_MS`), the `AmbientPlayer` mount-once effect, the `GainNode` fade, the `crossOrigin="anonymous"`, the `removeAttribute("src")` + `load()` teardown, or the `startPlayback` swallow.

- Add two full-bleed scrims over the canvas, below the chrome: `linear-gradient(to bottom, rgba(0,0,0,.42) 0%, transparent 22%, transparent 58%, rgba(0,0,0,.55) 100%)`. Nothing else changes about the canvas.
- **Top-left back button** becomes glass instead of white: `h-[38px] rounded-full bg-[rgba(14,16,19,.5)] border-[rgba(255,255,255,.16)] backdrop-blur-[14px] text-white text-[14px] font-medium px-[18px]`, and its label names where you are going (the album name when `?album=` is set, otherwise "Library") — read it from what the page already has; do not fetch it.
- **Top-right** cluster, same glass: a `{i} of {n}` counter **only when a tour is driving playback** (`tour` prop present — it already carries this), the Edit action as a 38px pencil circle (still gated on `user?.uid === place.uploaderId`), and a fullscreen glyph if and only if you implement it.
- **Info card**, bottom-left, `w-[420px] rounded-[18px] bg-[rgba(14,16,19,.62)] border-[rgba(255,255,255,.1)] backdrop-blur-[20px] p-5`:
  - micro caps line, `rgba(255,255,255,.42)` — the formatted `capturedAt`, from `describeCapture()`;
  - `<h1>` Newsreader 32, white;
  - a row: 20px uploader avatar + `@username` (white, links to the profile — keep the `<Link>`) + `·` + `locationName` or coordinates;
  - a rule, then the transport: 38px white play/pause circle, then a **16-bar level meter** where played bars are `rgba(255,255,255,.9)` and unplayed `rgba(255,255,255,.28)`, then `0:34 / 1:36` in tabular numerals at 11px `rgba(255,255,255,.45)`, then the Loop pill.
  - **The meter is decorative, but the control under it must not be.** Keep a real `<input type="range">` — either overlay it transparently across the meter (`opacity-0 absolute inset-0 cursor-pointer`) or keep a thin visible track. `min`, `max`, `step`, `value={Math.min(position,duration)}` and the `onChange` that sets `currentTime` all stay. Keep the `failed` branch and its message.
- `TourChrome` keeps its own layout; restyle its controls to the same glass tokens. A tour's forward action is the screen's one blue button: **Next place**, `bg-[#0071E3]`, bottom-right, beside a glass "Drag to look around" hint.

---

### 6. Profile — `src/app/u/[username]/page.tsx`

`max-w-[1152px] px-8 py-10`. Sub-nav deleted; keep the "Your profile" indicator as a micro caps label if you keep it at all.

- **Header**: 96px avatar (`ProfileAvatar` — keep the editable variant's hidden input, `prepareProfilePhoto`, `uploadProfilePhoto`, `updatePhotoURL`, busy flag and error line, and keep `relative` on the circle so `next/image` `fill` stays inside it). Then a column: `<h1>` Newsreader 40, `@handle · joined {month year}` at 15px `--ink-55`, the bio at 15/1.65 in `--ink`, then the stats as a `gap-9` row — value 22px Archivo 600 tabular, label micro caps `--ink-55`. **Keep `Stat`'s rule that a zero count is not a button**, and keep `FollowListDialog`.
- Right: **Follow** as an ink pill (`Following` = white pill with `--line-strong`) — blue is not used here — plus a 40px `⋯`. Keep `subscribeToIsFollowing`, the busy flag and the `isFollowing === null` disabled state.
- Under the header: the segmented control (Journeys / Places / Map) switching the two lists already on the page. If you do not have a Map view for a profile, ship two segments.
- **Journeys**: `grid-cols-4 gap-x-6 gap-y-7`, `aspect-[4/3] rounded-2xl` covers with the raised shadow, Newsreader 19 title, `{n} places` meta.
- **Places**: `grid-cols-6 gap-3`, `aspect-square rounded-xl`. Keep the hover caption for this dense grid, restyled: `bg-gradient-to-t from-[rgba(20,22,26,.72)]`, name 12/500, date 11px at 85% white.
- Keep the `albumsError` / `placesError` amber lines and the loading/empty strings, restyled to 15px `--ink-55` (errors `text-[#C0362C]`).

---

## Screens not covered

`/map`, `/notifications`, `/trash`, `/signin`, `/signup`, `/setup`, `/dev`, `/tour/[albumId]` have no redesigned mock. **Restyle them to the tokens anyway** — canvas, ink, fonts, radii, blue restrictions, back-row pattern, no bottom tab bar, `max-w-[1152px]`. Do not leave them on the old system, and do not redesign their layouts. `globals.css`'s `.auth-*` block (the sign-in gradient wash, glows, grain, brand gradient text) should have its blues re-derived from `#0071E3` and its warm orange kept; the `prefers-reduced-motion` block stays.

`.live-location-dot` on the map keeps `#0071e3` — a live position marker is "where you are", which is job #1.

---

## Interactions and behaviour

Unchanged in every case. Specifically preserved:

- Route guards: unauthenticated → `/signin`, `needsUsername` → `/setup`, on Library, Journey and Capture.
- `?album=` scoping and `?from=` return paths, including `sitePath()`'s same-origin check on the place route.
- Firestore `onSnapshot` subscriptions and their cleanup; the `placeIdKey` join that stops listeners rebuilding on every snapshot.
- The capture queue's localStorage jobs, Cache Storage audio/poster/splat entries, `claimedRef` guards, limiters, 20s poll with 1.5s stagger, and KIRI error fall-through.
- `React.StrictMode` stays off.
- Hover: media lifts nothing; instead `opacity` 0.9 on covers and `bg` shifts on pills. Transitions `150ms ease` on colour/opacity only. Nothing in this design animates layout.
- Focus: every interactive element keeps a visible focus ring — `outline: 2px solid #0071E3; outline-offset: 2px`. This is job #2 for blue and is not optional.
- `prefers-reduced-motion`: the "Reconstructing" pulse and the indeterminate progress fill must stop.

## Accessibility

- `--ink-55` (`#6B7178`) is the lightest text colour permitted on canvas or white; it measures 4.6:1. `#878D95` and `#A8ADB4` were used in an earlier draft and **fail AA** — do not reintroduce them. Placeholders use `#8A9098`.
- Keep every `aria-label`, `aria-expanded`, `aria-pressed` and `aria-hidden` that exists today, including the notification bell's count announcement, which the dot no longer conveys visually.

## Assets

- `public/brand/atlas-lockup.png` (700×325) and `public/brand/atlas-mark.png` (512×512) — already in the repo, used unchanged via `AtlasLogo`. Lockup renders at `w-[78px]`.
- Fonts: Newsreader and Archivo, Google Fonts, via `next/font/google`. No other new assets.
- Icons: reuse the inline SVG paths already in the repo (`AppTabs`, `AppTopBar`, `PlaceThumb`, `AlbumCover`, the trash glyph in `page.tsx`). New glyphs needed — chevron-left, plus, upload, pencil, speaker, play/pause, fullscreen — are all in the prototype; copy those paths. **Do not add an icon library.**
- Place thumbnails: `PlaceThumb`'s gradient fallback stays, but the palette is muted to sit under the new neutrals. Replace the six Tailwind pairs with: `#8FB6D9→#5F6FA8`, `#E3C58F→#C78A54`, `#8EC3AC→#4C8478`, `#D9A1A8→#A3607A`, `#A89ECD→#6B5F9C`, `#8FC6D4→#4B7EA6`, all at `140deg`. Keep `gradientFor()`'s hash so a place keeps its colour.

## Files to change

| File | Change |
| --- | --- |
| `src/app/globals.css` | Tokens, font variables, `.auth-*` re-derivation |
| `src/app/layout.tsx` | Fonts, remove `<AppTabs />` |
| `src/components/AppTopBar.tsx` | Rebuilt as the single nav bar |
| `src/components/AppTabs.tsx` | **Deleted** (move `tabForPath` first) |
| `src/app/page.tsx` | Library + its three dialogs |
| `src/app/album/[albumId]/page.tsx` | Journey hero, grid, sheet, cover controls |
| `src/app/capture/page.tsx` | Header, drop target, in-flight section |
| `src/components/CaptureRunner.tsx` | Picker/CTA markup, preview frame |
| `src/components/CaptureQueue.tsx` | Row layout, chips, fields, actions |
| `src/components/PlaceExperience.tsx` | Glass chrome, info card, transport |
| `src/components/TourChrome.tsx` | Glass tokens, Next place |
| `src/app/u/[username]/page.tsx` | Profile header, stats, tabs, grids |
| `src/components/AlbumCover.tsx` | 4:3 support, mosaic gap, empty glyph colour |
| `src/components/PlaceThumb.tsx` | Muted gradients |
| `src/components/PlaceTile.tsx` | Caption below tile, audio chip, no hover overlay |
| `src/components/TileMenu.tsx` | Trigger + dropdown restyle |
| `src/components/Avatar.tsx`, `AlbumCollaborators.tsx`, `AlbumMembers.tsx`, `AlbumPicker.tsx`, `FollowListDialog.tsx`, `PlaceDetailsEditor.tsx`, `GoogleAuthPanel.tsx`, `TimelineBar.tsx`, `TourIntro.tsx` | Token pass: colours, radii, type, blue restriction |
| `src/app/map/page.tsx`, `discover/page.tsx`, `notifications/page.tsx`, `trash/page.tsx`, `signin`, `signup`, `setup`, `dev`, `tour/[albumId]` | Token pass + shell changes |

## Definition of done

- [ ] `rg "#0071e3"` returns only the elements listed under "Where blue is allowed", plus `.live-location-dot`.
- [ ] `rg "AppTabs"` returns nothing.
- [ ] `rg "text-neutral-400|text-neutral-500|border-black/10|#1d1d1f"` returns nothing.
- [ ] `rg "878D95|A8ADB4"` returns nothing.
- [ ] Newsreader appears on journey, place and person names, and nowhere else.
- [ ] Every route still loads, signed in and signed out; capture still uploads, polls, previews and saves; audio still plays and fades; follows, covers, bios, trash and restore all still work.
- [ ] No new dependency in `package.json` beyond the two fonts.

## Files in this bundle

- `Atlas Redesign.dc.html` — the target design (open in a browser).
- `Atlas Current UI.dc.html` — the app as it renders today.
- `brand/atlas-lockup.png`, `brand/atlas-mark.png` — the marks used in both.
