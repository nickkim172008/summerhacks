"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  albumMemberIds,
  inviteCollaborator,
  leaveAlbum,
  removeCollaborator,
} from "@/lib/albums";
import { getProfile, getProfileByUsername } from "@/lib/profiles";
import { subscribeToFollowingIds } from "@/lib/follows";
import Avatar from "@/components/Avatar";
import type { Album, Profile } from "@/lib/types";

/**
 * Who is on this journey, said the way a person would: "You, @mira and @jonah".
 * Reads the faces that are already loaded — no extra lookup.
 */
function describeMembers(members: Profile[], viewerId: string) {
  const names = members.map((profile) =>
    profile.id === viewerId ? "You" : `@${profile.username}`,
  );
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export default function AlbumMembers({
  album,
  viewerId,
}: {
  album: Album;
  viewerId: string;
}) {
  const router = useRouter();
  const memberIds = albumMemberIds(album);
  const pendingIds = album.pendingMemberIds ?? [];
  const isOwner = album.ownerId === viewerId;
  const canLeave = !isOwner && memberIds.includes(viewerId);
  const [members, setMembers] = useState<Profile[] | null>(null);
  const [pending, setPending] = useState<Profile[] | null>(null);
  const [inviting, setInviting] = useState(false);
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followed, setFollowed] = useState<Profile[] | null>(null);

  const memberKey = memberIds.join(",");
  useEffect(() => {
    let active = true;
    const ids = memberKey ? memberKey.split(",") : [];
    Promise.all(ids.map((id) => getProfile(id)))
      .then((found) => {
        if (active) {
          setMembers(found.filter((p): p is Profile => Boolean(p)));
        }
      })
      .catch(() => {
        if (active) setMembers([]);
      });
    return () => {
      active = false;
    };
  }, [memberKey]);

  const pendingKey = pendingIds.join(",");
  useEffect(() => {
    if (!isOwner) {
      setPending([]);
      return;
    }
    let active = true;
    const ids = pendingKey ? pendingKey.split(",") : [];
    Promise.all(ids.map((id) => getProfile(id)))
      .then((found) => {
        if (active) {
          setPending(found.filter((p): p is Profile => Boolean(p)));
        }
      })
      .catch(() => {
        if (active) setPending([]);
      });
    return () => {
      active = false;
    };
  }, [pendingKey, isOwner]);

  // Only the owner can invite, so nobody else pays for these reads. The
  // profile lookups are async, so a resolved batch is dropped once this has
  // gone away — and once a newer snapshot has superseded it.
  useEffect(() => {
    if (!isOwner) return;
    let active = true;
    let latest = 0;
    const stop = subscribeToFollowingIds(viewerId, async (ids) => {
      const ticket = ++latest;
      const found = await Promise.all(ids.map((id) => getProfile(id)));
      if (!active || ticket !== latest) return;
      setFollowed(found.filter((p): p is Profile => Boolean(p)));
    });
    return () => {
      active = false;
      stop();
    };
  }, [isOwner, viewerId]);

  const taken = new Set([...memberIds, ...pendingIds]);
  const typed = handle.trim().replace(/^@/, "").toLowerCase();
  const suggestions = (followed ?? []).filter(
    (p) =>
      !taken.has(p.id) &&
      (typed === "" ||
        p.username.toLowerCase().startsWith(typed) ||
        p.displayName.toLowerCase().includes(typed)),
  );

  async function inviteProfile(profile: Profile) {
    setBusy(true);
    setError(null);
    try {
      await inviteCollaborator(album, profile.id);
      setHandle("");
      setInviting(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn’t invite them. You may not have permission.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function invite() {
    const wanted = handle.trim().replace(/^@/, "");
    if (!wanted || busy) return;
    setBusy(true);
    setError(null);
    try {
      const profile = await getProfileByUsername(wanted);
      if (!profile) {
        setError(`No account called @${wanted}.`);
        return;
      }
      if (memberIds.includes(profile.id)) {
        setError(`@${profile.username} is already on this journey.`);
        return;
      }
      if (pendingIds.includes(profile.id)) {
        setError(`@${profile.username} already has an invite waiting.`);
        return;
      }
      await inviteCollaborator(album, profile.id);
      setHandle("");
      setInviting(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn’t invite them. You may not have permission.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(profile: Profile) {
    setBusy(true);
    setError(null);
    try {
      await removeCollaborator(album, profile.id);
    } catch {
      setError("Couldn’t remove them.");
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setBusy(true);
    setError(null);
    try {
      await leaveAlbum(album, viewerId);
      router.push("/");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn’t leave this journey.",
      );
      setBusy(false);
      setConfirmLeave(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2.5">
        {members === null ? (
          <span className="text-[15px] text-[#6B7178]">Loading people…</span>
        ) : (
          <>
            {/* A facepile rather than a row: the journey is theirs together. */}
            <div className="flex items-center">
              {members.map((profile) => (
                <span
                  key={profile.id}
                  className="group relative -ml-[9px] first:ml-0 hover:z-10"
                >
                  <Link
                    href={`/u/${profile.username}`}
                    title={
                      profile.id === album.ownerId
                        ? `@${profile.username} · owner`
                        : `@${profile.username}`
                    }
                    className="block rounded-full shadow-[0_0_0_2px_#FAF9F7] transition-opacity duration-150 hover:opacity-90"
                  >
                    <Avatar
                      profile={profile}
                      className="h-7 w-7"
                      textClassName="text-[11px]"
                    />
                  </Link>
                  {isOwner && profile.id !== album.ownerId && (
                    <button
                      onClick={() => remove(profile)}
                      disabled={busy}
                      aria-label={`Remove @${profile.username}`}
                      className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-[#14161A] text-[10px] leading-none text-white group-hover:flex"
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
            {members.length > 0 && (
              <span className="text-[13px] text-[#6B7178]">
                {describeMembers(members, viewerId)}
              </span>
            )}
          </>
        )}

        {isOwner && !inviting && (
          <button
            onClick={() => setInviting(true)}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-[rgba(20,22,26,0.24)] text-[15px] leading-none text-[#4A4F57] transition-colors duration-150 hover:border-[rgba(20,22,26,0.4)] hover:text-[#14161A]"
            aria-label="Invite someone"
            title="Invite someone"
          >
            +
          </button>
        )}
      </div>

      {isOwner && pending && pending.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase leading-[12px] tracking-[0.12em] text-[#6B7178]">
            Pending
          </p>
          <ul className="mt-1.5 space-y-1">
            {pending.map((profile) => (
              <li
                key={profile.id}
                className="flex items-center gap-2 text-[13px] text-[#4A4F57]"
              >
                <Avatar
                  profile={profile}
                  className="h-6 w-6"
                  textClassName="text-[10px]"
                />
                <span className="min-w-0 flex-1 truncate">
                  @{profile.username}
                  <span className="text-[#6B7178]"> · waiting</span>
                </span>
                <button
                  type="button"
                  onClick={() => remove(profile)}
                  disabled={busy}
                  className="text-[12px] text-[#6B7178] transition-colors duration-150 hover:text-[#14161A] disabled:opacity-40"
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {inviting && (
        <div className="mt-3 max-w-sm">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") invite();
                if (e.key === "Escape") {
                  setInviting(false);
                  setError(null);
                }
              }}
              placeholder="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-xl border border-[rgba(20,22,26,0.12)] bg-white px-3 py-1.5 text-[15px] text-[#14161A] outline-none transition-colors duration-150 placeholder:text-[#8A9098] focus:border-[#0071E3]"
            />
            <button
              onClick={invite}
              disabled={!handle.trim() || busy}
              className="shrink-0 text-[15px] font-semibold text-[#14161A] disabled:opacity-40"
            >
              {busy ? "Inviting…" : "Invite"}
            </button>
            <button
              onClick={() => {
                setInviting(false);
                setError(null);
              }}
              className="shrink-0 text-[15px] text-[#4A4F57] transition-colors duration-150 hover:text-[#14161A]"
            >
              Cancel
            </button>
          </div>

          {followed === null ? (
            <p className="mt-2 text-[15px] text-[#6B7178]">
              Loading who you follow…
            </p>
          ) : suggestions.length > 0 ? (
            <ul className="mt-2 overflow-hidden rounded-xl border border-[rgba(20,22,26,0.09)] bg-white">
              {suggestions.map((profile) => (
                <li key={profile.id}>
                  <button
                    onClick={() => inviteProfile(profile)}
                    disabled={busy}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors duration-150 hover:bg-[rgba(20,22,26,0.05)] disabled:opacity-40"
                  >
                    <Avatar
                      profile={profile}
                      className="h-7 w-7"
                      textClassName="text-[12px]"
                    />
                    <span className="min-w-0 flex-1 truncate font-display text-[15px] tracking-[-0.01em] text-[#14161A]">
                      {profile.displayName}
                      <span className="ml-1.5 font-sans text-[13px] text-[#6B7178]">
                        @{profile.username}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-[#6B7178]">
              {followed.length === 0
                ? "You’re not following anyone yet. Type a username instead."
                : typed
                  ? "Nobody you follow matches. Enter invites by exact username."
                  : "Everyone you follow is already here or invited."}
            </p>
          )}
        </div>
      )}

      {canLeave && (
        <div className="mt-3">
          {confirmLeave ? (
            <div className="flex flex-wrap items-center gap-3 text-[13px]">
              <span className="text-[#4A4F57]">
                Leave this journey? You’ll lose access until you’re invited
                again.
              </span>
              <button
                type="button"
                onClick={leave}
                disabled={busy}
                className="font-semibold text-[#C0362C] transition-opacity duration-150 hover:opacity-80 disabled:opacity-40"
              >
                {busy ? "Leaving…" : "Leave"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmLeave(false)}
                disabled={busy}
                className="text-[#4A4F57] transition-colors duration-150 hover:text-[#14161A] disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmLeave(true)}
              className="text-[13px] text-[#6B7178] transition-colors duration-150 hover:text-[#14161A]"
            >
              Leave journey
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-[13px] text-[#C0362C]">{error}</p>}
    </div>
  );
}
