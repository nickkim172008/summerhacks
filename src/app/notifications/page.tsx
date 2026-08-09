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
    <main className="min-h-screen bg-[#FAF9F7] text-[#14161A]">
      <div className="mx-auto max-w-[1152px] px-8 pb-16">
        <h1 className="mt-10 font-display text-[40px] font-normal leading-[40px] tracking-[-0.02em]">
          Notifications
        </h1>

        {authLoading || !user ? (
          <p className="mt-8 text-[15px] text-[#6B7178]">Loading…</p>
        ) : items.length === 0 ? (
          <div className="mt-16 text-center">
            <p className="text-[20px] font-semibold leading-[26px] tracking-[-0.01em]">
              Nothing yet
            </p>
            <p className="mx-auto mt-2 max-w-sm text-[15px] leading-6 text-[#6B7178]">
              New followers show up here, along with places captured by
              the people you follow and journey invites waiting on a reply.
            </p>
            <Link
              href="/discover"
              className="mt-6 inline-flex h-10 items-center rounded-full bg-[#14161A] px-5 text-[15px] font-medium text-white transition hover:bg-[#2A2E35]"
            >
              Find people to follow
            </Link>
          </div>
        ) : (
          <ul className="mt-8 divide-y divide-[rgba(20,22,26,0.09)]">
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
        <div className="h-11 w-11 shrink-0 rounded-full bg-[rgba(20,22,26,0.05)]" />
      )}

      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-6">
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
        <p className="mt-0.5 text-[13px] leading-[18px] tabular-nums text-[#6B7178]">
          {item.at > 0 ? timeAgo(item.at) : "Just now"}
        </p>
      </div>

      {item.kind === "place" && (
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-[rgba(20,22,26,0.05)]">
          <PlaceThumb place={item.place} />
        </div>
      )}

      {isNew && (
        // The notification dot is the one place blue marks "there is something
        // new here" — the same mark the bell in the top bar carries.
        <span
          aria-label="New"
          className="h-2 w-2 shrink-0 rounded-full bg-[#0071E3]"
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
          className="flex items-center gap-4 py-4 transition hover:opacity-70"
        >
          {body}
        </Link>
      ) : (
        <div className="flex items-center gap-4 py-4">{body}</div>
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
      setError("Couldn’t join that journey.");
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
    <div className="py-4">
      <div className="flex items-center gap-4">
        {actor ? (
          <Avatar
            profile={actor}
            className="h-11 w-11"
            textClassName="text-[15px]"
          />
        ) : (
          <div className="h-11 w-11 shrink-0 rounded-full bg-[rgba(20,22,26,0.05)]" />
        )}

        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-6">
            <span className="font-medium">{name}</span>
            {" invited you to "}
            <span className="font-medium">{item.album.name}</span>.
          </p>
          <p className="mt-0.5 text-[13px] leading-[18px] tabular-nums text-[#6B7178]">
            {item.at > 0 ? timeAgo(item.at) : "Just now"}
          </p>
        </div>

        {isNew && (
          <span
            aria-label="New"
            className="h-2 w-2 shrink-0 rounded-full bg-[#0071E3]"
          />
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 pl-[60px]">
        <button
          type="button"
          onClick={() => void accept()}
          disabled={busy !== null}
          className="h-9 rounded-full bg-[#14161A] px-4 text-[14px] font-medium text-white transition hover:bg-[#2A2E35] disabled:opacity-40"
        >
          {busy === "accept" ? "Joining…" : "Accept"}
        </button>
        <button
          type="button"
          onClick={() => void decline()}
          disabled={busy !== null}
          className="h-9 rounded-full border border-[rgba(20,22,26,0.14)] bg-white px-4 text-[14px] font-medium text-[#4A4F57] transition hover:bg-[rgba(20,22,26,0.05)] disabled:opacity-40"
        >
          {busy === "decline" ? "…" : "Decline"}
        </button>
      </div>
      {error && (
        <p className="mt-2 pl-[60px] text-[13px] text-[#C0362C]">{error}</p>
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
