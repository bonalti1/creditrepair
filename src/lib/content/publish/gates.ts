import { approvalBlockers, blockingIssues, checkPiece, isImageAsset, isVideoAsset } from "../check";
import { approvalHolds } from "../hash";
import { trackedLink, type ContentPiece, type PublishChannel } from "../types";
import { metaProvider } from "./meta";
import { tiktokProvider } from "./tiktok";
import { PROVIDER_OF, type ConnectionView, type ProviderId, type PublishJob, type PublishMedia, type PublishProvider } from "./types";
import { youtubeProvider } from "./youtube";

// The hard gates before anything is posted, and what exactly is posted. Pure:
// the scheduler (run.ts) calls them at the moment of posting, after claiming
// the schedule, and the console shows the same reasons beside the Schedule
// button. Nothing is posted unless every gate passes:
//
//   1. Publishing is on (the global switch, off by default) and on for the channel.
//   2. The channel's account is connected and its token has not expired.
//   3. The piece is Approved (or Scheduled), and the approval's hash is the hash
//      of exactly what it says and carries now (an edit after approval fails here).
//   4. Zero blocking compliance issues and the checklist ticked, checked again now.
//   5. The channel is one of the piece's channels and the piece has the media the channel needs.

export const PROVIDERS: Record<ProviderId, PublishProvider> = { meta: metaProvider, tiktok: tiktokProvider, youtube: youtubeProvider };

export function providerFor(channel: PublishChannel): PublishProvider {
  return PROVIDERS[PROVIDER_OF[channel]];
}

export interface PublishSettings {
  enabled: boolean;
  channels: Record<PublishChannel, boolean>;
}

export const DEFAULT_PUBLISH_SETTINGS: PublishSettings = { enabled: false, channels: { facebook: false, instagram: false, tiktok: false, youtube: false } };

export type GateCode =
  | "publishing_off"
  | "channel_off"
  | "not_configured"
  | "not_connected"
  | "token_expired"
  | "not_approved"
  | "approval_changed"
  | "blocking_issues"
  | "checklist_open"
  | "channel_not_on_piece"
  | "media_missing";

/** Gates that only hold a post back (it waits); the others cancel it. */
export const HOLDING_GATES: readonly GateCode[] = ["publishing_off", "channel_off", "not_configured", "not_connected", "token_expired"];

export const GATE_TEXT: Record<GateCode, { en: string; es: string }> = {
  publishing_off: { en: "Publishing is off for the whole app. An administrator turns it on in Publishing.", es: "La publicación está apagada para toda la app. Un administrador la enciende en Publicar." },
  channel_off: { en: "Publishing is off for this channel.", es: "La publicación está apagada para este canal." },
  not_configured: { en: "This network is not set up on the server (its keys are missing).", es: "Esta red no está configurada en el servidor (faltan sus claves)." },
  not_connected: { en: "The account for this channel is not connected.", es: "La cuenta de este canal no está conectada." },
  token_expired: { en: "The account's connection expired. Connect it again.", es: "La conexión de la cuenta venció. Conéctala otra vez." },
  not_approved: { en: "Only an approved piece can be posted.", es: "Solo una pieza aprobada se puede publicar." },
  approval_changed: { en: "The piece changed after it was approved, so it needs approval again.", es: "La pieza cambió después de aprobarse, así que necesita aprobación otra vez." },
  blocking_issues: { en: "The piece has blocking compliance issues.", es: "La pieza tiene problemas de cumplimiento que bloquean." },
  checklist_open: { en: "The approval checklist is not complete.", es: "La lista de aprobación no está completa." },
  channel_not_on_piece: { en: "This channel is not one of the piece's channels.", es: "Este canal no es uno de los canales de la pieza." },
  media_missing: { en: "The piece lacks the file this channel needs (a video, or a picture).", es: "A la pieza le falta el archivo que pide este canal (un video o una imagen)." },
};

/** What each channel needs: Instagram a picture or video; TikTok a video or photos; YouTube a video. Facebook can post text. */
export function mediaProblem(piece: ContentPiece, channel: PublishChannel): boolean {
  const uploads = piece.assets.filter((a) => a.kind === "upload");
  const video = uploads.some(isVideoAsset);
  const image = uploads.some(isImageAsset);
  if (channel === "youtube") return !video;
  if (channel === "instagram" || channel === "tiktok") return !video && !image;
  return false;
}

/** The gates that fail for this piece on this channel, now. Empty: it may be posted. */
export function publishGates(input: { piece: ContentPiece; channel: PublishChannel; settings: PublishSettings; connection: ConnectionView | null; now: Date }): GateCode[] {
  const { piece, channel, settings, connection, now } = input;
  const out: GateCode[] = [];
  if (!settings.enabled) out.push("publishing_off");
  if (!settings.channels[channel]) out.push("channel_off");
  if (!connection || !connection.configured) out.push("not_configured");
  else if (!connection.connected) out.push("not_connected");
  // An access token past its time with a refresh token is renewed by the run; without one it is "expired".
  else if (connection.status === "expired" || connection.status === "error") out.push("token_expired");
  void now;
  out.push(...pieceGates(piece, channel));
  return out;
}

/** The gates that depend on the piece alone (also checked when it is scheduled). */
export function pieceGates(piece: ContentPiece, channel: PublishChannel): GateCode[] {
  const out: GateCode[] = [];
  // Posted or failed on one channel, the same approved version may still go out on another.
  if (!["approved", "scheduled", "posted", "measured", "failed"].includes(piece.status)) out.push("not_approved");
  if (!approvalHolds(piece)) out.push("approval_changed");
  const issues = checkPiece(piece);
  if (blockingIssues(issues).length > 0) out.push("blocking_issues");
  if (approvalBlockers(piece, issues).some((b) => b.code === "checklist_open")) out.push("checklist_open");
  if (!piece.channels.includes(channel)) out.push("channel_not_on_piece");
  if (mediaProblem(piece, channel)) out.push("media_missing");
  return out;
}

/** The post itself: the caption in the chosen language, the first link tagged with the piece's code, and the files. */
export function composePost(piece: ContentPiece, channel: PublishChannel, lang: "en" | "es", media: PublishMedia[], scheduleId: string): PublishJob {
  const caption = piece.copy.caption[lang].trim() || piece.copy.hook[lang].trim();
  const link = piece.links[0] ? trackedLink(piece.links[0], piece, channel) : null;
  const text = [caption, link].filter(Boolean).join("\n\n");
  const title = (piece.copy.hook[lang].trim() || piece.title).slice(0, 95);
  return { scheduleId, pieceId: piece.id, channel, contentType: piece.type, text, title, media, language: lang };
}
