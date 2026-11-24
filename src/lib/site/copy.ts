import { BRAND } from "../brand";
import { AFFILIATE_DISCLOSURE, monitoringName } from "../monitoring/offer";
import { CASE_NEXT_ROUND_DAYS, CASE_RESPONSE_DAYS } from "../case/timeline";
import type { Locale } from "../i18n/dictionaries";
import { LIVE_COPY, type LiveCopy } from "./live";

// Every word of the public website (src/app/(site)/), in English and Spanish.
// English first; the Spanish is written, not translated, and says the same
// thing: the same claims, the same disclaimers, nothing added in either.
//
// The rules every line follows (docs/BRAND.md, docs/WEBSITE.md), all checked by
// src/lib/__tests__/site.test.ts in both languages:
//  - Process, never outcome: what we do, never what happens to a report or a
//    score. No "deleted", "removed", "fixed", "guaranteed", "approved", no
//    score numbers, no "+N points". Every line passes checkMarketingCopy.
//  - The client decides what is inaccurate.
//  - No price in the copy. Amounts appear only on /precios, generated from an
//    attorney-approved plan in the catalogue, never written here.
//  - Nothing is called free (the service is not, and monitoring is paid to
//    the provider). "At no cost" is said only of what costs nothing: disputing
//    on your own, cancelling in the first 3 business days, ending the service.
//  - No social proof we do not have (socialProof.ts), no money-back claim, no
//    other company named. Comparisons are against "many companies", only
//    where a product fact backs our side (facts.ts, `facts` on each row).
//  - Plain language: no sentence over 25 words.
//  - Alti is the AI assistant and the only voice: always called AI, never a
//    person. The robot appears only as a small cameo (the About page and
//    the mailing animation's caption, `home.demo.mail`); never as a speaker.

const brand = BRAND.name;
const bot = BRAND.assistant;

export interface Source {
  label: string;
  url: string;
}

export interface Stat {
  figure: string;
  text: string;
  source: Source;
}

export interface CompareRow {
  topic: string;
  us: string;
  them: string;
  /** Product facts (facts.ts) that make `us` true. */
  facts: string[];
}

export interface Step {
  title: string;
  body: string;
}

export interface Qa {
  q: string;
  a: string;
}

export interface SiteCopy {
  meta: Record<"home" | "pricing" | "how" | "faq" | "partners" | "about" | "rights" | "privacy" | "terms", { title: string; description: string }>;
  common: {
    skip: string;
    menu: string;
    close: string;
    nav: { how: string; pricing: string; faq: string; partners: string; about: string };
    signIn: string;
    /** The language switch, written in the other language. */
    switchTo: string;
    switchLabel: string;
    ctaWhatsapp: string;
    ctaOnline: string;
    ctaOnlineAlt: string;
    /** The chat signup with Alti (/registro), offered beside the main button. */
    ctaChat: string;
    whatsappText: string;
    secondary: string;
    underCta: string;
    example: string;
    ai: string;
    aiAssistant: string;
    team: string;
    learnMore: string;
    sourcesTitle: string;
    attorneyPending: string;
  };
  footer: {
    tagline: string;
    product: string;
    company: string;
    legal: string;
    rights: string;
    privacy: string;
    terms: string;
    waitlist: string;
    contact: string;
    support: string;
    disclaimer: string;
    aiDisclosure: string;
    monitoring: string;
    availability: string;
    copyright: (year: number) => string;
  };
  home: {
    eyebrow: string;
    headline: string;
    headlineAccent: string;
    lead: string;
    heroPoints: string[];
    demo: {
      title: string;
      lead: string;
      label: string;
      itemKind: string;
      itemHeader: string;
      intro: string;
      question: string;
      choices: { notMine: string; wrongBalance: string; looksRight: string };
      replies: { notMine: string; wrongBalance: string; looksRight: string };
      typing: string;
      seeCase: string;
      caseTitle: string;
      caseLater: string;
      next: string;
      happened: string;
      restart: string;
      note: string;
      replay: string;
      /** The visitor's answer flying into the case. */
      intoCase: string;
      /** The mailing animation: the only place the robot's cameo appears on the home page. */
      mail: { caption: string; mailed: string; transit: string; delivered: string; label: string };
      /** Invented data for the example item. Not copy about the service. */
      sample: { company: string; original: string; balanceLabel: string; balance: string; openedLabel: string; opened: string; bureausLabel: string; bureaus: string };
    };
    why: { title: string; lead: string; stats: Stat[]; close: string };
    how: { title: string; lead: string; steps: Step[]; cta: string };
    included: { title: string; lead: string; items: Step[] };
    compare: { title: string; lead: string; topic: string; us: string; them: string; rows: CompareRow[]; note: string };
    pricing: { title: string; lead: string; points: string[]; cta: string };
    partners: { title: string; lead: string; cta: string };
    trust: { title: string; lead: string; points: Step[] };
    reviews: { title: string; via: (source: string) => string };
    press: { title: string };
    faq: { title: string; cta: string };
    final: { title: string; lead: string };
    rights: { title: string; points: string[]; cta: string };
  };
  pricing: {
    eyebrow: string;
    title: string;
    lead: string;
    plansTitle: string;
    noPlans: string;
    noPlansSub: string;
    planMost: string;
    rulesTitle: string;
    rules: Step[];
    includedTitle: string;
    includedLead: string;
    monitoringTitle: string;
    monitoring: string;
    disclosure: string;
    cancelTitle: string;
    cancel: string[];
  };
  how: {
    eyebrow: string;
    title: string;
    lead: string;
    stages: Array<Step & { alt: string; caption: string }>;
    roundsTitle: string;
    rounds: string[];
    youTitle: string;
    you: string[];
    weTitle: string;
    we: string[];
    screensNote: string;
  };
  faq: { eyebrow: string; title: string; lead: string; items: Qa[]; still: string };
  partners: {
    eyebrow: string;
    title: string;
    lead: string;
    who: Step[];
    sharingTitle: string;
    sharing: string[];
    feesOff: string;
    feesOn: string;
    cta: string;
  };
  about: {
    eyebrow: string;
    title: string;
    lead: string;
    storyTitle: string;
    storyPending: string;
    charactersTitle: string;
    alti: string;
    altibot: string;
    rulesTitle: string;
    rules: Step[];
    whereTitle: string;
    where: string;
  };
  /** The interactive pieces' words (live.ts). */
  live: LiveCopy;
  rights: { eyebrow: string; title: string; lead: string; selfTitle: string; self: string[]; statementTitle: string; officialNote: string; moreTitle: string; links: Source[] };
  privacy: { eyebrow: string; title: string; lead: string; sections: Step[]; pending: string };
  terms: { eyebrow: string; title: string; lead: string; sections: Step[]; pending: string };
}

// ── Sources for "Why it matters" ─────────────────────────────────────────
// Each figure is quoted from the page linked beside it (checked 2026-11-24
// through search results; the pages themselves were outside this build's
// network allow-list, so the owner opens each once before launch).
const FTC_2013: Source = {
  label: "FTC, 2013",
  url: "https://www.ftc.gov/news-events/news/press-releases/2013/02/ftc-study-five-percent-consumers-had-errors-their-credit-reports-could-result-less-favorable-terms",
};
const FTC_EMPLOYERS: Source = { label: "FTC", url: "https://consumer.ftc.gov/articles/employer-background-checks-and-your-rights" };
const FTC_WEEKLY: Source = { label: "FTC, 2023", url: "https://consumer.ftc.gov/consumer-alerts/2023/10/you-now-have-permanent-access-free-weekly-credit-reports" };
const CROA_1679C: Source = { label: "15 U.S.C. §1679c", url: "https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title15-section1679c" };

