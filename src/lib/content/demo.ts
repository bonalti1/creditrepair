import { pieceHash } from "./hash";
import { CONTENT_TEMPLATES, templateById } from "./templates";
import { campaignCodeFor, emptyCopy, type ContentAsset, type ContentEvent, type ContentPiece, type ContentResult, type PieceCopy } from "./types";
import { addDays, dayIn } from "./calendar";

// The demo's content board: invented pieces in every column, so the screens
// can be tried without a database. Nothing here is real: the results are
// labelled as the demo's, and nothing is posted anywhere. One piece carries the
// kind of copy the checks exist to stop ("free", a promise, points in days),
// so the inline issues can be seen.

export interface DemoSchedule {
  id: string;
  pieceId: string;
  channel: "facebook" | "instagram" | "tiktok" | "youtube";
  lang: "en" | "es";
  scheduledAt: string;
  status: "scheduled" | "retry" | "publishing" | "posted" | "failed" | "cancelled";
  attempts: number;
  nextAttemptAt: string;
  postedAt: string | null;
  externalId: string | null;
  url: string | null;
  lastError: string | null;
  note: string | null;
  createdBy: string;
  approvalHash: string;
}

export interface DemoContent {
  pieces: ContentPiece[];
  results: ContentResult[];
  schedules: DemoSchedule[];
  events: ContentEvent[];
}

function fromTemplate(id: string): { copy: PieceCopy; characters: ContentPiece["characters"] } {
  const t = templateById(id) ?? CONTENT_TEMPLATES[0]!;
  return { copy: JSON.parse(JSON.stringify(t.copy)) as PieceCopy, characters: [...t.characters] };
}

const asset = (id: string, name: string, mediaType: string, bytes: number, altText: string, at: string, by = "marta"): ContentAsset => ({
  id,
  kind: "upload",
  ref: `demo/${id}.${mediaType.split("/")[1] === "quicktime" ? "mov" : mediaType.split("/")[1]}`,
  name,
  mediaType,
  bytes,
  altText,
  addedBy: by,
  addedAt: at,
});

