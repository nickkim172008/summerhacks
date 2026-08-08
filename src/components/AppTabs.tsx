"use client";

import Link from "next/link";
import type { ReactNode } from "react";

type Tab = "library" | "discover" | "map";

export default function AppTabs({ active }: { active: Tab }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-black/10 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-5xl items-stretch justify-around px-6 py-2">
        <TabLink
          href="/"
          label="Library"
          icon={<LibraryIcon />}
          active={active === "library"}
        />
        <TabLink
          href="/discover"
          label="Discover"
          icon={<DiscoverIcon />}
          active={active === "discover"}
        />
        <TabLink
          href="/map"
          label="Map"
          icon={<MapIcon />}
          active={active === "map"}
        />
      </div>
    </nav>
  );
}

function TabLink({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex min-w-[5.5rem] flex-col items-center gap-0.5 rounded-lg px-4 py-1.5 text-[11px] font-medium transition ${
        active ? "text-[#0071e3]" : "text-neutral-500 hover:text-[#1d1d1f]"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

function DiscoverIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
      <path d="M10.5 3a7.5 7.5 0 1 0 4.55 13.46l4.24 4.25a1 1 0 0 0 1.42-1.42l-4.25-4.24A7.5 7.5 0 0 0 10.5 3Zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h5A1.5 1.5 0 0 1 12 5.5v5A1.5 1.5 0 0 1 10.5 12h-5A1.5 1.5 0 0 1 4 10.5v-5Zm8 0A1.5 1.5 0 0 1 13.5 4h5A1.5 1.5 0 0 1 20 5.5v5A1.5 1.5 0 0 1 18.5 12h-5A1.5 1.5 0 0 1 12 10.5v-5ZM4 13.5A1.5 1.5 0 0 1 5.5 12h5a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 10.5 20h-5A1.5 1.5 0 0 1 4 18.5v-5Zm9.75-.25 6.5 3.5a.75.75 0 0 1 0 1.3l-6.5 3.5A.75.75 0 0 1 12.5 20.7v-7.4a.75.75 0 0 1 1.25-.55Z" />
    </svg>
  );
}

function MapIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
      <path d="M15 4.2 9 6.4 3.75 4.5A.75.75 0 0 0 2.5 5.2v12.55c0 .55.5.96 1.03.8L9 16.8l6 2.2 5.25-1.9a.75.75 0 0 0 .5-.7V3.85a.75.75 0 0 0-1.03-.8L15 4.2Zm0 1.6v11.4l-6-2.2V5.6l6 1.2Z" />
    </svg>
  );
}
