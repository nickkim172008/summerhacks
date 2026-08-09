/**
 * What a place that will not open says, whichever renderer was asked to open
 * it. Dark chrome, so the viewer's white-alpha scale rather than the ink scale
 * the rest of the app is on.
 */
export default function SplatLoadError({
  splatUrl,
  loadError,
}: {
  splatUrl: string;
  loadError: string;
}) {
  // A relative url means the record predates Firebase storage and its bytes
  // were only ever on one machine. An absolute one that will not load is a
  // live file the browser was refused — almost always the bucket's CORS,
  // since a missing object answers 404 rather than failing outright.
  const onDisk = !/^https?:/i.test(splatUrl);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#0A0B0D] px-6 text-center">
      <p className="text-[15px] font-medium text-white">
        {onDisk
          ? "This place's file is missing."
          : "This place could not be loaded."}
      </p>
      <p className="max-w-sm text-[15px] leading-6 text-[rgba(255,255,255,0.6)]">
        {onDisk
          ? "Its splat was saved to a machine rather than to storage, so the bytes are not here. Capturing it again is the only way back."
          : "The file is in storage, but the browser was refused it. The bucket most likely has no CORS rule; see cors.json in the repo. Nothing is lost."}
      </p>
      <p className="mt-1 text-[13px] text-[rgba(255,255,255,0.45)]">
        {loadError}
      </p>
      <p className="mt-2 max-w-md break-all text-[11px] text-[rgba(255,255,255,0.32)]">
        {splatUrl}
      </p>
    </div>
  );
}
