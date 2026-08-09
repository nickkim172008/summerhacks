import type { Timestamp } from "firebase/firestore";
import type { Profile } from "./types";

const SITE = "https://www.summerhacks.ca";

/**
 * SummerHacks organizers from summerhacks.ca — Discover demo seed only.
 * Not real Firebase accounts; rows are display-only.
 */
const ORGANIZERS: { name: string; school: string; file: string }[] = [
  { name: "Winston Zhao", school: "University of Waterloo", file: "winstonzhao.png" },
  { name: "Lily Song", school: "University of Waterloo", file: "lilysong.png" },
  { name: "Andrew Chu", school: "University of Waterloo", file: "andrewchu.png" },
  { name: "Anita Du", school: "University of Toronto", file: "anitadu.png" },
  { name: "Ivy Cho", school: "Western University", file: "ivycho.png" },
  { name: "Oliver Huang", school: "University of Toronto", file: "oliverhuang.png" },
  { name: "Jerome Heng", school: "University of Toronto", file: "jeromeheng.png" },
  { name: "Matias Rivas", school: "University of Waterloo", file: "matiasrivas.png" },
  { name: "Anton Kuzmichev", school: "University of Waterloo", file: "antonkuzmichev.png" },
  { name: "Elizabeth Ling", school: "University of Waterloo", file: "elizabethling.png" },
  { name: "Claire Liu", school: "University of Waterloo", file: "claireliu.png" },
  { name: "Aricia Chan", school: "Carnegie Mellon University", file: "ariciachan.png" },
  { name: "Monica Trinh", school: "University of Waterloo", file: "monicatrinh.png" },
  { name: "Joonie Kang", school: "University of Toronto", file: "jooniekang.png" },
  { name: "Joanna Wang", school: "Western University", file: "joannawang.png" },
  { name: "Charles Zhang", school: "University of Waterloo", file: "charleszhang.png" },
  { name: "Shalott Tam", school: "University of Waterloo", file: "shalotttam.png" },
  { name: "Jocelyn Xu", school: "University of Waterloo", file: "jocelynxu.png" },
  { name: "Victoria Feng", school: "University of Waterloo", file: "victoriafeng.png" },
  { name: "Jia Naidu", school: "University of Waterloo", file: "jianaidu.png" },
  { name: "Jonathan Wang", school: "University of Waterloo", file: "jonathanwang.png" },
  { name: "Annie Liu", school: "Western University", file: "annieliu.png" },
  { name: "Justin Wu", school: "University of Waterloo", file: "justinwu.png" },
  { name: "Justin Wang", school: "University of Waterloo", file: "justinwang.png" },
  { name: "Alex Gu", school: "University of Waterloo", file: "alexgu.png" },
  { name: "Caitlin Phillips", school: "McMaster University", file: "caitlinphillips.png" },
  { name: "Evan Liem", school: "University of Waterloo", file: "evanliem.png" },
  { name: "Norman Dong", school: "University of Waterloo", file: "normandong.png" },
  { name: "Matthew Mo", school: "University of Waterloo", file: "matthewmo.png" },
];

function usernameFromName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 20);
}

export const DEMO_ORGANIZER_PROFILES: Profile[] = ORGANIZERS.map((org, i) => {
  const username = usernameFromName(org.name);
  return {
    id: `demo-org-${i}`,
    username,
    displayName: org.name,
    photoURL: `${SITE}/team-member-photos/${org.file}`,
    bio: org.school,
    createdAt: null as unknown as Timestamp,
  };
});

export function isDemoOrganizerProfile(profile: Profile) {
  return profile.id.startsWith("demo-org-");
}

export function filterDemoOrganizers(term: string): Profile[] {
  const q = term.trim().toLowerCase();
  if (!q) return DEMO_ORGANIZER_PROFILES;
  return DEMO_ORGANIZER_PROFILES.filter(
    (p) =>
      p.username.startsWith(q) ||
      p.displayName.toLowerCase().startsWith(q) ||
      p.displayName.toLowerCase().includes(q),
  );
}
