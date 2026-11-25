import { canonicalJson, sha256Hex } from "../content/hash";
import type { VideoProject } from "./types";

// What an approval covers: the exact edit (every clip and cut, every word on
// screen, the captions, the logo, the cards, the music and Alti's overlay),
// the media it uses, the script and the post's words, and the language.
// An export records the hash it was rendered from, and approval needs an
// export of today's hash: the file approved is the file that goes out. Any
// change afterwards drops the approval (rules.ts, and the database's trigger).

export function approvedContent(project: Pick<VideoProject, "language" | "plan" | "media" | "edit">) {
  return {
    language: project.language,
    script: project.plan.script,
    postCaption: project.plan.postCaption,
    cta: project.plan.cta,
    media: project.media.map((m) => ({ id: m.id, ref: m.ref, kind: m.kind })).sort((a, b) => a.id.localeCompare(b.id)),
    edit: project.edit,
  };
}

export function projectHash(project: Pick<VideoProject, "language" | "plan" | "media" | "edit">): string {
  return sha256Hex(canonicalJson(approvedContent(project)));
}

/** The newest export, if it was rendered from the project as it is now. */
export function currentExport(project: VideoProject) {
  const hash = projectHash(project);
  const newest = [...project.exports].sort((a, b) => b.at.localeCompare(a.at))[0];
  return newest && newest.hash === hash ? newest : null;
}

export function approvalHolds(project: VideoProject): boolean {
  return Boolean(project.approval && project.approval.hash === projectHash(project));
}
