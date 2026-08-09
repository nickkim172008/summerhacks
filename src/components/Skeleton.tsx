/**
 * Placeholders that hold the shape of what is coming.
 *
 * Every one of these mirrors the geometry of the real thing it stands in for —
 * same aspect ratio, same corner radius, same gap, same two lines of caption
 * underneath. That is the whole point: when the data lands, the blocks are
 * swapped for content that occupies exactly the space already reserved, so
 * nothing on the page moves. A spinner or a line of "Loading…" reserves
 * nothing, which is why every screen using one jumps at the moment it fills.
 *
 * They are deliberately not links, not focusable, and hidden from screen
 * readers: there is nothing here to read or click, and a reader announcing
 * twelve empty boxes is worse than it announcing nothing. The pages that use
 * these carry the real status message for assistive tech.
 */
import { Fragment } from "react";

/** Widths kept off the 100% mark so a stack of lines reads as text, not bars. */
function Line({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-md ${className}`} />;
}

/** The 4:3 raised cover the library and profile grids use for a journey. */
export function AlbumCardSkeleton() {
  return (
    <li aria-hidden>
      <div className="skeleton aspect-[4/3] rounded-2xl" />
      <Line className="mt-3 h-[19px] w-3/5" />
      <Line className="mt-1.5 h-[13px] w-2/5" />
    </li>
  );
}

/** One capture in the album grid: square, then name and date. */
export function PlaceTileSkeleton() {
  return (
    <li aria-hidden>
      <div className="skeleton aspect-square rounded-[14px]" />
      <Line className="mt-2.5 h-[17px] w-2/3" />
      <Line className="mt-1.5 h-[13px] w-1/2" />
    </li>
  );
}

/** The dense, caption-less grid on a profile's Places tab. */
export function PlaceSquareSkeleton() {
  return (
    <li aria-hidden>
      <div className="skeleton aspect-square rounded-xl" />
    </li>
  );
}

/** A person card on Discover: avatar, name, handle, bio. */
export function PersonRowSkeleton() {
  return (
    <li aria-hidden>
      <div className="flex items-center gap-3.5 rounded-2xl border border-[rgba(20,22,26,0.09)] bg-white p-4 shadow-[0_1px_2px_rgba(20,22,26,0.04)]">
        <div className="skeleton h-12 w-12 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <Line className="h-[18px] w-1/2" />
          <Line className="mt-2 h-[13px] w-1/3" />
        </div>
      </div>
    </li>
  );
}

/** A trashed capture: thumbnail, name, and the room its buttons occupy. */
export function TrashRowSkeleton() {
  return (
    <li
      aria-hidden
      className="flex items-center gap-4 rounded-2xl border border-[rgba(20,22,26,0.09)] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(20,22,26,0.04)]"
    >
      <div className="skeleton h-14 w-14 shrink-0 rounded-xl" />
      <Line className="h-[19px] w-1/3" />
      <div className="flex-1" />
      <div className="skeleton h-9 w-[104px] shrink-0 rounded-full" />
    </li>
  );
}

/** A notification: who, what they did, and when. */
export function NotificationRowSkeleton() {
  return (
    <li aria-hidden className="flex items-center gap-3.5 py-4">
      <div className="skeleton h-11 w-11 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        <Line className="h-[15px] w-2/5" />
        <Line className="mt-2 h-[13px] w-1/4" />
      </div>
    </li>
  );
}

/**
 * The feed's single card. It fills the column the way a real one does, so the
 * chevrons and the header above it do not shift when the first place arrives.
 */
export function FeedCardSkeleton() {
  return (
    <div
      aria-hidden
      className="skeleton h-full w-full rounded-2xl shadow-[0_2px_4px_rgba(20,22,26,0.06),0_20px_40px_-24px_rgba(20,22,26,0.5)]"
    />
  );
}

/** A profile's masthead: portrait, name, handle, bio, and the three counts. */
export function ProfileHeaderSkeleton() {
  return (
    <div
      aria-hidden
      className="mt-5 flex items-start gap-7 border-b border-[rgba(20,22,26,0.09)] pb-7"
    >
      <div className="skeleton h-[132px] w-[132px] shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 pt-2">
        <Line className="h-[40px] w-2/5 rounded-lg" />
        <Line className="mt-3 h-[15px] w-1/4" />
        <Line className="mt-4 h-[14px] w-3/5" />
        <div className="mt-6 flex gap-9">
          <Line className="h-[38px] w-16 rounded-lg" />
          <Line className="h-[38px] w-16 rounded-lg" />
          <Line className="h-[38px] w-16 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/**
 * A row of identical placeholders.
 *
 * `count` is a guess at how much is coming, and it only has to be close: too
 * few and the grid grows a little when the data lands, too many and it
 * shrinks. Sized here to fill the fold on a normal window without inventing a
 * second screenful of content that may not exist.
 */
export function SkeletonList({
  count,
  className,
  item,
}: {
  count: number;
  /** The real grid's own classes, so the placeholder inherits its layout. */
  className: string;
  /** Returns the <li> to repeat — every skeleton row above is one. */
  item: () => React.ReactNode;
}) {
  return (
    <ul className={`fade-in ${className}`} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <Fragment key={i}>{item()}</Fragment>
      ))}
    </ul>
  );
}
