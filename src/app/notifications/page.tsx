"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthProfile } from "@/lib/auth";
import {
  markAllSeen,
  useActorProfiles,
  useNotifications,
  type Notification,
} from "@/lib/notifications";
import Avatar from "@/components/Avatar";
import PlaceThumb from "@/components/PlaceThumb";
import type { Profile } from "@/lib/types";

export default function NotificationsPage() {
  const router = useRouter();
  const { user, loading: authLoading, needsUsername } = useAuthProfile();
  const { items, seenAt } = useNotifications(user?.uid);
  const profiles = useActorProfiles(items.map((item) => item.actorId));

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/signin");
      return;
    }
    if (needsUsername) router.replace("/setup");
  }, [authLoading, needsUsername, router, user]);

  // Cleared on leaving rather than on arrival, so the "new" markers stay
  // visible the whole time the list is being read.
  useEffect(() => {
    if (!user) return;
    return () => markAllSeen(user.uid);
  }, [user]);

  return (
    <main className="min-h-screen bg-white pb-24 text-[#1d1d1f]">
      <div className="mx-auto max-w-2xl px-6">
        <h1 className="mt-8 text-[34px] font-bold tracking-tight">
          Notifications
        </h1>

        {authLoading || !user ? (
          <p className="mt-6 text-neutral-500">Loading…</p>
        ) : items.length === 0 ? (
          <div className="mt-16 text-center">
            <p className="text-[17px] font-semibold">Nothing yet</p>
            <p className="mx-auto mt-2 max-w-xs text-sm text-neutral-500">
              New followers show up here, along with environments captured by
              the people you follow and albums they add you to.
            </p>
            <Link
              href="/discover"
              className="mt-5 inline-block rounded-full bg-[#0071e3] px-5 py-2 text-sm font-medium text-white transition hover:bg-[#0077ed]"
            >
              Find people to follow
            </Link>
          </div>
        ) : (
          <ul className="mt-6 divide-y divide-black/5">
            {items.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                actor={profiles[item.actorId]}
                isNew={item.at > 0 && item.at > seenAt}
              />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function NotificationRow({
  item,
  actor,
  isNew,
}: {
  item: Notification;
  actor: Profile | null | undefined;
  isNew: boolean;
}) {
  // Until the lookup lands there is no handle to link to, so the row shows a
  // neutral placeholder rather than a broken /u/undefined link.
  const name = actor?.displayName ?? "Someone";
  const href = actor ? `/u/${actor.username}` : null;

  const body = (
    <>
      {actor ? (
        <Avatar
          profile={actor}
          className="h-11 w-11"
          textClassName="text-[15px]"
        />
      ) : (
        <div className="h-11 w-11 shrink-0 rounded-full bg-neutral-100" />
      )}

      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-snug">
          <span className="font-medium">{name}</span>
          {item.kind === "follow" ? (
            " started following you."
          ) : item.kind === "album" ? (
            <>
              {" added you to "}
              <span className="font-medium">{item.album.name}</span>.
            </>
          ) : (
            <>
              {" captured "}
              <span className="font-medium">{item.place.name}</span>.
            </>
          )}
        </p>
        <p className="mt-0.5 text-[13px] text-neutral-500">
          {item.at > 0 ? timeAgo(item.at) : "Just now"}
        </p>
      </div>

      {item.kind === "place" && (
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-neutral-100">
          <PlaceThumb place={item.place} />
        </div>
      )}

      {isNew && (
        <span
          aria-label="New"
          className="h-2 w-2 shrink-0 rounded-full bg-[#0071e3]"
        />
      )}
    </>
  );

  // Each row points at the thing it is about: the capture, the shared album,
  // or — for a new follow — whoever did the following.
  const target =
    item.kind === "place"
      ? `/place/${item.place.id}`
      : item.kind === "album"
        ? `/album/${item.album.id}`
        : href;

  return (
    <li>
      {target ? (
        <Link
          href={target}
          className="flex items-center gap-3 py-3 transition hover:opacity-70"
        >
          {body}
        </Link>
      ) : (
        <div className="flex items-center gap-3 py-3">{body}</div>
      )}
    </li>
  );
}

function timeAgo(at: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(at).toLocaleDateString();
}
