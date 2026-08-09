"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAuthProfile } from "@/lib/auth";
import {
  albumVisibility,
  resolveAlbumPlaces,
  subscribeToAlbumsByOwner,
  subscribeToPublicAlbumsByOwner,
} from "@/lib/albums";
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
import AlbumCover from "@/components/AlbumCover";
import { canOptimizeImage } from "@/lib/imageHosts";
import { formatPlaceDate } from "@/lib/places";
import {
  AlbumCardSkeleton,
  PlaceSquareSkeleton,
  ProfileHeaderSkeleton,
  SkeletonList,
} from "@/components/Skeleton";
import { riseDelay } from "@/lib/motion";
import type { Album, Place, Profile } from "@/lib/types";

/* Two lists live on this page, so the control over them has two segments. A
   profile has no map view to switch to, and a third segment that switched to
   nothing would be a control that does nothing. */
type ProfileTab = "journeys" | "places";

const TABS: { key: ProfileTab; label: string }[] = [
  { key: "journeys", label: "Journeys" },
  { key: "places", label: "Places" },
];

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
  const [tab, setTab] = useState<ProfileTab>("journeys");

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
    const viewingOwn = Boolean(user && user.uid === profile.id);
    const unsubAlbums = (
      viewingOwn ? subscribeToAlbumsByOwner : subscribeToPublicAlbumsByOwner
    )(profile.id, setAlbums, () => {
      setAlbums([]);
      setAlbumsError("Couldn’t load journeys (check Firestore rules).");
    });
    const unsubPlaces = subscribeToPlacesByUploader(
      profile.id,
      setPlaces,
      () => {
        setPlaces([]);
        setPlacesError("Couldn’t load places (check Firestore rules).");
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
  }, [profile, user]);

  const placeById = useMemo(
    () => new Map((places ?? []).map((p) => [p.id, p])),
    [places],
  );

  const isOwn = Boolean(user && profile && user.uid === profile.id);
  const loading = profile === undefined;
  // These places belong to a profile rather than an album, so name the profile
  // as the way back out of them.
  const fromProfile = `?from=${encodeURIComponent(`/u/${username}`)}`;
  const joined = profile ? joinedMonth(profile) : null;

  if (!loading && profile === null) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-3 bg-[#FAF9F7] px-8 text-[#14161A]">
        <p className="text-[15px] text-[#6B7178]">
          @{username} doesn&apos;t exist.
        </p>
        <Link
          href="/"
          className="text-[15px] font-medium text-[#14161A] transition-colors duration-150 hover:text-[#4A4F57]"
        >
          Back to Library
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#FAF9F7] text-[#14161A]">
      <div className="mx-auto max-w-[1152px] px-8 py-10">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#4A4F57] transition-colors duration-150 hover:text-[#14161A]"
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M15 5l-7 7 7 7" />
            </svg>
            Library
          </Link>
          {isOwn && myProfile && (
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B7178]">
              Your profile
            </span>
          )}
        </div>

        {loading || !profile ? (
          <>
            <p className="sr-only" role="status">
              Loading this profile…
            </p>
            <ProfileHeaderSkeleton />
            {/* The tab pill and the first grid, so the whole page is standing
                before any of it is filled in. */}
            <div className="skeleton mt-6 h-[35px] w-[168px] rounded-full" />
            <SkeletonList
              count={4}
              className="mt-6 grid grid-cols-4 gap-x-6 gap-y-7"
              item={() => <AlbumCardSkeleton />}
            />
          </>
        ) : (
          <>
            <header className="mt-5 flex items-start gap-7 border-b border-[rgba(20,22,26,0.09)] pb-7">
              <ProfileAvatar profile={profile} editable={isOwn} />
              <div className="min-w-0 flex-1">
                <h1 className="font-display text-[40px] font-normal leading-[40px] tracking-[-0.02em]">
                  {profile.displayName}
                </h1>
                <p className="mt-2 text-[15px] text-[#6B7178]">
                  @{profile.username}
                  {joined && ` · joined ${joined}`}
                </p>
                {isOwn && (
                  <p className="mt-1 text-[13px] text-[#6B7178]">
                    Tap the photo to change it
                  </p>
                )}

                <BioSection profile={profile} editable={isOwn} />

                <dl className="mt-5 flex gap-9">
                  <Stat label="Places" value={places?.length ?? null} />
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
              </div>
              {!isOwn && user && (
                <div className="flex flex-none items-center gap-2.5">
                  <FollowButton followerId={user.uid} followingId={profile.id} />
                </div>
              )}
            </header>

            <div className="mt-6 flex w-max items-center gap-0.5 rounded-full bg-[rgba(20,22,26,0.05)] p-[3px]">
              {TABS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  aria-pressed={tab === key}
                  className={`rounded-full px-4 py-1.5 text-[13px] transition-colors duration-150 ${
                    tab === key
                      ? "bg-white font-medium text-[#14161A] shadow-[0_1px_2px_rgba(20,22,26,0.06)]"
                      : "text-[#4A4F57] hover:text-[#14161A]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "journeys" ? (
              <section className="mt-6" aria-label="Journeys">
                {albumsError ? (
                  <p className="text-[15px] text-[#C0362C]">{albumsError}</p>
                ) : albums === null ? (
                  <SkeletonList
                    count={4}
                    className="grid grid-cols-4 gap-x-6 gap-y-7"
                    item={() => <AlbumCardSkeleton />}
                  />
                ) : albums.length === 0 ? (
                  <p className="text-[15px] text-[#6B7178]">No journeys yet.</p>
                ) : (
                  <ul className="grid grid-cols-4 gap-x-6 gap-y-7">
                    {albums.map((album, index) => {
                      const count = album.placeIds?.length ?? 0;
                      return (
                        <li
                          key={album.id}
                          className="rise"
                          style={riseDelay(index)}
                        >
                          <Link
                            href={`/album/${album.id}`}
                            className="group block"
                          >
                            <div className="aspect-[4/3] overflow-hidden rounded-2xl bg-[rgba(20,22,26,0.05)] shadow-[0_1px_2px_rgba(20,22,26,0.06),0_12px_28px_-18px_rgba(20,22,26,0.4)] transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-0.5 group-hover:shadow-[0_2px_4px_rgba(20,22,26,0.07),0_20px_38px_-20px_rgba(20,22,26,0.45)]">
                              <AlbumCover
                                coverUrl={album.coverUrl}
                                places={resolveAlbumPlaces(
                                  album.placeIds,
                                  placeById,
                                )}
                                alt={album.name}
                              />
                            </div>
                            <p className="mt-3 truncate font-display text-[19px] leading-[24px] tracking-[-0.01em]">
                              {album.name}
                            </p>
                            <p className="mt-0.5 text-[13px] text-[#6B7178] tabular-nums">
                              {count} {count === 1 ? "place" : "places"}
                              {/* Only the owner needs telling which of their
                                  journeys a stranger can already see. */}
                              {isOwn ? ` · ${albumVisibility(album) === "public" ? "Public" : "Private"}` : ""}
                            </p>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ) : (
              <section className="mt-6" aria-label="Places">
                {placesError ? (
                  <p className="text-[15px] text-[#C0362C]">{placesError}</p>
                ) : places === null ? (
                  <SkeletonList
                    count={12}
                    className="grid grid-cols-6 gap-3"
                    item={() => <PlaceSquareSkeleton />}
                  />
                ) : places.length === 0 ? (
                  <p className="text-[15px] text-[#6B7178]">No places yet.</p>
                ) : (
                  <ul className="grid grid-cols-6 gap-3">
                    {places.map((place, index) => {
                      const taken = formatPlaceDate(place);
                      return (
                        <li
                          key={place.id}
                          className="rise"
                          style={riseDelay(index)}
                        >
                          <Link
                            href={`/place/${place.id}${fromProfile}`}
                            className="group relative block aspect-square overflow-hidden rounded-xl bg-[rgba(20,22,26,0.05)]"
                          >
                            <PlaceThumb place={place} zoomOnHover />
                            {/* The dense grid has no room for a caption under
                                each tile, so this one keeps its hover label. */}
                            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[rgba(20,22,26,0.72)] to-transparent px-2.5 pb-2 pt-7 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                              <span className="block truncate text-[12px] font-medium">
                                {place.name}
                              </span>
                              {taken && (
                                <span className="block truncate text-[11px] font-normal text-white/85">
                                  {taken}
                                </span>
                              )}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}
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

/** “joined March 2026”, off the createdAt the profile doc already carries. */
function joinedMonth(profile: Profile): string | null {
  const ms = profile.createdAt?.toMillis?.();
  if (!ms) return null;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
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
    <Image
      src={profile.photoURL}
      alt=""
      fill
      sizes="96px"
      unoptimized={!canOptimizeImage(profile.photoURL)}
      className="object-cover"
    />
  ) : (
    <span className="text-[34px] font-semibold text-[#6B7178]">
      {profile.username.slice(0, 1).toUpperCase()}
    </span>
  );

  if (!editable) {
    // relative is what keeps next/image fill inside this circle. Without it the
    // photo positions against a page ancestor and paints the whole viewport —
    // which is what made another person's albums look like they sat on top of
    // a blown-up profile picture.
    return (
      <div className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[rgba(20,22,26,0.05)] shadow-[0_0_0_1px_rgba(20,22,26,0.08)]">
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
        className="group relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-[rgba(20,22,26,0.05)] shadow-[0_0_0_1px_rgba(20,22,26,0.08)] transition-opacity duration-150 disabled:opacity-60"
      >
        {face}
        <span className="absolute inset-0 flex items-center justify-center bg-[rgba(20,22,26,0.45)] text-[12px] font-medium text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
          {busy ? "…" : "Edit"}
        </span>
      </button>
      {error && (
        <p className="mt-2 max-w-24 text-[11px] leading-snug text-[#C0362C]">
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
      <dd className="text-[22px] font-semibold leading-none tracking-[-0.01em] tabular-nums">
        {value ?? "—"}
      </dd>
      <dt className="mt-1 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#6B7178]">
        {label}
      </dt>
    </>
  );

  // Nothing to open when the count is zero, so it stays plain text rather than
  // a button that shows an empty sheet.
  if (!onClick || !value) return <div>{body}</div>;

  return (
    <button
      onClick={onClick}
      className="text-left transition-opacity duration-150 hover:opacity-60"
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
      className={`h-10 rounded-full px-[26px] text-[15px] font-medium transition-colors duration-150 disabled:opacity-40 ${
        isFollowing
          ? "border border-[rgba(20,22,26,0.14)] bg-white text-[#14161A] hover:bg-[#F1EFEC]"
          : "bg-[#14161A] text-white hover:bg-[#2B2F36]"
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
      <div className="mt-3.5 max-w-[56ch]">
        <textarea
          autoFocus
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, BIO_MAX_LENGTH))}
          placeholder="Tell people about the places you capture."
          className="w-full resize-none rounded-xl border border-[rgba(20,22,26,0.12)] bg-white px-3 py-2 text-[15px] leading-[1.65] text-[#14161A] outline-none transition-colors duration-150 placeholder:text-[#8A9098] focus:border-[rgba(20,22,26,0.24)]"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[12px] tabular-nums text-[#6B7178]">
            {draft.length}/{BIO_MAX_LENGTH}
          </span>
          <div className="flex gap-4 text-[14px]">
            <button
              onClick={() => {
                setDraft(profile.bio ?? "");
                setEditing(false);
              }}
              disabled={saving}
              className="text-[#4A4F57] transition-colors duration-150 hover:text-[#14161A] disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="font-semibold text-[#14161A] transition-opacity duration-150 hover:opacity-70 disabled:opacity-40"
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
      <div className="mt-3.5 max-w-[56ch]">
        <p className="whitespace-pre-wrap text-[15px] leading-[1.65] text-[#14161A]">
          {profile.bio}
        </p>
        {editable && (
          <button
            onClick={() => setEditing(true)}
            className="mt-2 text-[13px] font-medium text-[#4A4F57] transition-colors duration-150 hover:text-[#14161A]"
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
      className="mt-3.5 text-[15px] text-[#6B7178] transition-colors duration-150 hover:text-[#14161A]"
    >
      + Add a bio
    </button>
  ) : null;
}
