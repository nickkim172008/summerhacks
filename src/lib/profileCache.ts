"use client";

import { useEffect, useMemo, useState } from "react";
import { getProfile } from "./profiles";
import type { Profile } from "./types";

/**
 * Resolves uids to profiles, one lookup per uid, kept across renders.
 *
 * Firestore cannot join, so anything holding uids — follow edges, notification
 * actors — has to fetch the profiles separately. Ids already resolved are never
 * refetched, and a failed lookup is cached as null rather than retried forever.
 */
export function useProfilesByIds(ids: string[]) {
  const [profiles, setProfiles] = useState<Record<string, Profile | null>>({});
  const key = useMemo(() => [...new Set(ids)].sort().join(","), [ids]);

  useEffect(() => {
    const wanted = key ? key.split(",") : [];
    let active = true;
    const missing = wanted.filter((id) => !(id in profiles));
    if (missing.length === 0) return;

    Promise.all(
      missing.map(
        async (id) => [id, await getProfile(id).catch(() => null)] as const,
      ),
    ).then((pairs) => {
      if (!active) return;
      setProfiles((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
    });

    return () => {
      active = false;
    };
    // profiles is written by this effect; depending on it would re-run the
    // lookup every time one resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return profiles;
}
