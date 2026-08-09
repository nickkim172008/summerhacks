"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { subscribeToFollowers, subscribeToFollowing } from "@/lib/follows";
import { useProfilesByIds } from "@/lib/profileCache";
import Avatar from "@/components/Avatar";
import type { Follow } from "@/lib/types";

export type FollowListKind = "followers" | "following";

const TITLE: Record<FollowListKind, string> = {
  followers: "Followers",
  following: "Following",
};

const EMPTY: Record<FollowListKind, string> = {
  followers: "No followers yet.",
  following: "Not following anyone yet.",
};

export default function FollowListDialog({
  uid,
  kind,
  onClose,
}: {
  uid: string;
  kind: FollowListKind;
  onClose: () => void;
}) {
  const [edges, setEdges] = useState<Follow[] | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    setEdges(null);
    setDenied(false);
    const fail = () => {
      setEdges([]);
      setDenied(true);
    };
    return kind === "followers"
      ? subscribeToFollowers(uid, setEdges, fail)
      : subscribeToFollowing(uid, setEdges, fail);
  }, [uid, kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A follower edge names the other party in followerId; a following edge in
  // followingId. Same collection read from opposite ends.
  const otherIds = (edges ?? []).map((edge) =>
    kind === "followers" ? edge.followerId : edge.followingId,
  );
  const profiles = useProfilesByIds(otherIds);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-6"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={TITLE[kind]}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-black/10 px-5 py-3">
          <h3 className="text-[17px] font-semibold">{TITLE[kind]}</h3>
          <button
            onClick={onClose}
            className="text-[17px] text-[#0071e3] transition hover:opacity-70"
          >
            Done
          </button>
        </div>

        <div className="overflow-y-auto px-5">
          {edges === null ? (
            <p className="py-10 text-center text-sm text-neutral-500">
              Loading…
            </p>
          ) : denied ? (
            <p className="py-10 text-center text-sm text-amber-600">
              Couldn&apos;t load this list.
            </p>
          ) : edges.length === 0 ? (
            <p className="py-10 text-center text-sm text-neutral-500">
              {EMPTY[kind]}
            </p>
          ) : (
            <ul className="divide-y divide-black/5">
              {otherIds.map((id) => {
                const profile = profiles[id];
                return (
                  <li key={id}>
                    {profile ? (
                      <Link
                        href={`/u/${profile.username}`}
                        onClick={onClose}
                        className="flex items-center gap-3 py-3 transition hover:opacity-70"
                      >
                        <Avatar
                          profile={profile}
                          className="h-10 w-10"
                          textClassName="text-[14px]"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[15px] font-medium">
                            {profile.displayName}
                          </p>
                          <p className="truncate text-[13px] text-neutral-500">
                            @{profile.username}
                          </p>
                        </div>
                      </Link>
                    ) : (
                      // Resolved to null means the account is gone; still
                      // undefined means the lookup is in flight.
                      <div className="flex items-center gap-3 py-3">
                        <div className="h-10 w-10 shrink-0 rounded-full bg-neutral-100" />
                        <p className="text-[15px] text-neutral-400">
                          {profile === null ? "Deleted account" : "Loading…"}
                        </p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
