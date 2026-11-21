// How the service is delivered. Full service is the business today: the client
// says what is inaccurate, and the team prepares and mails the letters.
// Self-serve (the client sends their own letters) is kept for later.
export type ServiceMode = "full_service" | "self_serve";

export const SERVICE_MODE: ServiceMode =
  process.env.NEXT_PUBLIC_SERVICE_MODE === "self_serve" ? "self_serve" : "full_service";

export const isFullService = SERVICE_MODE === "full_service";
