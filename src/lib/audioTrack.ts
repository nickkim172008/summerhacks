/**
 * Lifts the audio track out of a walkthrough video so a place can play back the
 * room it was captured in. Entirely client-side: decodeAudioData reads the
 * audio straight out of an mp4/mov container, so there is no transcoding
 * service to stand up and the source video never leaves the browser.
 */

/**
 * Half of CD rate, mono, 16-bit — 44100 bytes a second, so a minute of
 * walkthrough stores as 2.6 MB against the source video's hundreds. Voices and
 * room tone survive the trip down, and that is all this track carries.
 */
const SAMPLE_RATE = 22050;

export interface ExtractedAudio {
  file: File;
  seconds: number;
}

type OfflineCtor = typeof OfflineAudioContext;

/**
 * Null is an ordinary answer, not a failure: a video may carry no audio track
 * at all, and some phone codecs are ones this browser cannot open. Callers save
 * the place silent rather than losing the capture over it.
 */
export async function extractAudio(
  video: File,
  baseName: string,
): Promise<ExtractedAudio | null> {
  const Ctor = offlineCtor();
  if (!Ctor) return null;

  const decoded = await decode(Ctor, await video.arrayBuffer());
  if (!decoded || decoded.length === 0) return null;

  // One render does both jobs: a destination declared with a single channel
  // applies the standard speaker down-mix, and a source buffer whose rate
  // differs from its context's is resampled on the way through.
  const ctx = new Ctor(
    1,
    Math.ceil(decoded.duration * SAMPLE_RATE),
    SAMPLE_RATE,
  );
  const source = ctx.createBufferSource();
  source.buffer = decoded;
  source.connect(ctx.destination);
  source.start();
  const mono = await ctx.startRendering();

  const wav = encodeWav(mono.getChannelData(0));
  return {
    file: new File([wav], `${baseName}.wav`, { type: "audio/wav" }),
    seconds: mono.duration,
  };
}

async function decode(Ctor: OfflineCtor, bytes: ArrayBuffer) {
  // Decoding wants no output device, so going offline sidesteps the autoplay
  // policy and leaves no hardware context open behind the upload.
  const ctx = new Ctor(1, 1, SAMPLE_RATE);
  try {
    return await ctx.decodeAudioData(bytes);
  } catch {
    return null; // Unreadable container, or no audio track inside it.
  }
}

/** Safari shipped this prefixed for years; undefined also covers server render. */
function offlineCtor(): OfflineCtor | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: OfflineCtor })
      .webkitOfflineAudioContext
  );
}

/**
 * The canonical 44-byte RIFF header followed by little-endian 16-bit samples.
 * Uncompressed WAV plays everywhere without a codec, which is what the bytes
 * buy, and writing it by hand keeps the encoder dependency-free.
 */
function encodeWav(samples: Float32Array): ArrayBuffer {
  const dataBytes = samples.length * 2;
  const bytes = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(bytes);

  ascii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true); // byte count of everything after this field
  ascii(view, 8, "WAVE");
  ascii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk length
  view.setUint16(20, 1, true); // uncompressed PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  ascii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i++) {
    // A down-mix can land a hair outside unity; unclamped, those samples wrap
    // to the opposite sign and click.
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

function ascii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
