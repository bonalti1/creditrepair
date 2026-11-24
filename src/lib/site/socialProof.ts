import { z } from "zod";

// Reviews and press, as the OWNER adds them. Empty by default, and the
// website shows nothing it does not have: no stars, no review counts, no
// "as seen in" logos, no awards. While both lists are empty the home page
// shows an honest "We're new: here is how we earn your trust" block instead,
// and the structured data carries no rating at all.
//
// How to add one (docs/WEBSITE.md, "Reviews and press"):
//  - A review: a real client's own words, copied exactly from where they
//    posted it (Google, BBB, Trustpilot…), with the link to it and the date,
//    and the client's written OK to show it on our site. Shown with the
//    source's name and link, never with a star graphic we draw ourselves.
//    The FTC's rule on consumer reviews (16 C.F.R. part 465) forbids fake or
//    bought reviews and hiding negative ones: add them as they come, not only
//    the good ones.
//  - Press: a real article that mentions Credalti, its outlet, title, date
//    and link. Never an outlet's logo without the outlet's permission.
// Every quote is checked by the same claim rules as the rest of the site
// (src/lib/__tests__/site.test.ts): a review that promises results cannot be
// shown, even if a client wrote it.

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const reviewSchema = z.object({
  /** The client's first name and last initial, as they signed it. */
  author: z.string().min(2).max(60),
  /** Their words, exactly; in the language they wrote them. */
  quote: z.string().min(10).max(600),
  language: z.enum(["en", "es"]),
  /** "Google", "BBB", "Trustpilot"… */
  source: z.string().min(2).max(40),
  /** The public page where the review is. */
  url: z.url(),
  /** The day the client posted it. */
  postedOn: isoDay,
  /** The client agreed in writing to have it shown here. */
  consentOnFile: z.literal(true),
});

export const pressSchema = z.object({
  outlet: z.string().min(2).max(80),
  title: z.string().min(5).max(200),
  url: z.url(),
  publishedOn: isoDay,
});

export type Review = z.infer<typeof reviewSchema>;
export type PressMention = z.infer<typeof pressSchema>;

/** The owner adds real reviews here (see above). */
export const REVIEWS: Review[] = [];

/** The owner adds real press mentions here (see above). */
export const PRESS: PressMention[] = [];

/** Only well-formed entries, so a half-filled one never reaches the page. */
export function publishedReviews(list: readonly unknown[] = REVIEWS): Review[] {
  return list.flatMap((r) => {
    const parsed = reviewSchema.safeParse(r);
    return parsed.success ? [parsed.data] : [];
  });
}

export function publishedPress(list: readonly unknown[] = PRESS): PressMention[] {
  return list.flatMap((p) => {
    const parsed = pressSchema.safeParse(p);
    return parsed.success ? [parsed.data] : [];
  });
}
