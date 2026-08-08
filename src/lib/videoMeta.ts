/**
 * Recovers when and where a walkthrough was filmed, out of the video file
 * itself.
 *
 * Nothing in the browser exposes this. A <video> element gives duration and
 * dimensions and stops there, so the container has to be read by hand. MP4 and
 * QuickTime .MOV are both ISO base media: a flat list of length-prefixed boxes,
 * each 4 bytes of size and 4 of type, nesting arbitrarily deep. That shape is
 * what makes reading it cheap — every box announces its own length, so the walk
 * can jump from one to the next without ever looking inside, and only the few
 * hundred bytes that actually hold metadata are ever fetched. This matters more
 * than it sounds: an iPhone writes `moov` (all the metadata) *after* `mdat`
 * (all the video), so the interesting part of a two-gigabyte recording sits at
 * the very end, and anything short of seeking would drag the whole thing
 * through memory to reach it.
 *
 * Where the metadata lives has moved. The documented QuickTime spot is `udta`
 * holding `©xyz` (ISO 6709 coordinates) and `©day` — but a current iPhone
 * writes no `udta` at all. It puts a `meta` box directly under `moov` holding a
 * `keys` table of reverse-DNS names and an `ilst` of values indexed into it, so
 * the location is under `com.apple.quicktime.location.ISO6709` and the date
 * under `com.apple.quicktime.creationdate`. Both layouts are read here: older
 * phones, Android, and most cameras still use the first.
 *
 * A file the user picked is a file the user picked — it may be a container this
 * knows nothing about, or truncated mid-upload. Every path resolves to nulls so
 * the caller can ask for the details by hand instead.
 */

export interface VideoCapture {
  /** ISO 8601, UTC. */
  capturedAt: string | null;
  location: { lat: number; lng: number } | null;
}

/**
 * QuickTime prefixes its own user-data atoms with byte 0xA9, which reads as ©
 * once the four type bytes are decoded as Latin-1.
 */
const LOCATION_ATOM = "©xyz";
const DAY_ATOM = "©day";

const KEY_LOCATION = "com.apple.quicktime.location.ISO6709";
const KEY_CREATION_DATE = "com.apple.quicktime.creationdate";

/** Seconds between the 1904 epoch the format counts from and the Unix one. */
const EPOCH_1904_OFFSET = 2_082_844_800;

/** `data` payloads are typed; 1 is UTF-8 text and the rest are not ours. */
const TEXT_UTF8 = 1;

/**
 * Anything outside this is a misread field rather than a filming date — most
 * often a zeroed `creation_time`, which lands in 1904. Deliberately not
 * measured against the clock: a device with the wrong date set still shot the
 * video, and its own answer beats having none.
 */
const EARLIEST = Date.UTC(1990, 0, 1);
const LATEST = Date.UTC(2100, 0, 1);

/** Enough header for `mvhd` in either version. */
const MVHD_BYTES = 32;

/**
 * A `udta`/`meta` subtree is normally a few hundred bytes. Some cameras bury a
 * preview image or a proprietary blob in there; past this it is not metadata
 * worth pulling over.
 */
const MAX_METADATA_BYTES = 4 * 1024 * 1024;

/** A size field that lies can otherwise walk a corrupt file forever. */
const MAX_BOXES = 4096;
const MAX_DEPTH = 8;

const latin1 = new TextDecoder("latin1");
const utf8 = new TextDecoder("utf-8");

interface Box {
  type: string;
  size: number;
  headerSize: number;
}

interface MovieMetadata {
  iso6709?: string;
  day?: string;
  creationDate?: string;
  /** `mvhd` creation_time, in Unix milliseconds. */
  createdMs?: number;
}

