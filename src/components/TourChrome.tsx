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

/** The same smoked glass the rest of the viewer's chrome is cut from. */
const GLASS =
  "border border-[rgba(255,255,255,0.16)] bg-[rgba(14,16,19,0.5)] backdrop-blur-[14px]";
const GLASS_BUTTON = `${GLASS} transition-colors duration-150 ease-[ease] hover:bg-[rgba(14,16,19,0.68)] disabled:opacity-40`;

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
        className={`absolute left-6 top-5 z-50 flex h-[38px] items-center gap-2 rounded-full px-[18px] text-[14px] font-medium text-white ${GLASS_BUTTON}`}
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M15 5l-7 7 7 7" />
        </svg>
        Exit
      </button>

      {/* Clear of Exit rather than centred over it: on a narrow screen there is
          not room for both on one line, so this drops below instead. The step
          count sits with the rest of the viewer's chrome, top right. */}
      <div className="pointer-events-none absolute inset-x-0 top-[70px] z-40 flex justify-center px-6 sm:top-5 sm:px-48">
        <div
          className={`flex h-[38px] max-w-full items-center rounded-full px-4 ${GLASS}`}
        >
          <p className="truncate text-[14px] font-medium leading-none text-white">
            {albumName}
          </p>
        </div>
      </div>

      <div className="absolute bottom-6 right-6 z-50 flex items-center gap-2.5">
        {/* The one instruction this screen needs. Dropped on a narrow window,
            where the controls already fill the row. */}
        <span
          className={`hidden h-[38px] items-center rounded-full px-4 text-[13px] text-[rgba(255,255,255,0.78)] sm:flex ${GLASS}`}
        >
          Drag to look around
        </span>

        <button
          onClick={onTogglePause}
          disabled={fading}
          aria-label={
            paused ? "Resume the walkthrough" : "Pause the walkthrough"
          }
          className={`flex h-[38px] w-[38px] items-center justify-center rounded-full text-white ${GLASS_BUTTON}`}
        >
          {paused ? (
            <svg
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="currentColor"
              aria-hidden
            >
              <path d="M7 4.5l12 7.5-12 7.5z" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="currentColor"
              aria-hidden
            >
              <path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" />
            </svg>
          )}
        </button>

        <button
          onClick={onPrevious}
          disabled={!onPrevious || fading}
          className={`flex h-[38px] items-center rounded-full px-[18px] text-[14px] font-medium text-white ${GLASS_BUTTON}`}
        >
          Previous
        </button>

        <button
          onClick={onNext}
          disabled={fading}
          className="flex h-[38px] items-center gap-2 rounded-full bg-[#0071E3] px-5 text-[14px] font-medium text-white shadow-[0_6px_18px_-8px_rgba(0,113,227,0.8)] transition-colors duration-150 ease-[ease] hover:bg-[#0077ED] disabled:opacity-40"
        >
          <CountdownRing progress={progress} />
          {last ? "Finish" : "Next place"}
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M9 5l7 7-7 7" />
          </svg>
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
