"use client";

import { useEffect, useRef, useState } from "react";

export type TileMenuItem = {
  label: string;
  onClick: () => void;
  /** Destructive styling — Delete, Leave, etc. */
  danger?: boolean;
  title?: string;
};

/**
 * Top-right ⋯ on a tile. Hidden until the tile is hovered (always visible on
 * touch). Hovering or clicking the dots opens Edit / Remove / Delete.
 */
export default function TileMenu({ items }: { items: TileMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearCloseTimer() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }

  useEffect(() => {
    return () => clearCloseTimer();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div
      ref={rootRef}
      onMouseEnter={() => {
        clearCloseTimer();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
      className="absolute right-2.5 top-2.5 z-20 md:opacity-0 md:transition-opacity md:duration-150 md:group-hover:opacity-100 md:focus-within:opacity-100"
    >
      <button
        type="button"
        aria-label="More actions"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          clearCloseTimer();
          setOpen((v) => !v);
        }}
        className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[rgba(250,249,247,0.92)] text-[13px] font-bold leading-none text-[#14161A] shadow-[0_1px_2px_rgba(20,22,26,0.12)] backdrop-blur transition-colors duration-150 hover:bg-[#FAF9F7]"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-8 w-36 overflow-hidden rounded-2xl border border-[rgba(20,22,26,0.09)] bg-white shadow-[0_12px_28px_-18px_rgba(20,22,26,0.4)]">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              title={item.title}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                item.onClick();
              }}
              className={`block w-full px-3.5 py-2.5 text-left text-[14px] transition-colors duration-150 hover:bg-[rgba(20,22,26,0.05)] ${
                item.danger
                  ? "font-medium text-[#C0362C]"
                  : "text-[#14161A]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
