import type { Locale } from "../i18n/dictionaries";

// What only the owner can write. Empty by default: /nosotros then says a note
// from the founder is coming, instead of inventing one. Fill in both
// languages (each passes the same claim rules as the rest of the site:
// src/lib/__tests__/site.test.ts), and optionally a photo in
// public/brand/people/ (a real photo of the owner, with their OK; never the
// character art).

export interface OwnerStory {
  /** "María López, founder" */
  byline: Record<Locale, string>;
  /** A few short paragraphs, in the owner's own words. */
  paragraphs: Record<Locale, string[]>;
  /** Optional: "/brand/people/founder.webp", 480 × 480 or larger. */
  photo: string | null;
}

export const OWNER_STORY: OwnerStory | null = null;
