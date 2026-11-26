// How the service is delivered, chosen PER CLIENT (docs/SERVICE-OPTIONS.md):
//
//   full_service  "Done for you": the client says what is inaccurate; the team
//                 prepares and mails the letters; every charge waits for the
//                 work it pays for.
//   diy           "Do it yourself, guided": the client uses the software with
//                 Alti; Alti prepares the letters from the same approved
//                 templates; the client prints and mails them (or pays per
//                 letter for Credalti to mail them).
//
// The option is stored on the client's record (client_service_options, and the
// signed agreement's terms.serviceOption; migration 0042) and read through
// src/lib/service/options.ts. There is no global switch any more: the old
// NEXT_PUBLIC_SERVICE_MODE is retired. A client with no recorded choice, and
// any code path that has no client (the website, a lead), is full service.
export type ServiceMode = "full_service" | "diy";

/** The option of a client who has not chosen, and of everything that has no client. */
export const DEFAULT_SERVICE_MODE: ServiceMode = "full_service";