function viewOf(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Whether four type bytes spell a name rather than a number. Printable ASCII,
 * except that the leading byte may also be the © that marks a QuickTime atom —
 * the distinction an `ilst` turns on, where an entry is titled either by a name
 * like `©day` or by an integer index into a `keys` table.
 */
function isAtomName(type: string) {
  return /^[©\x20-\x7e][\x20-\x7e]{3}$/.test(type);
}

/**
 * `limit` is what is left of the enclosing container from `at`, which a size of
 * 0 means to consume ("this box runs to the end").
 */
function parseHeader(bytes: Uint8Array, at: number, limit: number): Box | null {
  if (at + 8 > bytes.length) return null;
  const view = viewOf(bytes);
  const type = latin1.decode(bytes.subarray(at + 4, at + 8));
  let size = view.getUint32(at);
  let headerSize = 8;

  if (size === 1) {
    if (at + 16 > bytes.length) return null;
    const large = view.getBigUint64(at + 8);
    if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(large);
    headerSize = 16;
  } else if (size === 0) {
    size = limit;
  }

  // A box that does not clear its own header would leave the walk standing
  // still, so this is where a corrupt size stops being followed.
  if (size < headerSize) return null;
  return { type, size, headerSize };
}

async function readAt(file: File, offset: number, length: number) {
  const end = Math.min(offset + length, file.size);
  if (end <= offset) return new Uint8Array(0);
  return new Uint8Array(await file.slice(offset, end).arrayBuffer());
}

/** Body bounds of the first `type` box between `start` and `end`, header-only reads. */
async function findBox(file: File, start: number, end: number, type: string) {
  let offset = start;
  for (let hop = 0; hop < MAX_BOXES && offset + 8 <= end; hop += 1) {
    const box = parseHeader(await readAt(file, offset, 16), 0, end - offset);
    if (!box) return null;
    if (box.type === type) {
      return {
        start: offset + box.headerSize,
        end: Math.min(offset + box.size, end),
      };
    }
    offset += box.size;
  }
  return null;
}

function walkBytes(
  bytes: Uint8Array,
  start: number,
  end: number,
  visit: (box: Box, at: number, bodyStart: number, bodyEnd: number) => void,
) {
  let offset = start;
  for (let hop = 0; hop < MAX_BOXES && offset + 8 <= end; hop += 1) {
    const box = parseHeader(bytes, offset, end - offset);
    if (!box) return;
    visit(
      box,
      offset,
      offset + box.headerSize,
      Math.min(offset + box.size, end),
    );
    offset += box.size;
  }
}

/**
 * QuickTime's `meta` holds its children directly, while the ISO one is a full
 * box and puts four bytes of version and flags first. Nothing distinguishes
 * them, so read ahead: if a box header sits right at the start, there is no
 * version field to skip.
 */
function metaChildren(bytes: Uint8Array, bodyStart: number, bodyEnd: number) {
  const first = parseHeader(bytes, bodyStart, bodyEnd - bodyStart);
  return first && isAtomName(first.type) ? bodyStart : bodyStart + 4;
}

/**
 * A `©` atom under `udta` is not a bare string: it leads with a 16-bit byte
 * count and a 16-bit language code. Enough writers omit that to make trusting
 * it blindly a mistake, so the prefix is only stripped when the count agrees
 * with the bytes actually present.
 */
function quickTimeText(bytes: Uint8Array, start: number, end: number) {
  if (start >= end) return undefined;
  const from =
    start + 4 <= end && viewOf(bytes).getUint16(start) === end - start - 4
      ? start + 4
      : start;
  return utf8.decode(bytes.subarray(from, end)).replace(/\0/g, "").trim();
}

function readKeys(bytes: Uint8Array, start: number, end: number) {
  const keys: string[] = [];
  if (start + 8 > end) return keys;
  const view = viewOf(bytes);
  const count = view.getUint32(start + 4);
  let offset = start + 8;
  for (let i = 0; i < count && offset + 8 <= end; i += 1) {
    const size = view.getUint32(offset);
    if (size < 8 || offset + size > end) break;
    // The 4 bytes after the size are the namespace ('mdta'); the name follows.
    keys.push(utf8.decode(bytes.subarray(offset + 8, offset + size)));
    offset += size;
  }
  return keys;
}

function readDataValue(bytes: Uint8Array, start: number, end: number) {
  let value: string | undefined;
  walkBytes(bytes, start, end, (box, _at, bodyStart, bodyEnd) => {
    if (box.type !== "data" || value || bodyStart + 8 > bodyEnd) return;
    // One byte of version then three of well-known type, then a locale.
    if ((viewOf(bytes).getUint32(bodyStart) & 0xffffff) !== TEXT_UTF8) return;
    value = utf8.decode(bytes.subarray(bodyStart + 8, bodyEnd)).trim();
  });
  return value;
}

/**
 * `ilst` entries are named two ways: the iTunes layout puts a real type in the
 * header (`©day`), the Apple metadata layout puts a 1-based index into the
 * sibling `keys` table there instead.
 */
function readItemList(
  bytes: Uint8Array,
  start: number,
  end: number,
  keys: string[],
  out: MovieMetadata,
) {
  walkBytes(bytes, start, end, (box, at, bodyStart, bodyEnd) => {
    const name = isAtomName(box.type)
      ? box.type
      : keys[viewOf(bytes).getUint32(at + 4) - 1];
    const value = readDataValue(bytes, bodyStart, bodyEnd);
    if (!name || !value) return;

    if (name === LOCATION_ATOM || name === KEY_LOCATION) {
      out.iso6709 ||= value;
    } else if (name === DAY_ATOM) {
      out.day ||= value;
    } else if (name === KEY_CREATION_DATE) {
      out.creationDate ||= value;
    }
  });
}

function scanMetadata(
  bytes: Uint8Array,
  start: number,
  end: number,
  out: MovieMetadata,
  keys: string[],
  depth: number,
) {
  if (depth > MAX_DEPTH) return;
  walkBytes(bytes, start, end, (box, _at, bodyStart, bodyEnd) => {
    switch (box.type) {
      case "udta":
        scanMetadata(bytes, bodyStart, bodyEnd, out, keys, depth + 1);
        break;
      case "meta":
        // A `keys` table names only its own `ilst`, so each `meta` starts fresh.
        scanMetadata(
          bytes,
          metaChildren(bytes, bodyStart, bodyEnd),
          bodyEnd,
          out,
          [],
          depth + 1,
        );
        break;
      case "keys":
        keys.push(...readKeys(bytes, bodyStart, bodyEnd));
        break;
      case "ilst":
        readItemList(bytes, bodyStart, bodyEnd, keys, out);
        break;
      case LOCATION_ATOM:
        out.iso6709 ||= quickTimeText(bytes, bodyStart, bodyEnd);
        break;
      case DAY_ATOM:
        out.day ||= quickTimeText(bytes, bodyStart, bodyEnd);
        break;
    }
  });
}

function readMovieHeader(body: Uint8Array) {
  if (body.length < 20) return undefined;
  const view = viewOf(body);
  let seconds: number;

  if (body[0] === 1) {
    if (body.length < 28) return undefined;
    const raw = view.getBigUint64(4);
    if (raw > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    seconds = Number(raw);
  } else {
    seconds = view.getUint32(4);
  }

  return (seconds - EPOCH_1904_OFFSET) * 1000;
}

async function readMovie(file: File, start: number, end: number) {
  const out: MovieMetadata = {};
  let offset = start;

  for (let hop = 0; hop < MAX_BOXES && offset + 8 <= end; hop += 1) {
    const box = parseHeader(await readAt(file, offset, 16), 0, end - offset);
    if (!box) break;
    const bodyStart = offset + box.headerSize;
    const bodyEnd = Math.min(offset + box.size, end);

    if (box.type === "mvhd") {
      out.createdMs = readMovieHeader(
        await readAt(file, bodyStart, MVHD_BYTES),
      );
    } else if (
      (box.type === "udta" || box.type === "meta") &&
      bodyEnd - offset <= MAX_METADATA_BYTES
    ) {
      // Pulled in whole, header included, so the scan dispatches on its type
      // the same way it does for anything nested inside it.
      const bytes = await readAt(file, offset, bodyEnd - offset);
      scanMetadata(bytes, 0, bytes.length, out, [], 0);
    }
    offset += box.size;
  }
  return out;
}

/**
 * ISO 6709, as in "+43.6520-079.4053+100.181/". Each coordinate is a signed
 * fixed-width number whose meaning depends on how many digits precede the
 * decimal point: latitude is 2 for degrees, 4 for degrees and minutes, 6 with
 * seconds — longitude one more of each, since it needs three digits of degrees.
 * Apple writes plain degrees, but the packed forms are legal and cheap to
 * accept. A trailing altitude, if present, is of no use to us.
 */
function parseIso6709(text: string | undefined) {
  const match = text?.match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/);
  if (!match) return null;

  const lat = toDegrees(match[1], 2);
  const lng = toDegrees(match[2], 3);
  if (lat === null || lng === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function toDegrees(token: string, degreeDigits: number) {
  const sign = token[0] === "-" ? -1 : 1;
  const digits = token.slice(1);
  const point = digits.indexOf(".");
  const whole = point === -1 ? digits.length : point;

  // How many digits sit to the left of the decimal point beyond the degrees
  // says which form this is. Only the final component is fractional, so every
  // component before it is exactly two digits wide.
  const degrees = Number(digits.slice(0, degreeDigits));
  const minutesEnd = degreeDigits + 2;
  let value: number;

  switch (whole - degreeDigits) {
    case 0:
      value = Number(digits);
      break;
    case 2:
      value = degrees + Number(digits.slice(degreeDigits)) / 60;
      break;
    case 4:
      value =
        degrees +
        Number(digits.slice(degreeDigits, minutesEnd)) / 60 +
        Number(digits.slice(minutesEnd)) / 3600;
      break;
    default:
      return null;
  }
  return Number.isFinite(value) ? sign * value : null;
}

function isoIfPlausible(ms: number | undefined) {
  if (
    ms === undefined ||
    !Number.isFinite(ms) ||
    ms < EARLIEST ||
    ms > LATEST
  ) {
    return null;
  }
  return new Date(ms).toISOString();
}

/**
 * Dates come in three shapes: "2026-08-08T14:51:50-0400" from a phone, the same
 * with a colon in the offset, and the EXIF spelling "2026:08:08 14:51:50" that
 * some cameras carry over into video. Only the middle one is a date JS is
 * required to parse, so the other two are rewritten into it. An offset that is
 * missing entirely leaves a wall-clock reading, which Date resolves against the
 * viewer's zone — the closest guess available once the camera has thrown the
 * real one away.
 */
function parseCaptureDate(text: string | undefined) {
  if (!text) return null;
  const normalized = text
    .trim()
    .replace(/^(\d{4}):(\d{2}):(\d{2})[ T]/, "$1-$2-$3T")
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  return isoIfPlausible(Date.parse(normalized));
}

export async function readVideoCapture(file: File): Promise<VideoCapture> {
  let found: MovieMetadata = {};

  try {
    const moov = await findBox(file, 0, file.size, "moov");
    if (moov) found = await readMovie(file, moov.start, moov.end);
  } catch {
    // Not an ISO base media file, or one that ends mid-box. Both are ordinary
    // things for someone to hand us, and both are answered the same way: the
    // nulls below, which put the caller on the ask-them-directly path.
  }

  return {
    // The camera's own answer first. `mvhd` is a weaker one — it records when
    // the file was finalized, so it runs the length of the video late — and the
    // filesystem's is weaker still, being about the copy rather than the shoot.
    capturedAt:
      parseCaptureDate(found.creationDate) ??
      parseCaptureDate(found.day) ??
      isoIfPlausible(found.createdMs) ??
      isoIfPlausible(file.lastModified),
    location: parseIso6709(found.iso6709),
  };
}
