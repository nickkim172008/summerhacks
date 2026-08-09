"use client";

import { useEffect, useMemo, useState } from "react";
import { subscribeToFollowers, subscribeToFollowingIds } from "./follows";
import { subscribeToPlacesByUploaders } from "./places";
import type { Follow, Place } from "./types";

/**
 * Notifications are derived from the follows and places collections rather than
 * stored as their own documents.
 *
 * Writing them would mean fanning out on every capture — the uploader writing a
 * doc into each follower's inbox — which no security rule can tell apart from a
 * client forging notifications for strangers. Server-side fan-out is the usual
 * answer and this project has no Cloud Functions, so the feed is assembled from
 * the source of truth instead. It costs a few extra listeners and needs no new
 * rules, and nothing can be faked into someone else's inbox.
 */
export type Notification =
  | { kind: "follow"; id: string; at: number; actorId: string }
  | { kind: "place"; id: string; at: number; actorId: string; place: Place };

/** Anything older than this was almost certainly already seen. */
const MAX_ITEMS = 50;

function seenKey(uid: string) {
  return `atlas:notifications-seen:${uid}`;
}

export function readSeenAt(uid: string): number {
  if (typeof window === "undefined") return 0;
  return Number(window.localStorage.getItem(seenKey(uid)) ?? 0);
}

export function markAllSeen(uid: string, at: number = Date.now()) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(seenKey(uid), String(at));
  // localStorage does not fire storage events in the tab that wrote it.
  window.dispatchEvent(new CustomEvent("atlas:notifications-seen"));
}

function millis(at: { toMillis?: () => number } | null | undefined) {
  return at?.toMillis?.() ?? 0;
}

/**
 * The merged feed, newest first, plus how many postdate the last visit to the
 * inbox. Actor profiles are resolved separately so a slow lookup never holds
 * the list back.
 */
export function useNotifications(uid: string | undefined) {
  const [followers, setFollowers] = useState<Follow[]>([]);
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [seenAt, setSeenAt] = useState(0);

  useEffect(() => {
    if (!uid) {
      setFollowers([]);
      setFollowingIds([]);
      return;
    }
    const offFollowers = subscribeToFollowers(uid, setFollowers, () =>
      setFollowers([]),
    );
    const offFollowing = subscribeToFollowingIds(uid, setFollowingIds, () =>
      setFollowingIds([]),
    );
    return () => {
      offFollowers();
      offFollowing();
    };
  }, [uid]);

  // Joined on the client because Firestore cannot join: the ids come from one
  // collection and the places from another.
  const followingKey = useMemo(
    () => [...followingIds].sort().join(","),
    [followingIds],
  );
  useEffect(() => {
    if (!uid) {
      setPlaces([]);
      return;
    }
    const ids = followingKey ? followingKey.split(",") : [];
    return subscribeToPlacesByUploaders(ids, setPlaces, () => setPlaces([]));
  }, [uid, followingKey]);

  useEffect(() => {
    if (!uid) return;
    const sync = () => setSeenAt(readSeenAt(uid));
    sync();
    window.addEventListener("atlas:notifications-seen", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("atlas:notifications-seen", sync);
      window.removeEventListener("storage", sync);
    };
  }, [uid]);

  const items = useMemo((): Notification[] => {
    const merged: Notification[] = [
      ...followers.map((follow) => ({
        kind: "follow" as const,
        id: `follow:${follow.id}`,
        at: millis(follow.createdAt),
        actorId: follow.followerId,
      })),
      ...places.map((place) => ({
        kind: "place" as const,
        id: `place:${place.id}`,
        at: millis(place.createdAt),
        actorId: place.uploaderId,
        place,
      })),
    ];
    return merged.sort((a, b) => b.at - a.at).slice(0, MAX_ITEMS);
  }, [followers, places]);

  // A serverTimestamp reads back as null on the writer's own device until the
  // round trip lands, so a brand-new item has at === 0. Treating that as unread
  // would be wrong, hence the > 0 guard.
  const unread = items.filter((item) => item.at > 0 && item.at > seenAt).length;

  return { items, unread, seenAt };
}

export { useProfilesByIds as useActorProfiles } from "./profileCache";
