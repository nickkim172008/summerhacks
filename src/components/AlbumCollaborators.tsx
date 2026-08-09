"use client";

import { useEffect, useState } from "react";
import { albumMemberIds } from "@/lib/albums";
import { getProfile } from "@/lib/profiles";
import Avatar from "@/components/Avatar";
import type { Album, Profile } from "@/lib/types";

/** How many faces fit on the cover before the rest collapse into +N. */
const MAX_FACES = 4;

/**
 * Collaborator faces for the bottom-left of an album cover in the library.
 * Decorative only — the cover itself is the link into the album, so these are
 * not nested profile links. Owner first, then everyone else in membership
 * order.
 */
export default function AlbumCollaborators({ album }: { album: Album }) {
  const memberIds = albumMemberIds(album);
  const ordered = [
    album.ownerId,
    ...memberIds.filter((id) => id !== album.ownerId),
  ];
  const [profiles, setProfiles] = useState<Profile[] | null>(null);

  const key = ordered.join(",");
  useEffect(() => {
    let active = true;
    const ids = key ? key.split(",") : [];
    Promise.all(ids.map((id) => getProfile(id)))
      .then((found) => {
        if (active) {
          setProfiles(found.filter((p): p is Profile => Boolean(p)));
        }
      })
      .catch(() => {
        if (active) setProfiles([]);
      });
    return () => {
      active = false;
    };
  }, [key]);

  if (!profiles || profiles.length === 0) return null;

  const shown = profiles.slice(0, MAX_FACES);
  const extra = profiles.length - shown.length;

  return (
    <div className="pointer-events-none absolute bottom-2.5 left-2.5 flex items-center">
      <div className="flex flex-row-reverse">
        {extra > 0 && (
          <span className="relative z-0 -ml-[7px] flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[rgba(20,22,26,0.72)] text-[10px] font-semibold tabular-nums text-white shadow-[0_0_0_2px_#FAF9F7]">
            +{extra}
          </span>
        )}
        {[...shown].reverse().map((profile, index) => (
          <span
            key={profile.id}
            title={
              profile.id === album.ownerId
                ? `@${profile.username} · owner`
                : `@${profile.username}`
            }
            className="relative -ml-[7px] first:ml-0 rounded-full shadow-[0_0_0_2px_#FAF9F7]"
            style={{ zIndex: shown.length - index }}
          >
            <Avatar
              profile={profile}
              className="h-[22px] w-[22px]"
              textClassName="text-[10px]"
            />
          </span>
        ))}
      </div>
    </div>
  );
}