export function buildDemoContent(now: Date): DemoContent {
  const today = dayIn(now.toISOString());
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const base = (id: string, rest: Partial<ContentPiece> & Pick<ContentPiece, "title" | "type" | "channels" | "language" | "audience" | "theme" | "status">): ContentPiece => ({
    id,
    goal: "",
    copy: emptyCopy(),
    characters: [],
    links: [],
    assets: [],
    owner: "marta",
    dueDate: null,
    campaignCode: campaignCodeFor(id),
    templateId: null,
    aiDraft: false,
    checklist: {},
    approval: null,
    changesNote: null,
    posts: [],
    failure: null,
    createdBy: "marta",
    createdAt: ago(20),
    updatedAt: ago(1),
    ...rest,
  });
  const approve = (p: ContentPiece, by = "carmen", at = ago(3)): ContentPiece => ({ ...p, approval: { by, at, hash: pieceHash(p) } });
  const allTicked: ContentPiece["checklist"] = { logo: true, colours: true, fonts: true, altiLabel: true, altibotCameo: true, languagesMatch: true, captions: true };

  const myth = fromTemplate("myth-fact");
  const fcra = fromTemplate("fcra-30s");
  const letter = fromTemplate("dispute-letter");
  const itin = fromTemplate("itin-spanish");
  const partner = fromTemplate("partner-good-hands");
  const after = fromTemplate("aftercare-building");
  const alti = fromTemplate("meet-alti");

  const pieces: ContentPiece[] = [
    base("pc_demo0001", {
      title: "Credit card myths: closing old cards",
      type: "short_video",
      channels: ["tiktok", "instagram"],
      language: "both",
      audience: "consumers",
      theme: "myths",
      status: "idea",
      goal: "Answer the question we get most in comments.",
      owner: null,
      createdBy: "ana",
    }),
    base("pc_demo0002", {
      title: "What happens after you mail a dispute",
      type: "carousel",
      channels: ["instagram", "facebook"],
      language: "both",
      audience: "consumers",
      theme: "disputes",
      status: "planned",
      dueDate: addDays(today, 6),
      templateId: "dispute-letter",
      copy: { ...letter.copy, hook: { en: "You mailed a dispute. Now what?", es: "Ya enviaste una disputa. ¿Y ahora?" } },
    }),
    base("pc_demo0003", {
      title: "Reel: fix your credit fast (first draft)",
      type: "short_video",
      channels: ["instagram", "tiktok", "facebook"],
      language: "both",
      audience: "hispanic",
      theme: "process",
      status: "in_production",
      dueDate: addDays(today, 3),
      owner: "marta",
      goal: "First draft from a freelancer. Needs rewriting before review.",
      copy: {
        hook: { en: "Fix your credit FREE in 30 days!", es: "¡Arregla tu crédito GRATIS en 30 días!" },
        onScreen: { en: "+100 points in 30 days. Act now!", es: "+100 puntos en 30 días. ¡Solo hoy!" },
        script: {
          en: "We remove the negative items from your report and raise your score. Guaranteed results.",
          es: "Eliminamos lo negativo de tu reporte y te subimos el puntaje. Resultados garantizados.",
        },
        caption: { en: "Real results, guaranteed. Only $49 a month.", es: "Resultados reales y garantizados. Solo $49 al mes." },
        cta: { en: "Act now", es: "Actúa ya" },
      },
    }),
    base("pc_demo0004", {
      title: "Your rights under the FCRA in 30 seconds",
      type: "short_video",
      channels: ["instagram", "tiktok", "youtube", "facebook"],
      language: "both",
      audience: "consumers",
      theme: "rights",
      status: "review",
      dueDate: addDays(today, 2),
      templateId: "fcra-30s",
      copy: fcra.copy,
      checklist: { logo: true, colours: true, fonts: true },
      assets: [asset("as_demo0401", "fcra-30s-v2.mp4", "video/mp4", 38_400_000, "", ago(2))],
    }),
    base("pc_demo0005", {
      title: "Meet Alti, the AI assistant",
      type: "short_video",
      channels: ["instagram", "tiktok", "facebook"],
      language: "both",
      audience: "consumers",
      theme: "team",
      status: "changes",
      dueDate: addDays(today, 8),
      templateId: "meet-alti",
      copy: alti.copy,
      characters: alti.characters,
      changesNote: "Use the waving loop for the first 3 seconds, and keep the AI label on screen the whole time.",
    }),
    approve(
      base("pc_demo0006", {
        title: "ITIN: you can have a credit report too",
        type: "short_video",
        channels: ["instagram", "tiktok", "facebook"],
        language: "both",
        audience: "hispanic",
        theme: "itin",
        status: "approved",
        dueDate: addDays(today, 1),
        templateId: "itin-spanish",
        copy: itin.copy,
        checklist: allTicked,
        assets: [asset("as_demo0601", "itin-reel-es.mp4", "video/mp4", 41_000_000, "", ago(4))],
      }),
    ),
    approve(
      base("pc_demo0007", {
        title: "Partner flyer: your clients in good hands",
        type: "partner",
        channels: ["partners", "email", "whatsapp"],
        language: "both",
        audience: "partners",
        theme: "partners",
        status: "approved",
        templateId: "partner-good-hands",
        copy: partner.copy,
        checklist: allTicked,
        owner: "carmen",
        assets: [asset("as_demo0701", "partner-flyer-letter.pdf", "application/pdf", 840_000, "", ago(6), "carmen")],
      }),
    ),
    approve(
      base("pc_demo0008", {
        title: "Myth: checking your report hurts it",
        type: "short_video",
        channels: ["instagram", "tiktok"],
        language: "both",
        audience: "consumers",
        theme: "myths",
        status: "scheduled",
        dueDate: addDays(today, 4),
        templateId: "myth-fact",
        copy: myth.copy,
        checklist: allTicked,
        links: ["https://credalti.example/preguntas"],
        assets: [asset("as_demo0801", "myth-soft-inquiry.mp4", "video/mp4", 22_000_000, "", ago(3))],
      }),
    ),
    approve(
      base("pc_demo0009", {
        title: "After the letters: building credit",
        type: "carousel",
        channels: ["instagram", "facebook"],
        language: "both",
        audience: "consumers",
        theme: "aftercare",
        status: "measured",
        templateId: "aftercare-building",
        copy: after.copy,
        checklist: allTicked,
        assets: [
          asset("as_demo0901", "build-1.png", "image/png", 410_000, "Navy card with the words: after the letters, what comes next?", ago(14)),
          asset("as_demo0902", "build-2.png", "image/png", 380_000, "Navy card with three habits: pay on time, keep balances low, open accounts slowly.", ago(14)),
        ],
        posts: [{ channel: "instagram", url: "https://www.instagram.com/p/credalti-demo-build", postedAt: ago(9), by: "marta", via: "person" }],
      }),
      "carmen",
      ago(10),
    ),
    approve(
      base("pc_demo0010", {
        title: "What a dispute letter is",
        type: "carousel",
        channels: ["instagram", "facebook"],
        language: "both",
        audience: "consumers",
        theme: "disputes",
        status: "posted",
        templateId: "dispute-letter",
        copy: letter.copy,
        checklist: allTicked,
        assets: [asset("as_demo1001", "letter-1.png", "image/png", 390_000, "A sample letter on navy, labelled Example, with the word Dispute highlighted in gold.", ago(8))],
        posts: [{ channel: "facebook", url: "https://www.facebook.com/credalti.demo/posts/1001", postedAt: ago(2), by: "marta", via: "person" }],
      }),
      "carmen",
      ago(4),
    ),
    base("pc_demo0011", {
      title: "WhatsApp status: weekly reports",
      type: "whatsapp_status",
      channels: ["whatsapp"],
      language: "es",
      audience: "hispanic",
      theme: "rights",
      status: "planned",
      dueDate: addDays(today, 10),
      copy: {
        ...emptyCopy(),
        hook: { en: "", es: "¿Sabías que puedes ver tus tres reportes cada semana?" },
        caption: { en: "", es: "En AnnualCreditReport.com, sin costo. Si algo está mal, tú nos dices qué. Los resultados varían." },
      },
    }),
  ];

  const results: ContentResult[] = [
    { id: "rs_demo1", pieceId: "pc_demo0009", channel: "instagram", source: "manual", at: ago(7), by: "marta", values: { views: 4180, reach: 3020, likes: 212, comments: 18, shares: 41, clicks: 63 } },
    { id: "rs_demo2", pieceId: "pc_demo0009", channel: "instagram", source: "manual", at: ago(2), by: "marta", values: { views: 6950, reach: 5110, likes: 344, comments: 27, shares: 70, clicks: 98, leads: 6, signed: 2 } },
  ];

  const at = (days: number, hour: number) => {
    const d = new Date(now.getTime() + days * 86_400_000);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const scheduled = pieces.find((p) => p.id === "pc_demo0008")!;
  const schedules: DemoSchedule[] = [
    {
      id: "8f3c2b1e-0000-4000-8000-000000000008",
      pieceId: scheduled.id,
      channel: "instagram",
      lang: "en",
      scheduledAt: at(4, 23),
      status: "scheduled",
      attempts: 0,
      nextAttemptAt: at(4, 23),
      postedAt: null,
      externalId: null,
      url: null,
      lastError: null,
      note: null,
      createdBy: "carmen",
      approvalHash: scheduled.approval!.hash,
    },
  ];

  const events: ContentEvent[] = [
    { id: "ev_d1", pieceId: "pc_demo0004", at: ago(5), by: "marta", kind: "created", to: "idea", note: "template:fcra-30s" },
    { id: "ev_d2", pieceId: "pc_demo0004", at: ago(2), by: "marta", kind: "submitted", from: "in_production", to: "review", blocking: 1 },
    { id: "ev_d3", pieceId: "pc_demo0005", at: ago(1), by: "carmen", kind: "changes_requested", from: "review", to: "changes", note: "Use the waving loop for the first 3 seconds, and keep the AI label on screen the whole time." },
    { id: "ev_d4", pieceId: "pc_demo0006", at: ago(3), by: "carmen", kind: "approved", from: "review", to: "approved", hash: pieces[5]!.approval!.hash, blocking: 0 },
  ];

  return { pieces, results, schedules, events };
}
