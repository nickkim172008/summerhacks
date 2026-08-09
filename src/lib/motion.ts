/**
 * Shared timing for content that arrives in a list.
 *
 * The animation itself lives in globals.css as `.rise`; this is only the
 * stagger, because the delay depends on position and CSS has no way to ask
 * where in a list an element sits.
 */
import type { CSSProperties } from "react";

/** Between one tile and the next. Below about 30ms the stagger stops reading
 *  as a sequence and just looks like an uneven load. */
const STEP_MS = 45;

/**
 * The cap, and the reason this helper exists rather than `index * STEP_MS`
 * inline. A journey can hold hundreds of places, and uncapped the last tile of
 * a large grid would arrive some ten seconds after the first — long enough
 * that a viewer who scrolled straight down would watch an empty page fill in
 * ahead of them. Capped, the whole grid has settled within a third of a second
 * however much of it there is.
 */
const CAP_MS = 300;

export function riseDelay(index: number): CSSProperties {
  return { animationDelay: `${Math.min(index * STEP_MS, CAP_MS)}ms` };
}
