/**
 * Organizer identity for the event. Only values the organizer has actually
 * supplied are rendered — never invent links, statistics or endorsements.
 *
 * To publish official links, add verified URLs to `links` (they are hidden
 * while empty).
 */
export const ORGANIZER = {
  shortName: "CSI TCE",
  name: "CSI TCE",
  fullName:
    "Computer Society of India, Student Chapter, Thiagarajar College of Engineering",
  college: "Thiagarajar College of Engineering",
  tagline: "Think. Code. Compete.",
  /** Verified official links. Empty until the organizer provides them. */
  links: [] as { label: string; href: string }[],
};

export const EVENT_NAME = "LeetCode Marathon";
