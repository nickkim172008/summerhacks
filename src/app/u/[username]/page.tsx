"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuthProfile } from "@/lib/auth";
import { subscribeToAlbumsByOwner } from "@/lib/albums";
import { subscribeToPlacesByUploader } from "@/lib/places";
import {
  BIO_MAX_LENGTH,
  prepareProfilePhoto,
  subscribeToProfileByUsername,
  updateBio,
  updatePhotoURL,
} from "@/lib/profiles";
import { uploadProfilePhoto } from "@/lib/splatStore";
import FollowListDialog, {
  type FollowListKind,
} from "@/components/FollowListDialog";
import {
  follow,
  subscribeToFollowerCount,
  subscribeToFollowingCount,
  subscribeToIsFollowing,
  unfollow,
} from "@/lib/follows";
import PlaceThumb from "@/components/PlaceThumb";
import type { Album, Place, Profile } from "@/lib/types";

export default function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = use(params);
  const { user, profile: myProfile } = useAuthProfile();
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [albumsError, setAlbumsError] = useState<string | null>(null);
  const [placesError, setPlacesError] = useState<string | null>(null);
  const [followers, setFollowers] = useState<number | null>(null);
  const [following, setFollowing] = useState<number | null>(null);
  const [followList, setFollowList] = useState<FollowListKind | null>(null);

  useEffect(() => {
    return subscribeToProfileByUsername(username, setProfile);
  }, [username]);

  useEffect(() => {
    if (!profile) {
      setAlbums(null);
      setPlaces(null);
      setAlbumsError(null);
      setPlacesError(null);
      setFollowers(null);
      setFollowing(null);
      return;
    }
    setAlbumsError(null);
    setPlacesError(null);
    const unsubAlbums = subscribeToAlbumsByOwner(
      profile.id,
      setAlbums,
      () => {
        setAlbums([]);
        setAlbumsError("Couldn’t load albums (check Firestore rules).");
      },
    );
    const unsubPlaces = subscribeToPlacesByUploader(
      profile.id,
      setPlaces,
      () => {
        setPlaces([]);
        setPlacesError("Couldn’t load environments (check Firestore rules).");
      },
    );
    const unsubFollowers = subscribeToFollowerCount(profile.id, setFollowers);
    const unsubFollowing = subscribeToFollowingCount(profile.id, setFollowing);
    return () => {
      unsubAlbums();
      unsubPlaces();
      unsubFollowers();
      unsubFollowing();
    };
  }, [profile]);

  const placeById = useMemo(
    () => new Map((places ?? []).map((p) => [p.id, p])),
    [places],
  );

  const isOwn = Boolean(user && profile && user.uid === profile.id);
  const loading = profile === undefined;
  // These places belong to a profile rather than an album, so name the profile
  // as the way back out of them.
  const fromProfile = `?from=${encodeURIComponent(`/u/${username}`)}`;

  if (!loading && profile === null) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-3 bg-white text-[#1d1d1f]">
        <p>@{username} doesn&apos;t exist.</p>
        <Link href="/" className="text-[#0071e3]">
          Back to Albums
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white pb-20 text-[#1d1d1f]">
      <nav className="sticky top-0 z-20 border-b border-black/10 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link
            href="/"
            className="flex items-center gap-1 text-[17px] text-[#0071e3]"
          >
            <span aria-hidden className="text-xl leading-none">
              ‹
            </span>
            Albums
          </Link>
          {isOwn && myProfile && (
            <span className="text-[13px] text-neutral-500">Your profile</span>
          )}
        </div>
      </nav>

      <div className="mx-auto max-w-5xl px-6">
        {loading || !profile ? (
          <p className="mt-10 text-neutral-500">Loading…</p>
        ) : (
          <>
            <header className="mt-8 flex items-center gap-4">
              <ProfileAvatar profile={profile} editable={isOwn} />
              <div>
                <h1 className="text-[28px] font-bold tracking-tight">
                  {profile.displayName}
                </h1>
                <p className="text-[15px] text-neutral-500">
                  @{profile.username}
                </p>
                {isOwn && (
                  <p className="mt-0.5 text-[12px] text-neutral-400">
                    Tap the photo to change it
                  </p>
                )}
              </div>
              {!isOwn && user && (
                <FollowButton followerId={user.uid} followingId={profile.id} />
              )}
            </header>

            <BioSection profile={profile} editable={isOwn} />

            <dl className="mt-6 flex gap-8">
              <Stat label="Environments" value={places?.length ?? null} />
              <Stat
                label="Followers"
                value={followers}
                onClick={() => setFollowList("followers")}
              />
              <Stat
                label="Following"
                value={following}
                onClick={() => setFollowList("following")}
              />
            </dl>

            <section className="mt-10">
              <h2 className="text-[22px] font-bold tracking-tight">Albums</h2>
              {albumsError ? (
                <p className="mt-3 text-sm text-amber-600">{albumsError}</p>
              ) : albums === null ? (
                <p className="mt-3 text-sm text-neutral-500">Loading…</p>
              ) : albums.length === 0 ? (
                <p className="mt-3 text-sm text-neutral-500">No albums yet.</p>
              ) : (
                <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
                  {albums.map((album) => {
                    const cover = coverFor(album, placeById);
                    return (
                      <li key={album.id}>
                        <Link
                          href={`/album/${album.id}`}
                          className="group block"
                        >
                          <div className="aspect-square overflow-hidden rounded-2xl bg-neutral-100 transition group-hover:opacity-90">
                            {cover ? (
                              <PlaceThumb place={cover} />
                            ) : (
                              <EmptyCover />
                            )}
                          </div>
                          <p className="mt-2 truncate text-[15px] font-medium">
                            {album.name}
                          </p>
                          <p className="text-sm text-neutral-500">
                            {album.placeIds?.length ?? 0}
                          </p>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="mt-12">
              <h2 className="text-[22px] font-bold tracking-tight">
                Environments
              </h2>
              {placesError ? (
                <p className="mt-3 text-sm text-amber-600">{placesError}</p>
              ) : places === null ? (
                <p className="mt-3 text-sm text-neutral-500">Loading…</p>
              ) : places.length === 0 ? (
                <p className="mt-3 text-sm text-neutral-500">
                  No environments yet.
                </p>
              ) : (
                <ul className="mt-4 grid grid-cols-3 gap-0.5 sm:grid-cols-4 md:grid-cols-5">
                  {places.map((place) => (
                    <li key={place.id}>
                      <Link
                        href={`/place/${place.id}${fromProfile}`}
                        className="group relative block aspect-square overflow-hidden bg-neutral-100"
                      >
                        <PlaceThumb place={place} />
                        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-6 text-xs font-medium text-white opacity-0 transition group-hover:opacity-100">
                          {place.name}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      {followList && profile && (
        <FollowListDialog
          uid={profile.id}
          kind={followList}
          onClose={() => setFollowList(null)}
        />
      )}
    </main>
  );
}

function ProfileAvatar({
  profile,
  editable,
}: {
  profile: Profile;
  editable: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(file: File | undefined) {
    if (!file || !editable || busy) return;
    setBusy(true);
    setError(null);
    try {
      const prepared = await prepareProfilePhoto(file);
      const url = await uploadProfilePhoto(profile.id, prepared);
      await updatePhotoURL(profile.id, url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t update photo");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const face = profile.photoURL ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={profile.photoURL}
      alt=""
      className="h-full w-full object-cover"
    />
  ) : (
    <span className="text-xl font-semibold text-neutral-500">
      {profile.username.slice(0, 1).toUpperCase()}
    </span>
  );

  if (!editable) {
    return (
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-100">
        {face}
      </div>
    );
  }

  return (
    <div className="shrink-0">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="hidden"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label="Change profile photo"
        className="group relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-neutral-100 transition hover:ring-2 hover:ring-[#0071e3]/40 disabled:opacity-60"
      >
        {face}
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-[11px] font-medium text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          {busy ? "…" : "Edit"}
        </span>
      </button>
      {error && (
        <p className="mt-2 max-w-[10rem] text-[11px] leading-snug text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  onClick,
}: {
  label: string;
  value: number | null;
  onClick?: () => void;
}) {
  const body = (
    <>
      <dd className="text-[22px] font-bold tracking-tight tabular-nums">
        {value ?? "—"}
      </dd>
      <dt className="text-[13px] text-neutral-500">{label}</dt>
    </>
  );

  // Nothing to open when the count is zero, so it stays plain text rather than
  // a button that shows an empty sheet.
  if (!onClick || !value) return <div>{body}</div>;

  return (
    <button
      onClick={onClick}
      className="text-left transition hover:opacity-60"
      aria-label={`View ${label.toLowerCase()}`}
    >
      {body}
    </button>
  );
}

function FollowButton({
  followerId,
  followingId,
}: {
  followerId: string;
  followingId: string;
}) {
  const [isFollowing, setIsFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return subscribeToIsFollowing(followerId, followingId, setIsFollowing);
  }, [followerId, followingId]);

  async function toggle() {
    if (isFollowing === null || busy) return;
    setBusy(true);
    try {
      if (isFollowing) await unfollow(followerId, followingId);
      else await follow(followerId, followingId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={isFollowing === null || busy}
      className={`ml-auto rounded-full px-5 py-2 text-[15px] font-medium transition disabled:opacity-40 ${
        isFollowing
          ? "border border-black/10 hover:bg-neutral-50"
          : "bg-[#0071e3] text-white hover:bg-[#0077ed]"
      }`}
    >
      {isFollowing ? "Following" : "Follow"}
    </button>
  );
}

function BioSection({
  profile,
  editable,
}: {
  profile: Profile;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile.bio ?? "");
  const [saving, setSaving] = useState(false);

  // A live snapshot can land while this sits open; don't clobber what's typed.
  useEffect(() => {
    if (!editing) setDraft(profile.bio ?? "");
  }, [profile.bio, editing]);

  async function save() {
    setSaving(true);
    try {
      await updateBio(profile.id, draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="mt-6 max-w-lg">
        <textarea
          autoFocus
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, BIO_MAX_LENGTH))}
          placeholder="Tell people about the places you capture."
          className="w-full resize-none rounded-xl border border-black/10 bg-neutral-50 px-3 py-2 text-[15px] outline-none focus:border-[#0071e3]"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[12px] text-neutral-400">
            {draft.length}/{BIO_MAX_LENGTH}
          </span>
          <div className="flex gap-4 text-[14px]">
            <button
              onClick={() => {
                setDraft(profile.bio ?? "");
                setEditing(false);
              }}
              disabled={saving}
              className="text-neutral-500 transition hover:text-neutral-700"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="font-semibold text-[#0071e3] transition hover:text-[#0077ed] disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (profile.bio) {
    return (
      <div className="mt-6 max-w-lg">
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
          {profile.bio}
        </p>
        {editable && (
          <button
            onClick={() => setEditing(true)}
            className="mt-2 text-[13px] text-[#0071e3]"
          >
            Edit bio
          </button>
        )}
      </div>
    );
  }

  return editable ? (
    <button
      onClick={() => setEditing(true)}
      className="mt-6 text-[15px] text-neutral-400 transition hover:text-neutral-600"
    >
      + Add a bio
    </button>
  ) : null;
}

function coverFor(album: Album, placeById: Map<string, Place>) {
  for (const id of album.placeIds ?? []) {
    const place = placeById.get(id);
    if (place) return place;
  }
  return null;
}

function EmptyCover() {
  return (
    <div className="flex h-full w-full items-center justify-center text-neutral-300">
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        className="h-10 w-10"
        aria-hidden
      >
        <path d="M19 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm-9.5 3A1.5 1.5 0 1 1 8 9.5 1.5 1.5 0 0 1 9.5 8Zm9.5 9H5l4-5 2.5 3 3.5-4.5Z" />
      </svg>
    </div>
  );
}