const en: SiteCopy = {
  meta: {
    home: {
      title: `${brand} — Errors on your credit report? A team that shows you every step`,
      description: `Tell us what's wrong on your report. Our team prepares and mails the letters, and you see every one, with its dates. In English or Spanish. Results vary.`,
    },
    pricing: {
      title: `Pricing · ${brand}`,
      description: "How you pay: nothing is charged until the work is done, and the most you'll pay is written before you sign.",
    },
    how: {
      title: `How it works · ${brand}`,
      description: `From your first chat to every letter in Mi caso: how ${brand} works, step by step, with screens from the real app.`,
    },
    faq: {
      title: `Questions · ${brand}`,
      description: "Honest answers about costs, timing, your rights, cancelling, Spanish, ITIN and what we can't do.",
    },
    partners: {
      title: `For partners · ${brand}`,
      description: `Realtors, loan officers, tax preparers, car dealers, attorneys and more: refer clients to ${brand} and, with their OK, follow their progress.`,
    },
    about: {
      title: `About us · ${brand}`,
      description: `Who we are, who ${bot} is, and the rules we work by.`,
    },
    rights: {
      title: `Your rights · ${brand}`,
      description: "Your rights under federal law, including the consumer credit file rights statement, in English and Spanish.",
    },
    privacy: { title: `Privacy · ${brand}`, description: `How ${brand} handles your information. Draft notice, pending attorney review.` },
    terms: { title: `Terms · ${brand}`, description: `The terms for using the ${brand} website. Draft, pending attorney review.` },
  },
  common: {
    skip: "Skip to content",
    menu: "Menu",
    close: "Close",
    nav: { how: "How it works", pricing: "Pricing", faq: "Questions", partners: "For partners", about: "About us" },
    signIn: "Sign in",
    switchTo: "Español",
    switchLabel: "Cambiar a español",
    ctaWhatsapp: "Start my review",
    ctaOnline: "Start my review",
    ctaOnlineAlt: "Or start online",
    ctaChat: `Or sign up in a chat with ${BRAND.assistant}, in about 10 minutes`,
    whatsappText: `Hi! I want to start my credit report review with ${brand}.`,
    secondary: "See how it works",
    underCta: "Nothing is charged until work is done · 3 business days to cancel at no cost · Results vary",
    example: "Example",
    ai: "AI",
    aiAssistant: "AI assistant",
    team: `Your ${brand} team`,
    learnMore: "Learn more",
    sourcesTitle: "Source",
    attorneyPending: "Draft · pending attorney review",
  },
  footer: {
    tagline: "You tell us what's wrong. Our team prepares and mails the letters, and you see every step.",
    product: "Service",
    company: "Company",
    legal: "Your rights and legal",
    rights: "Your rights (CROA)",
    privacy: "Privacy and GLBA notice",
    terms: "Terms",
    waitlist: "Not in Texas? Join the waitlist",
    contact: "Contact",
    support: "Support line",
    disclaimer: `${brand} is a credit services company. You decide what is inaccurate on your report; our team prepares and mails the letters for you. We do not guarantee results: the credit bureaus decide, and results vary case by case. No one can take correct, current information off a credit report. You can dispute errors with the bureaus yourself, at no cost. Available in Texas. This is not legal advice.`,
    aiDisclosure: `${bot} is an artificial intelligence assistant, not a person and not a lawyer. You can ask for a person on our team at any time.`,
    monitoring: `The service requires an active credit monitoring subscription, bought and paid for separately from an independent monitoring service. ${AFFILIATE_DISCLOSURE.en}`,
    availability: "Available in Texas.",
    copyright: (year) => `© ${year} ${brand}`,
  },
  home: {
    eyebrow: "Credit report help, in English or Spanish",
    headline: "Something wrong on your credit report?",
    headlineAccent: "A real team handles the letters.",
    lead: "You tell us what's wrong. Our team prepares and mails the dispute letters, and you see every one, with its dates, in your app.",
    heroPoints: ["Nothing charged until the work is done", "Every letter and date, in your app", `A team on WhatsApp, and ${bot}, our AI`],
    demo: {
      title: "Try it: 20 seconds with a sample item",
      lead: `This is how the app works. ${bot}, our AI assistant, explains an item. You decide. Then you see what happens and when.`,
      label: "Example · sample data",
      itemKind: "Collection",
      itemHeader: "One item from your report",
      intro: `This is a collection. A debt collector says you owe this balance on an old phone account.`,
      question: "Does anything here look wrong to you?",
      choices: { notMine: "It's not mine", wrongBalance: "Wrong balance", looksRight: "Looks right" },
      replies: {
        notMine: `Got it: you say this account isn't yours. Your team prepares letters asking the bureaus and the collector to check it. You'll see every date.`,
        wrongBalance: `Got it: you say the balance is wrong. Your team prepares letters asking the bureaus and the collector to check the amount. You'll see every date.`,
        looksRight: "Thanks. If it's correct, we leave it alone: no one can take accurate, current information off a report. No letter goes out about it.",
      },
      typing: `${bot} is writing`,
      seeCase: "See it in Mi caso",
      caseTitle: "Mi caso",
      caseLater: "Example · a few days later",
      next: "What comes next",
      happened: "What already happened",
      restart: "Try another answer",
      note: `Sample item and invented dates. ${bot} is AI: he explains, and you decide. Results vary.`,
      replay: "Replay",
      intoCase: "Your answer goes into your case",
      mail: {
        caption: `${BRAND.cameo} carries your letters`,
        mailed: "Mailed",
        transit: "On the way",
        delivered: "Delivered ✓",
        label: "Your letters on their way: mailed, on the way, delivered",
      },
      sample: {
        company: "Sample Collections",
        original: "Original creditor: Sample Mobile",
        balanceLabel: "Balance",
        balance: "$412",
        openedLabel: "Reported since",
        opened: "March 2023",
        bureausLabel: "On your reports at",
        bureaus: "Experian, TransUnion",
      },
    },
    why: {
      title: "Why it matters",
      lead: "Your credit report follows you into more places than loans. Mistakes on it happen more often than people think.",
      stats: [
        { figure: "1 in 5", text: "people in a study for Congress had an error on at least one of their three credit reports.", source: FTC_2013 },
        { figure: "1 in 20", text: "had errors that could mean paying more for things like auto loans and insurance.", source: FTC_2013 },
        { figure: "Jobs", text: "Employers may look at your credit report when you apply, with your written permission.", source: FTC_EMPLOYERS },
        { figure: "Rentals", text: "The law names credit, jobs, insurance and rentals among the decisions a credit report can affect.", source: CROA_1679C },
      ],
      close: "You can see your three reports at no cost every week at AnnualCreditReport.com.",
    },
    how: {
      title: "How it works",
      lead: "Four steps. You make the decisions; the team does the paperwork and the mailing.",
      steps: [
        { title: "Talk to us", body: "Chat with a person on WhatsApp, or start online. We explain the plan and the most you'll pay before you sign anything." },
        { title: "Bring in your report", body: `Connect ${monitoringName("en")} and upload your ID and proof of address. Your team brings in your three-bureau report.` },
        { title: "Say what's wrong", body: `${bot} explains each item in plain words. You mark only what you believe is inaccurate, and you say why.` },
        { title: "We mail, you follow", body: "Your team prepares and mails the letters. Mi caso shows each letter and its dates. About every 40 days, we look again." },
      ],
      cta: "The full journey",
    },
    included: {
      title: "What you get. Everyone gets all of it.",
      lead: "There are no basic and premium tiers. Every client gets the same service.",
      items: [
        { title: "All three bureaus", body: "Equifax, Experian and TransUnion, every round." },
        { title: "Every kind of item", body: "Accounts, collections, inquiries and personal information, explained one by one." },
        { title: "Letters to the right places", body: "To the bureaus and, where it fits, to the creditor or the collector." },
        { title: "Certified mail where it counts", body: "Letters to creditors and collectors, and follow-ups, go certified, with tracking." },
        { title: "Mi caso", body: "Every letter, who it went to, when it was mailed and when it arrived." },
        { title: `${bot}, in two languages`, body: "Our AI assistant explains your report in English or Spanish, any time. You can also listen instead of reading." },
        { title: "A real team on WhatsApp", body: "People who answer your questions and keep your case moving." },
        { title: "On schedule", body: "Follow-ups and new rounds run on their dates. You get a message when letters go out." },
      ],
    },
    compare: {
      title: "How we compare",
      lead: "Facts about our service, next to what is common in this industry. Ask any company these same questions.",
      topic: "What to check",
      us: brand,
      them: "Many companies",
      rows: [
        {
          topic: "When you're charged",
          us: "Only after the work: each charge pays for letters already mailed. No fee to sign up.",
          them: "A first work fee plus a monthly fee.",
          facts: ["charge-after-work", "no-setup-fee", "first-work-fee-after-round"],
        },
        {
          topic: "The total",
          us: "The most you'll pay is written in your agreement before you sign. Never more than one charge every 30 days.",
          them: "A monthly fee that runs until you cancel.",
          facts: ["most-youll-pay", "every-30-days"],
        },
        {
          topic: "What's included",
          us: "One service for everyone: three bureaus, inquiries, and letters to creditors and collectors.",
          them: "Some features, like inquiry disputes or three-bureau reports, only in higher-priced plans.",
          facts: ["no-feature-tiers", "three-bureaus", "inquiry-letters", "creditor-collector-letters"],
        },
        {
          topic: "Seeing the work",
          us: "Every letter, who it went to, and when it was mailed and delivered, in Mi caso.",
          them: "Progress updates and a summary of the work.",
          facts: ["case-timeline", "certified-mail"],
        },
        {
          topic: "Spanish",
          us: "The same site and app in English or Spanish, one tap away.",
          them: "Sometimes a separate Spanish website.",
          facts: ["bilingual-one-site", "assistant-explains"],
        },
        {
          topic: "Promises",
          us: "No promises about your report or your score. The bureaus decide, and results vary.",
          them: "Ads with score-change examples.",
          facts: ["no-outcome-claims", "client-decides"],
        },
      ],
      note: "“Many companies” describes plans and ads we have seen in this industry, not any one company.",
    },
    pricing: {
      title: "Nothing is charged until the work is done",
      lead: "We explain the plan before you sign. Then every charge comes after the work it pays for.",
      points: [
        "No fee to sign up, and none when letters are only prepared",
        "The most you'll pay, written before you sign",
        "3 business days to cancel at no cost; after that, end the service any time",
      ],
      cta: "How pricing works",
    },
    partners: {
      title: "Realtors, loan officers, tax preparers and more",
      lead: "Refer a client and, if they choose to share it, follow their progress: the steps and the dates, never their credit information.",
      cta: "The partner program",
    },
    trust: {
      title: "We're new. Here is how we earn your trust.",
      lead: "We don't have years of reviews yet. So instead of asking you to trust us, we show you everything.",
      points: [
        { title: "You see every letter", body: "Who it went to, the date it was mailed and the date it arrived." },
        { title: "You know the most you'll pay", body: "It is written in your agreement before you sign, and on your payments screen." },
        { title: "You pay after the work", body: "Each charge pays for letters already mailed. Nothing before." },
        { title: "No promises", body: "No one can promise what a bureau will decide. Be careful with anyone who does." },
      ],
    },
    reviews: { title: "What clients say", via: (source) => `on ${source}` },
    press: { title: "In the news" },
    faq: { title: "Questions people ask first", cta: "All questions" },
    final: {
      title: "Start with a conversation",
      lead: "Tell us what you see on your report. A person explains how we work and the plan, before you sign anything.",
    },
    rights: {
      title: "Your rights, up front",
      points: [
        "You can dispute errors with the credit bureaus yourself, at no cost.",
        "No one can have accurate, current information taken off your report. That includes us.",
        "You have 3 business days after signing to cancel at no cost.",
      ],
      cta: "Read your rights",
    },
  },
  pricing: {
    eyebrow: "Pricing",
    title: "Nothing is charged until the work is done",
    lead: "Federal law says a credit repair company can't charge before the work is done. Our billing is built so it can't.",
    plansTitle: "Plans",
    noPlans: "Plans and prices are explained before you sign.",
    noPlansSub: "A person on our team goes over the plan with you. It is written in your agreement, with the most you'll pay. Nothing is charged until work is done.",
    planMost: "Most you'll pay",
    rulesTitle: "How every charge works",
    rules: [
      { title: "After the work, always", body: "A charge pays for a round of letters already mailed. Never at sign-up, and never for letters that are only prepared." },
      { title: "No sign-up fee", body: "There is no setup, enrollment or activation fee. If a plan has a first work fee, it waits until your first round is mailed." },
      { title: "The most you'll pay", body: "Every plan has a total it can never go over. You see it before you sign, in your agreement and in My payments." },
      { title: "At most once every 30 days", body: "Charges are at least 30 days apart. A 30-day period with no work has no charge." },
      { title: "Households", body: "A plan can include a discount when two people in the same household sign up." },
    ],
    includedTitle: "Included for everyone",
    includedLead: "Whatever the plan, the service is the same.",
    monitoringTitle: "Credit monitoring is separate",
    monitoring: `The service needs ${monitoringName("en")}. You buy it from the monitoring service and pay them directly, not us. You can cancel it with them.`,
    disclosure: AFFILIATE_DISCLOSURE.en,
    cancelTitle: "Changing your mind",
    cancel: [
      "You have 3 business days after signing to cancel at no cost.",
      "After that, you can end the service any time, from the app or in writing. Ending it costs nothing.",
      "You pay only for work fully done before we receive your request.",
    ],
  },
  how: {
    eyebrow: "How it works",
    title: "Every step, from your first message to every letter",
    lead: "Here is the whole journey, with screens from the real app. You decide what is wrong. We do the paperwork and keep you posted.",
    stages: [
      {
        title: "1. Talk to a person",
        body: "Message us on WhatsApp or start online. A person explains how we work, the plan and the most you'll pay. If you decide to start, you sign your agreement in the app.",
        alt: `The ${brand} welcome screen when the team sends your link`,
        caption: "Your welcome, with your team",
      },
      {
        title: "2. Your report comes in",
        body: `You connect ${monitoringName("en")} and upload your ID and proof of address. Your team brings in your report from all three bureaus.`,
        alt: "Mi caso, showing the steps of a case and their dates",
        caption: "Mi caso: what is happening, and what comes next",
      },
      {
        title: `3. Review it with ${bot}`,
        body: `${bot}, our AI assistant, explains each item in plain words. You mark only what you believe is inaccurate, outdated or unverifiable, and say why.`,
        alt: `${bot} explaining one item of the report`,
        caption: `${bot} explains; you decide`,
      },
      {
        title: "4. We prepare and mail the letters",
        body: "From your answers, the team prepares the letters to the bureaus and, where it fits, to the creditor or collector. Then we mail them.",
        alt: "The letters of a round and the status of each one",
        caption: "Each letter, with its status",
      },
      {
        title: "5. Build your credit, too",
        body: "Your app has a plan to build credit, ordered by your own report, plus a home-ready path and an ITIN guide. General information, alongside the service.",
        alt: "The build-your-credit plan in the app, with its habits",
        caption: "Your plan, at your own pace",
      },
    ],
    roundsTitle: "Then, round by round",
    rounds: [
      `The bureaus usually have about ${CASE_RESPONSE_DAYS} days to answer a dispute. The law gives them that time.`,
      `About every ${CASE_NEXT_ROUND_DAYS} days, your team looks at your report again and shows you what changed and what didn't.`,
      "If you want, the next round follows up on the same items, plus anything new you mark.",
      "How many rounds a case needs varies. No one can promise a timeline or a result.",
    ],
    youTitle: "What you do",
    you: ["Tell us what is wrong, item by item, and why", "Upload your ID and proof of address", "Keep your monitoring active", "Read the updates, and ask anything"],
    weTitle: "What your team does",
    we: ["Brings in your report every round", "Prepares and mails your letters", "Tracks delivery and records every date", "Reads the answers and tells you what they say"],
    screensNote: "Screens from the app's demo, with sample data.",
  },
  faq: {
    eyebrow: "Questions",
    title: "Honest answers",
    lead: "About costs, timing, your rights and what we can't do. If yours isn't here, ask us on WhatsApp.",
    items: [
      {
        q: `What does ${brand} do?`,
        a: `You tell us what is inaccurate on your credit report. Our team prepares and mails the dispute letters for you, and shows you each one in Mi caso. Your app also has a plan to build credit and a path if you're getting ready to buy a home.`,
      },
      {
        q: "Who decides what gets disputed?",
        a: "You do. You go through your report and mark what you believe is wrong, and why. Nothing goes into a letter unless you confirmed it.",
      },
      {
        q: "Can you promise my report or score will change?",
        a: "No. The credit bureaus decide, and results vary case by case. Anyone who promises a result can't know it.",
      },
      {
        q: "Can I dispute errors myself?",
        a: "Yes. You can write to a credit bureau yourself, and it can't charge you for looking into it. We do the work for you if you'd rather not.",
      },
      {
        q: "What can't you do?",
        a: "We can't have accurate, current information taken off your report, and we don't dispute what you know is correct. We are not a lender and don't give legal advice.",
      },
      {
        q: "How much does it cost?",
        a: "Our team explains the plan before you sign, and it is written in your agreement with the most you'll pay. Each charge pays for work already done.",
      },
      {
        q: "When am I charged?",
        a: "Only after the work: for example, after a round of letters is mailed. Never at sign-up, and never more than once every 30 days.",
      },
      {
        q: "Is there a sign-up or setup fee?",
        a: "No. If a plan has a first work fee, it is charged only after your first round of letters is mailed.",
      },
      {
        q: "Why do I need credit monitoring?",
        a: `It is how your team sees your report from all three bureaus. It is a separate subscription you pay to the monitoring service. ${AFFILIATE_DISCLOSURE.en}`,
      },
      {
        q: "Can I cancel?",
        a: "Yes. You have 3 business days after signing to cancel at no cost. After that you can end the service any time; you pay only for work already done.",
      },
      {
        q: "How long does it take?",
        a: `Letters go out in rounds, about every ${CASE_NEXT_ROUND_DAYS} days. The bureaus have about ${CASE_RESPONSE_DAYS} days to answer. How many rounds a case needs varies.`,
      },
      {
        q: "How will I know what's happening?",
        a: "Mi caso shows every step with its date: each letter, who it went to, when it was mailed and when it arrived. We also message you on WhatsApp.",
      },
      {
        q: `Who is ${bot}?`,
        a: `${bot} is our AI assistant. It explains your report in plain words. It is not a person and not a lawyer, and it never decides for you.`,
      },
      {
        q: "Can I talk to a real person?",
        a: "Yes. A person on our team answers on WhatsApp, from your first question on.",
      },
      {
        q: "Do you work in Spanish?",
        a: "Yes. The site, the app, the explanations and the team all work in English or Spanish. You switch with one tap.",
      },
      {
        q: "I use an ITIN instead of a Social Security number. Can I sign up?",
        a: "Yes, you can have a credit file with your ITIN. The monitoring service checks your identity, so message us before you start. Your app has an ITIN guide: reports by mail, building credit and home loans.",
      },
      {
        q: "Does this have anything to do with immigration status?",
        a: `No. Reviewing and disputing your own credit report is a right every consumer has under federal law (FCRA). ${brand} doesn't ask for immigration information.`,
      },
      {
        q: "Where are you available?",
        a: "In Texas today. We open state by state, because each state has its own rules. Elsewhere, you can join the waitlist.",
      },
      {
        q: "How do you protect my information?",
        a: "Your case is protected in our database so only you and your team can read it. Card and bank numbers go to the payment processor, never to us.",
      },
      {
        q: "Can my loan officer or realtor follow my progress?",
        a: "Only if you choose to share it, and you can stop any time. They see steps and dates, never your credit information.",
      },
    ],
    still: "Still have a question? Our team answers on WhatsApp.",
  },
  partners: {
    eyebrow: "For partners",
    title: "Help your clients get ready, without the paperwork",
    lead: `You meet people who need help with their credit report before a mortgage, a car, a tax refund or a fresh start. Refer them to ${brand}; our team does the rest, and you can see who on the team takes care of them.`,
    who: [
      { title: "Realtors", body: "Buyers who found something wrong on their report get a team that handles the letters." },
      { title: "Loan officers", body: "With your client's OK, follow each round's dates so you know when to look again." },
      { title: "Tax preparers", body: "Point clients to help in English or Spanish, at a time when they think about money." },
      { title: "Car dealers", body: "A buyer who thinks their report has a mistake gets a team that explains the process first." },
      { title: "Attorneys", body: "Clients with questions about their credit report get a team that works only on what they say is wrong." },
      { title: "Anyone who helps with money", body: "Counselors, coaches, community groups: refer the people who ask you about their report." },
    ],
    sharingTitle: "Progress sharing, with your client's consent",
    sharing: [
      "Your client chooses what you see: progress only, or progress and a summary. They can stop sharing any time.",
      "You see steps and dates: signed, letters mailed, next round. Never their credit report or their answers.",
      "We describe the process, never a result. Please do the same with your clients.",
    ],
    feesOff: "For now, the partner program pays no referral fees.",
    feesOn: "Referral fees are paid under written terms and must be disclosed to your clients.",
    cta: "Apply below",
  },
  about: {
    eyebrow: "About us",
    title: "A credit services company that shows its work",
    lead: `${brand} helps people dispute what they believe is wrong on their credit reports. You decide; our team prepares and mails the letters; you see every step.`,
    storyTitle: "Our story",
    storyPending: "A note from our founder is coming soon.",
    charactersTitle: `Meet ${bot}, our AI assistant`,
    alti: `${bot} is our AI assistant. He explains your report in plain words, in English or Spanish. ${bot} is artificial intelligence, not a person and not a lawyer. Every message he writes says so.`,
    altibot: `You may also spot ${BRAND.cameo}, a small robot who carries the envelopes in our animations. ${BRAND.cameo} doesn't chat. When a person on our team writes to you, you see their own name.`,
    rulesTitle: "The rules we work by",
    rules: [
      { title: "No promises", body: "We say what we do, never what a bureau will decide. Results vary." },
      { title: "You decide", body: "Only what you tell us is inaccurate goes into a letter. Nobody marks anything for you." },
      { title: "Pay after the work", body: "Every charge pays for work already done, up to the most you'll pay." },
      { title: "Show everything", body: "Every letter and every date, in your app." },
      { title: "Your language", body: "English or Spanish, on the same site and app." },
    ],
    whereTitle: "Where we work",
    where: "We are available in Texas today. Each state has its own rules for credit services, so we open one state at a time.",
  },
  live: LIVE_COPY.en,
  rights: {
    eyebrow: "Your rights",
    title: "Your rights, before anything else",
    lead: "Federal law gives you these rights. We show them to you before you sign, and here, for anyone to read.",
    selfTitle: "In plain words",
    self: [
      "You can dispute inaccurate information yourself, directly with the credit bureau, at no cost.",
      "No one has the right to have accurate, current and verifiable information taken off your report.",
      "You can get copies of your reports at AnnualCreditReport.com.",
      "You can cancel a contract with a credit repair company within 3 business days of signing, for any reason.",
      "You can sue a credit repair company that breaks the Credit Repair Organizations Act.",
    ],
    statementTitle: "The statement the law requires",
    officialNote: "This is the statement as our draft agreement shows it. It is pending attorney review and word-for-word checking against the official text.",
    moreTitle: "More from the government",
    links: [
      { label: "Disputing errors on your credit reports (FTC)", url: "https://consumer.ftc.gov/articles/disputing-errors-your-credit-reports" },
      { label: "Your three credit reports (AnnualCreditReport.com)", url: "https://www.annualcreditreport.com" },
      { label: "Credit reports and scores (CFPB)", url: "https://www.consumerfinance.gov/consumer-tools/credit-reports-and-scores/" },
    ],
  },
  privacy: {
    eyebrow: "Privacy",
    title: "Privacy and GLBA notice",
    lead: "This is a draft. The full notice will be published after attorney review. Here is what we can already tell you plainly.",
    sections: [
      { title: "What we collect", body: "Your contact details and your answers in the app. Your ID and proof of address. Your credit report, through your monitoring service. Your messages with us." },
      { title: "Why", body: "To prepare and mail your letters, keep you posted, bill for work done, and meet the law's record-keeping rules." },
      { title: "Who sees it", body: "You and the people on your team who work on your case. A partner sees your progress only if you choose to share it." },
      { title: "Payments", body: "Card and bank numbers are typed into the payment processor's own fields. We receive a token, never the numbers." },
      { title: "Cookies", body: "One to remember your language. One for 60 days if a partner's link sent you. And the ones that keep you signed in." },
      { title: "Your choices", body: "You can ask us for a copy of what we hold, or stop messages, by writing to us." },
    ],
    pending: "Draft · pending attorney review. The Gramm-Leach-Bliley Act (GLBA) privacy notice will be published here.",
  },
  terms: {
    eyebrow: "Terms",
    title: "Website terms",
    lead: "This is a draft. The final terms will be published after attorney review. Your service agreement is a separate document you read and sign in the app.",
    sections: [
      { title: "What this site is", body: `Information about ${brand}'s credit services. It is not legal advice and not an offer of credit.` },
      { title: "The example", body: `The ${bot} example on our home page uses a sample item and invented dates. It shows how the app works, not what will happen in your case.` },
      { title: "Your agreement", body: "The service starts only with a signed agreement. It includes your rights, the plan, the most you'll pay and how to cancel." },
      { title: "Availability", body: "The service is available in Texas. Elsewhere, you can join the waitlist." },
    ],
    pending: "Draft · pending attorney review.",
  },
};

