"use client";

export interface TourChromeProps {
  albumName: string;
  /** Zero-based; shown as "3 of 7". */
  index: number;
  total: number;
  /** 0..1 of this capture's hold, drawn as the ring on Next. */
  progress: number;
  paused: boolean;
  /** True while the walkthrough is fading between captures. */
  fading: boolean;
  onPrevious?: () => void;
  onNext: () => void;
  onTogglePause: () => void;
  onExit: () => void;
}

const RING_RADIUS = 13;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * The controls a hands-off walkthrough needs, laid over whichever capture is
 * playing. It owns no timing of its own — the countdown arrives as `progress`
 * — so the ring can never disagree with the clock that is actually running.
 */
export default function TourChrome({
  albumName,
  index,
  total,
  progress,
  paused,
  fading,
  onPrevious,
  onNext,
  onTogglePause,
  onExit,
}: TourChromeProps) {
  const last = index >= total - 1;

  return (
    <>
      <button
        onClick={onExit}
        className="absolute left-4 top-4 z-50 flex items-center gap-1 rounded-full bg-white/90 px-4 py-2 text-[15px] text-[#0071e3] shadow-sm backdrop-blur transition hover:bg-white"
      >
        <span aria-hidden className="text-xl leading-none">
          ‹
        </span>
        Exit
      </button>

      {/* Clear of Exit rather than centred over it: on a narrow screen there is
          not room for both on one line, so this drops below instead. */}
      <div className="pointer-events-none absolute inset-x-0 top-16 z-40 flex justify-center px-4 sm:top-4 sm:px-24">
        <div className="max-w-full rounded-full bg-neutral-900/85 px-4 py-2 text-center backdrop-blur">
          <p className="truncate text-[15px] font-medium leading-tight text-white">
            {albumName}
          </p>
          <p className="text-[13px] leading-tight text-neutral-400">
            {index + 1} of {total}
            {/* Said out loud, because a ring that has stopped filling looks
                identical to one that is simply slow. */}
            {paused && " · paused"}
          </p>
        </div>
      </div>

      <div className="absolute bottom-4 right-4 z-50 flex items-center gap-2">
        <button
          onClick={onTogglePause}
          disabled={fading}
          aria-label={
            paused ? "Resume the walkthrough" : "Pause the walkthrough"
          }
          className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-900/85 text-[13px] text-white backdrop-blur transition hover:bg-neutral-900 disabled:opacity-40"
        >
          {paused ? "▶" : "❚❚"}
        </button>

        <button
          onClick={onPrevious}
          disabled={!onPrevious || fading}
          className="rounded-full bg-neutral-900/85 px-4 py-2.5 text-[15px] text-white backdrop-blur transition hover:bg-neutral-900 disabled:opacity-40"
        >
          Previous
        </button>

        <button
          onClick={onNext}
          disabled={fading}
          className="flex items-center gap-2 rounded-full bg-[#0071e3] py-2 pl-3 pr-4 text-[15px] font-medium text-white transition hover:bg-[#0077ed] disabled:opacity-40"
        >
          <CountdownRing progress={progress} />
          {last ? "Finish" : "Next"}
        </button>
      </div>
    </>
  );
}

/**
 * How much of the hold is left, on the button the hold is about to press. The
 * jump is the one thing in a hands-off walkthrough nobody asked for, so it has
 * to be visible coming.
 */
function CountdownRing({ progress }: { progress: number }) {
  const filled = Math.min(1, Math.max(0, progress));
  return (
    <svg
      viewBox="0 0 30 30"
      aria-hidden
      className="h-[1.375rem] w-[1.375rem] -rotate-90"
    >
      <circle
        cx="15"
        cy="15"
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.3}
        strokeWidth={3}
      />
      <circle
        cx="15"
        cy="15"
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={RING_LENGTH}
        strokeDashoffset={RING_LENGTH * (1 - filled)}
      />
    </svg>
  );
}
