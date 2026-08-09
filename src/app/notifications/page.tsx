"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthProfile } from "@/lib/auth";
import {
  acceptAlbumInvite,
  declineAlbumInvite,
} from "@/lib/albums";
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
              the people you follow and album invites waiting on a reply.
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
                viewerId={user.uid}
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
  viewerId,
  isNew,
}: {
  item: Notification;
  actor: Profile | null | undefined;
  viewerId: string;
  isNew: boolean;
}) {
  // Until the lookup lands there is no handle to link to, so the row shows a
  // neutral placeholder rather than a broken /u/undefined link.
  const name = actor?.displayName ?? "Someone";
  const href = actor ? `/u/${actor.username}` : null;

  if (item.kind === "album_invite") {
    return (
      <li>
        <AlbumInviteRow
          item={item}
          actor={actor}
          name={name}
          viewerId={viewerId}
          isNew={isNew}
        />
      </li>
    );
  }

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

  const target =
    item.kind === "place" ? `/place/${item.place.id}` : href;

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

function AlbumInviteRow({
  item,
  actor,
  name,
  viewerId,
  isNew,
}: {
  item: Extract<Notification, { kind: "album_invite" }>;
  actor: Profile | null | undefined;
  name: string;
  viewerId: string;
  isNew: boolean;
}) {
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function accept() {
    if (busy) return;
    setBusy("accept");
    setError(null);
    try {
      await acceptAlbumInvite(item.album, viewerId);
      router.push(`/album/${item.album.id}`);
    } catch {
      setError("Couldn’t join that album.");
      setBusy(null);
    }
  }

  async function decline() {
    if (busy) return;
    setBusy("decline");
    setError(null);
    try {
      await declineAlbumInvite(item.album, viewerId);
    } catch {
      setError("Couldn’t decline that invite.");
      setBusy(null);
    }
  }

  return (
    <div className="py-3">
      <div className="flex items-center gap-3">
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
            {" invited you to "}
            <span className="font-medium">{item.album.name}</span>.
          </p>
          <p className="mt-0.5 text-[13px] text-neutral-500">
            {item.at > 0 ? timeAgo(item.at) : "Just now"}
          </p>
        </div>

        {isNew && (
          <span
            aria-label="New"
            className="h-2 w-2 shrink-0 rounded-full bg-[#0071e3]"
          />
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 pl-14">
        <button
          type="button"
          onClick={() => void accept()}
          disabled={busy !== null}
          className="rounded-full bg-[#0071e3] px-4 py-1.5 text-[13px] font-medium text-white transition hover:bg-[#0077ed] disabled:opacity-40"
        >
          {busy === "accept" ? "Joining…" : "Accept"}
        </button>
        <button
          type="button"
          onClick={() => void decline()}
          disabled={busy !== null}
          className="rounded-full border border-black/10 px-4 py-1.5 text-[13px] font-medium text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-40"
        >
          {busy === "decline" ? "…" : "Decline"}
        </button>
      </div>
      {error && (
        <p className="mt-2 pl-14 text-[13px] text-red-500">{error}</p>
      )}
    </div>
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