const es: SiteCopy = {
  meta: {
    home: {
      title: `${brand} — ¿Errores en tu reporte de crédito? Un equipo que te muestra cada paso`,
      description: `Dinos qué está mal en tu reporte. Nuestro equipo prepara y envía las cartas, y tú ves cada una, con sus fechas. En inglés o en español. Los resultados varían.`,
    },
    pricing: {
      title: `Precios · ${brand}`,
      description: "Cómo pagas: no se cobra nada hasta que el trabajo está hecho, y lo máximo que pagarás queda escrito antes de firmar.",
    },
    how: {
      title: `Cómo funciona · ${brand}`,
      description: `De tu primer mensaje a cada carta en Mi caso: cómo funciona ${brand}, paso a paso, con pantallas de la app real.`,
    },
    faq: {
      title: `Preguntas · ${brand}`,
      description: "Respuestas honestas sobre costos, tiempos, tus derechos, cancelar, español, ITIN y lo que no podemos hacer.",
    },
    partners: {
      title: `Para socios · ${brand}`,
      description: `Agentes, oficiales de préstamos, preparadores de impuestos, concesionarios, abogados y más: refieran clientes a ${brand} y sigan su avance si ellos aceptan.`,
    },
    about: {
      title: `Nosotros · ${brand}`,
      description: `Quiénes somos, quién es ${bot} y las reglas con las que trabajamos.`,
    },
    rights: {
      title: `Tus derechos · ${brand}`,
      description: "Tus derechos según la ley federal, con la declaración de derechos sobre tu expediente de crédito, en inglés y en español.",
    },
    privacy: { title: `Privacidad · ${brand}`, description: `Cómo maneja ${brand} tu información. Aviso en borrador, pendiente de revisión del abogado.` },
    terms: { title: `Términos · ${brand}`, description: `Los términos de uso del sitio de ${brand}. Borrador, pendiente de revisión del abogado.` },
  },
  common: {
    skip: "Ir al contenido",
    menu: "Menú",
    close: "Cerrar",
    nav: { how: "Cómo funciona", pricing: "Precios", faq: "Preguntas", partners: "Para socios", about: "Nosotros" },
    signIn: "Entrar",
    switchTo: "English",
    switchLabel: "Switch to English",
    ctaWhatsapp: "Empezar mi revisión",
    ctaOnline: "Empezar mi revisión",
    ctaOnlineAlt: "O empieza en línea",
    ctaChat: `O regístrate en un chat con ${BRAND.assistant}, en unos 10 minutos`,
    whatsappText: `¡Hola! Quiero empezar la revisión de mi reporte de crédito con ${brand}.`,
    secondary: "Ver cómo funciona",
    underCta: "No se cobra nada hasta que el trabajo está hecho · 3 días hábiles para cancelar sin costo · Los resultados varían",
    example: "Ejemplo",
    ai: "IA",
    aiAssistant: "Asistente con IA",
    team: `Tu equipo ${brand}`,
    learnMore: "Saber más",
    sourcesTitle: "Fuente",
    attorneyPending: "Borrador · pendiente de revisión del abogado",
  },
  footer: {
    tagline: "Tú nos dices qué está mal. Nuestro equipo prepara y envía las cartas, y tú ves cada paso.",
    product: "Servicio",
    company: "Empresa",
    legal: "Tus derechos y lo legal",
    rights: "Tus derechos (CROA)",
    privacy: "Privacidad y aviso GLBA",
    terms: "Términos",
    waitlist: "¿No vives en Texas? Únete a la lista de espera",
    contact: "Contacto",
    support: "Línea de ayuda",
    disclaimer: `${brand} es una empresa de servicios de crédito. Tú decides qué es inexacto en tu reporte; nuestro equipo prepara y envía las cartas por ti. No garantizamos resultados: los burós de crédito deciden, y los resultados varían según cada caso. Nadie puede quitar de un reporte información que es correcta y actual. Puedes disputar errores con los burós por tu cuenta, sin costo. Disponible en Texas. Esto no es asesoría legal.`,
    aiDisclosure: `${bot} es un asistente de inteligencia artificial: no es una persona ni un abogado. Puedes pedir hablar con una persona del equipo cuando quieras.`,
    monitoring: `El servicio requiere una suscripción activa de monitoreo de crédito, que se contrata y se paga aparte, con un servicio de monitoreo independiente. ${AFFILIATE_DISCLOSURE.es}`,
    availability: "Disponible en Texas.",
    copyright: (year) => `© ${year} ${brand}`,
  },
  home: {
    eyebrow: "Ayuda con tu reporte de crédito, en inglés o en español",
    headline: "¿Algo mal en tu reporte de crédito?",
    headlineAccent: "Un equipo real se encarga de las cartas.",
    lead: "Tú nos dices qué está mal. Nuestro equipo prepara y envía las cartas de disputa, y tú ves cada una, con sus fechas, en tu app.",
    heroPoints: ["No se cobra hasta que el trabajo está hecho", "Cada carta y cada fecha, en tu app", `Un equipo en WhatsApp, y ${bot}, nuestra IA`],
    demo: {
      title: "Pruébalo: 20 segundos con un punto de ejemplo",
      lead: `Así funciona la app. ${bot}, nuestro asistente con IA, te explica un punto. Tú decides. Luego ves qué pasa y cuándo.`,
      label: "Ejemplo · datos de muestra",
      itemKind: "Cobranza",
      itemHeader: "Un punto de tu reporte",
      intro: "Esto es una cobranza. Una agencia de cobro dice que debes este saldo de una cuenta de teléfono vieja.",
      question: "¿Ves algo que esté mal?",
      choices: { notMine: "No es mía", wrongBalance: "El saldo está mal", looksRight: "Está bien" },
      replies: {
        notMine: "Entendido: dices que esta cuenta no es tuya. Tu equipo prepara cartas para pedir a los burós y a la agencia que la revisen. Verás cada fecha.",
        wrongBalance: "Entendido: dices que el saldo está mal. Tu equipo prepara cartas para pedir a los burós y a la agencia que revisen la cantidad. Verás cada fecha.",
        looksRight: "Gracias. Si es correcta, no la tocamos: nadie puede quitar de un reporte información exacta y actual. No sale ninguna carta sobre ella.",
      },
      typing: `${bot} está escribiendo`,
      seeCase: "Verlo en Mi caso",
      caseTitle: "Mi caso",
      caseLater: "Ejemplo · unos días después",
      next: "Lo que sigue",
      happened: "Lo que ya pasó",
      restart: "Probar otra respuesta",
      note: `Punto de muestra y fechas inventadas. ${bot} es IA: te explica, y tú decides. Los resultados varían.`,
      replay: "Ver de nuevo",
      intoCase: "Tu respuesta entra en tu caso",
      mail: {
        caption: `${BRAND.cameo} lleva tus cartas`,
        mailed: "Enviada",
        transit: "En camino",
        delivered: "Entregada ✓",
        label: "Tus cartas en camino: enviadas, en camino, entregadas",
      },
      sample: {
        company: "Cobranzas de Muestra",
        original: "Acreedor original: Telefonía de Muestra",
        balanceLabel: "Saldo",
        balance: "$412",
        openedLabel: "Reportada desde",
        opened: "marzo de 2023",
        bureausLabel: "Aparece en",
        bureaus: "Experian, TransUnion",
      },
    },
    why: {
      title: "Por qué importa",
      lead: "Tu reporte de crédito te sigue a más lugares que un préstamo. Y los errores pasan más de lo que la gente cree.",
      stats: [
        { figure: "1 de 5", text: "personas en un estudio para el Congreso tenía un error en al menos uno de sus tres reportes de crédito.", source: FTC_2013 },
        { figure: "1 de 20", text: "tenía errores que podían hacerle pagar más por cosas como préstamos de auto y seguros.", source: FTC_2013 },
        { figure: "Empleo", text: "Un empleador puede revisar tu reporte de crédito cuando solicitas un trabajo, con tu permiso por escrito.", source: FTC_EMPLOYERS },
        { figure: "Renta", text: "La ley nombra el crédito, el empleo, los seguros y la renta de vivienda entre las decisiones que un reporte puede afectar.", source: CROA_1679C },
      ],
      close: "Puedes ver tus tres reportes sin costo cada semana en AnnualCreditReport.com.",
    },
    how: {
      title: "Cómo funciona",
      lead: "Cuatro pasos. Tú tomas las decisiones; el equipo hace el papeleo y el envío.",
      steps: [
        { title: "Habla con nosotros", body: "Escribe a una persona por WhatsApp, o empieza en línea. Te explicamos el plan y lo máximo que pagarás antes de que firmes nada." },
        { title: "Trae tu reporte", body: `Conectas ${monitoringName("es")} y subes tu identificación y un comprobante de domicilio. Tu equipo trae tu reporte de los tres burós.` },
        { title: "Di qué está mal", body: `${bot} te explica cada punto en palabras simples. Tú marcas solo lo que crees inexacto, y dices por qué.` },
        { title: "Enviamos, tú sigues", body: "Tu equipo prepara y envía las cartas. Mi caso te muestra cada carta y sus fechas. Más o menos cada 40 días, revisamos de nuevo." },
      ],
      cta: "El recorrido completo",
    },
    included: {
      title: "Lo que recibes. Todos reciben todo.",
      lead: "No hay plan básico y plan premium. Cada cliente recibe el mismo servicio.",
      items: [
        { title: "Los tres burós", body: "Equifax, Experian y TransUnion, en cada ronda." },
        { title: "Todo tipo de punto", body: "Cuentas, cobranzas, consultas e información personal, explicados uno por uno." },
        { title: "Cartas a donde corresponde", body: "A los burós y, cuando aplica, al acreedor o a la agencia de cobranza." },
        { title: "Correo certificado donde importa", body: "Las cartas a acreedores y agencias de cobro, y los seguimientos, van certificadas y con rastreo." },
        { title: "Mi caso", body: "Cada carta, a quién fue, cuándo se envió y cuándo llegó." },
        { title: `${bot}, en dos idiomas`, body: "Nuestro asistente con IA te explica tu reporte en inglés o en español, a cualquier hora. También puedes escucharlo en vez de leer." },
        { title: "Un equipo real en WhatsApp", body: "Personas que responden tus dudas y mantienen tu caso en marcha." },
        { title: "A tiempo", body: "Los seguimientos y las rondas nuevas salen en sus fechas. Te avisamos cuando salen las cartas." },
      ],
    },
    compare: {
      title: "Cómo nos comparamos",
      lead: "Datos de nuestro servicio, junto a lo que es común en esta industria. Hazle estas mismas preguntas a cualquier empresa.",
      topic: "Qué revisar",
      us: brand,
      them: "Muchas empresas",
      rows: [
        {
          topic: "Cuándo te cobran",
          us: "Solo después del trabajo: cada cobro paga cartas ya enviadas. Sin cuota de inscripción.",
          them: "Una cuota de primer trabajo y una cuota mensual.",
          facts: ["charge-after-work", "no-setup-fee", "first-work-fee-after-round"],
        },
        {
          topic: "El total",
          us: "Lo máximo que pagarás queda escrito en tu acuerdo antes de firmar. Nunca más de un cobro cada 30 días.",
          them: "Una cuota mensual que sigue hasta que cancelas.",
          facts: ["most-youll-pay", "every-30-days"],
        },
        {
          topic: "Qué incluye",
          us: "Un solo servicio para todos: los tres burós, consultas, y cartas a acreedores y agencias de cobranza.",
          them: "Algunas funciones, como disputar consultas o los reportes de los tres burós, solo en los planes más caros.",
          facts: ["no-feature-tiers", "three-bureaus", "inquiry-letters", "creditor-collector-letters"],
        },
        {
          topic: "Ver el trabajo",
          us: "Cada carta, a quién fue, y cuándo se envió y se entregó, en Mi caso.",
          them: "Avisos de avance y un resumen del trabajo.",
          facts: ["case-timeline", "certified-mail"],
        },
        {
          topic: "Español",
          us: "El mismo sitio y la misma app en inglés o en español, a un toque.",
          them: "A veces, un sitio aparte en español.",
          facts: ["bilingual-one-site", "assistant-explains"],
        },
        {
          topic: "Promesas",
          us: "Ninguna promesa sobre tu reporte ni tu puntaje. Los burós deciden, y los resultados varían.",
          them: "Anuncios con ejemplos de cambios de puntaje.",
          facts: ["no-outcome-claims", "client-decides"],
        },
      ],
      note: "«Muchas empresas» describe planes y anuncios que hemos visto en esta industria, no a una empresa en particular.",
    },
    pricing: {
      title: "No se cobra nada hasta que el trabajo está hecho",
      lead: "Te explicamos el plan antes de que firmes. Después, cada cobro llega después del trabajo que paga.",
      points: [
        "Sin cuota de inscripción, y nada cuando las cartas solo están preparadas",
        "Lo máximo que pagarás, por escrito antes de firmar",
        "3 días hábiles para cancelar sin costo; después, terminas el servicio cuando quieras",
      ],
      cta: "Cómo funcionan los precios",
    },
    partners: {
      title: "Agentes de bienes raíces, oficiales de préstamos, preparadores de impuestos y más",
      lead: "Refiere a un cliente y, si decide compartirlo, sigue su avance: los pasos y las fechas, nunca su información de crédito.",
      cta: "El programa de socios",
    },
    trust: {
      title: "Somos nuevos. Así nos ganamos tu confianza.",
      lead: "Todavía no tenemos años de reseñas. Por eso, en lugar de pedirte que confíes, te mostramos todo.",
      points: [
        { title: "Ves cada carta", body: "A quién fue, la fecha en que se envió y la fecha en que llegó." },
        { title: "Sabes lo máximo que pagarás", body: "Queda escrito en tu acuerdo antes de firmar, y en tu pantalla de pagos." },
        { title: "Pagas después del trabajo", body: "Cada cobro paga cartas ya enviadas. Nada antes." },
        { title: "Sin promesas", body: "Nadie puede prometer lo que decidirá un buró. Ten cuidado con quien lo haga." },
      ],
    },
    reviews: { title: "Lo que dicen los clientes", via: (source) => `en ${source}` },
    press: { title: "En las noticias" },
    faq: { title: "Lo primero que nos preguntan", cta: "Todas las preguntas" },
    final: {
      title: "Empieza con una conversación",
      lead: "Cuéntanos qué ves en tu reporte. Una persona te explica cómo trabajamos y el plan, antes de que firmes nada.",
    },
    rights: {
      title: "Tus derechos, primero",
      points: [
        "Puedes disputar errores con los burós de crédito por tu cuenta, sin costo.",
        "Nadie puede hacer que se quite de tu reporte información exacta y actual. Nosotros tampoco.",
        "Tienes 3 días hábiles después de firmar para cancelar sin costo.",
      ],
      cta: "Lee tus derechos",
    },
  },
  pricing: {
    eyebrow: "Precios",
    title: "No se cobra nada hasta que el trabajo está hecho",
    lead: "La ley federal dice que una empresa de reparación de crédito no puede cobrar antes de hacer el trabajo. Nuestro sistema de cobros está hecho para que no pueda.",
    plansTitle: "Planes",
    noPlans: "Los planes y los precios se explican antes de que firmes.",
    noPlansSub: "Una persona del equipo repasa el plan contigo. Queda escrito en tu acuerdo, con lo máximo que pagarás. No se cobra nada hasta que el trabajo está hecho.",
    planMost: "Lo máximo que pagarás",
    rulesTitle: "Cómo funciona cada cobro",
    rules: [
      { title: "Después del trabajo, siempre", body: "Un cobro paga una ronda de cartas ya enviada. Nunca al firmar, y nunca por cartas que solo están preparadas." },
      { title: "Sin cuota de inscripción", body: "No hay cuota de apertura, inscripción ni activación. Si un plan tiene cuota de primer trabajo, espera a que salga tu primera ronda." },
      { title: "Lo máximo que pagarás", body: "Cada plan tiene un total que nunca se pasa. Lo ves antes de firmar, en tu acuerdo y en Mis pagos." },
      { title: "Como mucho, una vez cada 30 días", body: "Entre un cobro y otro pasan al menos 30 días. Un periodo de 30 días sin trabajo no tiene cobro." },
      { title: "Hogares", body: "Un plan puede incluir un descuento cuando dos personas del mismo hogar se inscriben." },
    ],
    includedTitle: "Incluido para todos",
    includedLead: "Sea cual sea el plan, el servicio es el mismo.",
    monitoringTitle: "El monitoreo de crédito va aparte",
    monitoring: `El servicio necesita ${monitoringName("es")}. La contratas con el servicio de monitoreo y le pagas directo a él, no a nosotros. Puedes cancelarla con ellos.`,
    disclosure: AFFILIATE_DISCLOSURE.es,
    cancelTitle: "Si cambias de opinión",
    cancel: [
      "Tienes 3 días hábiles después de firmar para cancelar sin costo.",
      "Después, puedes terminar el servicio cuando quieras, desde la app o por escrito. Terminar no cuesta nada.",
      "Pagas solo por el trabajo ya hecho por completo antes de que recibamos tu solicitud.",
    ],
  },
  how: {
    eyebrow: "Cómo funciona",
    title: "Cada paso, de tu primer mensaje a cada carta",
    lead: "Este es todo el recorrido, con pantallas de la app real. Tú decides qué está mal. Nosotros hacemos el papeleo y te mantenemos al tanto.",
    stages: [
      {
        title: "1. Habla con una persona",
        body: "Escríbenos por WhatsApp o empieza en línea. Una persona te explica cómo trabajamos, el plan y lo máximo que pagarás. Si decides empezar, firmas tu acuerdo en la app.",
        alt: `La bienvenida de ${brand} cuando el equipo te manda tu enlace`,
        caption: "Tu bienvenida, con tu equipo",
      },
      {
        title: "2. Llega tu reporte",
        body: `Conectas ${monitoringName("es")} y subes tu identificación y un comprobante de domicilio. Tu equipo trae tu reporte de los tres burós.`,
        alt: "Mi caso, con los pasos de un caso y sus fechas",
        caption: "Mi caso: qué está pasando y qué sigue",
      },
      {
        title: `3. Revísalo con ${bot}`,
        body: `${bot}, nuestro asistente con IA, te explica cada punto en palabras simples. Tú marcas solo lo que crees inexacto, desactualizado o no verificable, y dices por qué.`,
        alt: `${bot} explicando un punto del reporte`,
        caption: `${bot} explica; tú decides`,
      },
      {
        title: "4. Preparamos y enviamos las cartas",
        body: "Con tus respuestas, el equipo prepara las cartas a los burós y, cuando aplica, al acreedor o a la agencia de cobranza. Luego las enviamos.",
        alt: "Las cartas de una ronda y el estado de cada una",
        caption: "Cada carta, con su estado",
      },
      {
        title: "5. Construye tu crédito, también",
        body: "Tu app tiene un plan para construir crédito, ordenado según tu propio reporte, un camino para comprar casa y una guía para ITIN. Información general, junto al servicio.",
        alt: "El plan para construir crédito en la app, con sus hábitos",
        caption: "Tu plan, a tu ritmo",
      },
    ],
    roundsTitle: "Después, ronda por ronda",
    rounds: [
      `Los burós suelen tener unos ${CASE_RESPONSE_DAYS} días para responder una disputa. La ley les da ese tiempo.`,
      `Más o menos cada ${CASE_NEXT_ROUND_DAYS} días, tu equipo vuelve a mirar tu reporte y te muestra qué cambió y qué no.`,
      "Si quieres, la siguiente ronda da seguimiento a los mismos puntos, y a lo nuevo que marques.",
      "Cuántas rondas necesita un caso varía. Nadie puede prometer un plazo ni un resultado.",
    ],
    youTitle: "Lo que haces tú",
    you: ["Dices qué está mal, punto por punto, y por qué", "Subes tu identificación y tu comprobante de domicilio", "Mantienes activo tu monitoreo", "Lees los avisos, y preguntas lo que quieras"],
    weTitle: "Lo que hace tu equipo",
    we: ["Trae tu reporte en cada ronda", "Prepara y envía tus cartas", "Sigue la entrega y anota cada fecha", "Lee las respuestas y te cuenta qué dicen"],
    screensNote: "Pantallas de la demo de la app, con datos de muestra.",
  },
  faq: {
    eyebrow: "Preguntas",
    title: "Respuestas honestas",
    lead: "Sobre costos, tiempos, tus derechos y lo que no podemos hacer. Si tu pregunta no está, escríbenos por WhatsApp.",
    items: [
      {
        q: `¿Qué hace ${brand}?`,
        a: "Tú nos dices qué es inexacto en tu reporte de crédito. Nuestro equipo prepara y envía las cartas de disputa por ti, y te muestra cada una en Mi caso. Tu app también tiene un plan para construir crédito y un camino si te preparas para comprar casa.",
      },
      {
        q: "¿Quién decide qué se disputa?",
        a: "Tú. Revisas tu reporte y marcas lo que crees que está mal, y por qué. Nada entra en una carta si tú no lo confirmaste.",
      },
      {
        q: "¿Me pueden prometer que mi reporte o mi puntaje va a cambiar?",
        a: "No. Los burós de crédito deciden, y los resultados varían según cada caso. Quien te promete un resultado no puede saberlo.",
      },
      {
        q: "¿Puedo disputar errores por mi cuenta?",
        a: "Sí. Puedes escribirle tú a un buró de crédito, y no te puede cobrar por investigarlo. Nosotros hacemos el trabajo por ti si prefieres no hacerlo.",
      },
      {
        q: "¿Qué no pueden hacer?",
        a: "No podemos hacer que se quite información exacta y actual de tu reporte, y no disputamos lo que sabes que es correcto. No prestamos dinero ni damos asesoría legal.",
      },
      {
        q: "¿Cuánto cuesta?",
        a: "Nuestro equipo te explica el plan antes de que firmes, y queda escrito en tu acuerdo con lo máximo que pagarás. Cada cobro paga trabajo ya hecho.",
      },
      {
        q: "¿Cuándo me cobran?",
        a: "Solo después del trabajo: por ejemplo, después de enviar una ronda de cartas. Nunca al firmar, y nunca más de una vez cada 30 días.",
      },
      {
        q: "¿Hay cuota de inscripción o de apertura?",
        a: "No. Si un plan tiene cuota de primer trabajo, se cobra solo después de enviar tu primera ronda de cartas.",
      },
      {
        q: "¿Por qué necesito monitoreo de crédito?",
        a: `Es como tu equipo ve tu reporte de los tres burós. Es una suscripción aparte que le pagas al servicio de monitoreo. ${AFFILIATE_DISCLOSURE.es}`,
      },
      {
        q: "¿Puedo cancelar?",
        a: "Sí. Tienes 3 días hábiles después de firmar para cancelar sin costo. Después puedes terminar el servicio cuando quieras; pagas solo el trabajo ya hecho.",
      },
      {
        q: "¿Cuánto tarda?",
        a: `Las cartas salen por rondas, más o menos cada ${CASE_NEXT_ROUND_DAYS} días. Los burós tienen unos ${CASE_RESPONSE_DAYS} días para responder. Cuántas rondas necesita un caso varía.`,
      },
      {
        q: "¿Cómo sabré qué está pasando?",
        a: "Mi caso te muestra cada paso con su fecha: cada carta, a quién fue, cuándo se envió y cuándo llegó. También te escribimos por WhatsApp.",
      },
      {
        q: `¿Quién es ${bot}?`,
        a: `${bot} es nuestro asistente con IA. Te explica tu reporte en palabras simples. No es una persona ni un abogado, y nunca decide por ti.`,
      },
      {
        q: "¿Puedo hablar con una persona de verdad?",
        a: "Sí. Una persona del equipo te responde por WhatsApp, desde tu primera pregunta.",
      },
      {
        q: "¿Trabajan en español?",
        a: "Sí. El sitio, la app, las explicaciones y el equipo funcionan en inglés o en español. Cambias con un toque.",
      },
      {
        q: "Uso ITIN en lugar de Seguro Social. ¿Puedo inscribirme?",
        a: "Sí, puedes tener un expediente de crédito con tu ITIN. El servicio de monitoreo verifica tu identidad, así que escríbenos antes de empezar. Tu app tiene una guía para ITIN: reportes por correo, construir crédito y préstamos para casa.",
      },
      {
        q: "¿Esto tiene que ver con mi estatus migratorio?",
        a: `No. Revisar y disputar tu propio reporte de crédito es un derecho de todo consumidor bajo la ley federal (FCRA). ${brand} no te pide información migratoria.`,
      },
      {
        q: "¿Dónde están disponibles?",
        a: "Hoy, en Texas. Abrimos estado por estado, porque cada uno tiene sus propias reglas. En otros estados, puedes unirte a la lista de espera.",
      },
      {
        q: "¿Cómo protegen mi información?",
        a: "Tu caso está protegido en nuestra base de datos para que solo tú y tu equipo puedan leerlo. Los números de tarjeta y de banco van al procesador de pagos, nunca a nosotros.",
      },
      {
        q: "¿Mi oficial de préstamos o mi agente puede seguir mi avance?",
        a: "Solo si tú decides compartirlo, y puedes dejar de hacerlo cuando quieras. Ven pasos y fechas, nunca tu información de crédito.",
      },
    ],
    still: "¿Te queda alguna duda? Nuestro equipo te responde por WhatsApp.",
  },
  partners: {
    eyebrow: "Para socios",
    title: "Ayuda a tus clientes a prepararse, sin el papeleo",
    lead: `Conoces a personas que necesitan ayuda con su reporte de crédito antes de una hipoteca, un auto, su reembolso de impuestos o un nuevo comienzo. Refiérelas a ${brand}; nuestro equipo hace el resto, y ves quién del equipo las atiende.`,
    who: [
      { title: "Agentes de bienes raíces", body: "Los compradores que encontraron algo mal en su reporte tienen un equipo que se encarga de las cartas." },
      { title: "Oficiales de préstamos", body: "Si tu cliente acepta, sigues las fechas de cada ronda y sabes cuándo volver a revisar." },
      { title: "Preparadores de impuestos", body: "Recomienda ayuda en inglés o en español, en un momento en que tus clientes piensan en su dinero." },
      { title: "Concesionarios de autos", body: "Un comprador que cree que su reporte tiene un error tiene un equipo que primero le explica el proceso." },
      { title: "Abogados", body: "Los clientes con dudas sobre su reporte de crédito tienen un equipo que trabaja solo en lo que ellos digan que está mal." },
      { title: "Quien ayude con el dinero", body: "Consejeros, asesores, grupos de la comunidad: refiere a las personas que te preguntan por su reporte." },
    ],
    sharingTitle: "Avance compartido, con el permiso de tu cliente",
    sharing: [
      "Tu cliente elige qué ves: solo el avance, o el avance y un resumen. Puede dejar de compartir cuando quiera.",
      "Ves pasos y fechas: firmó, cartas enviadas, siguiente ronda. Nunca su reporte de crédito ni sus respuestas.",
      "Describimos el proceso, nunca un resultado. Te pedimos lo mismo con tus clientes.",
    ],
    feesOff: "Por ahora, el programa de socios no paga comisiones por referir.",
    feesOn: "Las comisiones por referir se pagan con términos por escrito y deben informarse a tus clientes.",
    cta: "Solicítalo aquí abajo",
  },
  about: {
    eyebrow: "Nosotros",
    title: "Una empresa de servicios de crédito que muestra su trabajo",
    lead: `${brand} ayuda a las personas a disputar lo que creen que está mal en sus reportes de crédito. Tú decides; nuestro equipo prepara y envía las cartas; tú ves cada paso.`,
    storyTitle: "Nuestra historia",
    storyPending: "Muy pronto, unas palabras de nuestro fundador.",
    charactersTitle: `Conoce a ${bot}, nuestro asistente con IA`,
    alti: `${bot} es nuestro asistente con IA. Te explica tu reporte en palabras simples, en inglés o en español. ${bot} es inteligencia artificial, no una persona ni un abogado. Cada mensaje suyo lo dice.`,
    altibot: `También verás a ${BRAND.cameo}, un pequeño robot que lleva los sobres en nuestras animaciones. ${BRAND.cameo} no conversa. Cuando una persona del equipo te escribe, ves su propio nombre.`,
    rulesTitle: "Las reglas con las que trabajamos",
    rules: [
      { title: "Sin promesas", body: "Decimos lo que hacemos, nunca lo que decidirá un buró. Los resultados varían." },
      { title: "Tú decides", body: "Solo lo que tú nos dices que es inexacto entra en una carta. Nadie marca nada por ti." },
      { title: "Pagas después del trabajo", body: "Cada cobro paga trabajo ya hecho, hasta lo máximo que pagarás." },
      { title: "Mostrarlo todo", body: "Cada carta y cada fecha, en tu app." },
      { title: "Tu idioma", body: "Inglés o español, en el mismo sitio y la misma app." },
    ],
    whereTitle: "Dónde trabajamos",
    where: "Hoy estamos disponibles en Texas. Cada estado tiene sus propias reglas para los servicios de crédito, así que abrimos un estado a la vez.",
  },
  live: LIVE_COPY.es,
  rights: {
    eyebrow: "Tus derechos",
    title: "Tus derechos, antes que nada",
    lead: "La ley federal te da estos derechos. Te los mostramos antes de que firmes, y aquí, para que cualquiera los lea.",
    selfTitle: "En palabras simples",
    self: [
      "Puedes disputar información inexacta por tu cuenta, directo con el buró de crédito, sin costo.",
      "Nadie tiene derecho a que se quite de tu reporte información exacta, actual y verificable.",
      "Puedes obtener copias de tus reportes en AnnualCreditReport.com.",
      "Puedes cancelar un contrato con una empresa de reparación de crédito dentro de los 3 días hábiles después de firmarlo, por cualquier motivo.",
      "Puedes demandar a una empresa de reparación de crédito que viole la Ley de Organizaciones de Reparación de Crédito.",
    ],
    statementTitle: "La declaración que pide la ley",
    officialNote: "Esta es la declaración tal como la muestra nuestro acuerdo en borrador. Está pendiente de revisión del abogado y de compararse palabra por palabra con el texto oficial.",
    moreTitle: "Más información del gobierno",
    links: [
      { label: "Cómo disputar errores en tus reportes (FTC, en inglés)", url: "https://consumer.ftc.gov/articles/disputing-errors-your-credit-reports" },
      { label: "Tus tres reportes de crédito (AnnualCreditReport.com)", url: "https://www.annualcreditreport.com" },
      { label: "Reportes y puntajes de crédito (CFPB, en inglés)", url: "https://www.consumerfinance.gov/consumer-tools/credit-reports-and-scores/" },
    ],
  },
  privacy: {
    eyebrow: "Privacidad",
    title: "Privacidad y aviso GLBA",
    lead: "Esto es un borrador. El aviso completo se publicará después de la revisión del abogado. Esto es lo que ya podemos decirte con claridad.",
    sections: [
      { title: "Qué recopilamos", body: "Tus datos de contacto y tus respuestas en la app. Tu identificación y tu comprobante de domicilio. Tu reporte de crédito, por tu servicio de monitoreo. Tus mensajes con nosotros." },
      { title: "Para qué", body: "Para preparar y enviar tus cartas, mantenerte al tanto, cobrar el trabajo hecho y cumplir las reglas de la ley sobre registros." },
      { title: "Quién lo ve", body: "Tú y las personas de tu equipo que trabajan en tu caso. Un socio ve tu avance solo si tú decides compartirlo." },
      { title: "Pagos", body: "Los números de tarjeta y de banco se escriben en los campos del procesador de pagos. Recibimos un código, nunca los números." },
      { title: "Cookies", body: "Una para recordar tu idioma. Una por 60 días si llegaste por el enlace de un socio. Y las que mantienen tu sesión abierta." },
      { title: "Tus opciones", body: "Puedes pedirnos una copia de lo que tenemos, o dejar de recibir mensajes, escribiéndonos." },
    ],
    pending: "Borrador · pendiente de revisión del abogado. Aquí se publicará el aviso de privacidad de la ley Gramm-Leach-Bliley (GLBA).",
  },
  terms: {
    eyebrow: "Términos",
    title: "Términos del sitio",
    lead: "Esto es un borrador. Los términos finales se publicarán después de la revisión del abogado. Tu acuerdo de servicio es otro documento, que lees y firmas en la app.",
    sections: [
      { title: "Qué es este sitio", body: `Información sobre los servicios de crédito de ${brand}. No es asesoría legal ni una oferta de crédito.` },
      { title: "El ejemplo", body: `El ejemplo de ${bot} en nuestra página principal usa un punto de muestra y fechas inventadas. Muestra cómo funciona la app, no lo que pasará en tu caso.` },
      { title: "Tu acuerdo", body: "El servicio empieza solo con un acuerdo firmado. Incluye tus derechos, el plan, lo máximo que pagarás y cómo cancelar." },
      { title: "Disponibilidad", body: "El servicio está disponible en Texas. En otros estados, puedes unirte a la lista de espera." },
    ],
    pending: "Borrador · pendiente de revisión del abogado.",
  },
};

export const SITE_COPY: Record<Locale, SiteCopy> = { en, es };

/**
 * Every string the site can show in a locale, for the copy checks. Functions
 * are called with sample values. `withSample: false` leaves out the demo's
 * invented item (its "$412" is sample data, not a price).
 */
export function siteStrings(locale: Locale, { withSample = true }: { withSample?: boolean } = {}): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") out.push(value);
    else if (typeof value === "function") walk((value as (a: unknown) => unknown)(locale === "es" ? 2026 : 2026));
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (k === "url" || k === "facts") continue;
        if (k === "sample" && !withSample) continue;
        walk(v);
      }
    }
  };
  const copy = SITE_COPY[locale];
  walk({ ...copy, home: { ...copy.home, reviews: { title: copy.home.reviews.title, via: copy.home.reviews.via("Google") } } });
  return out;
}
