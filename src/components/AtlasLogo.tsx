import Image from "next/image";

export default function AtlasLogo({
  markOnly = false,
  className = "",
  priority = false,
}: {
  markOnly?: boolean;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={markOnly ? "/brand/atlas-mark.png" : "/brand/atlas-lockup.png"}
      alt="Atlas"
      width={markOnly ? 512 : 700}
      height={markOnly ? 512 : 325}
      priority={priority}
      className={className}
    />
  );
}
