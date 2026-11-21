import Icon from "@/components/Icon";

// A message a person on the team wrote, as the client sees it in their chat.
//
// It must never be taken for Capi: Capi's bubbles are grey and unsigned (the
// header says he is AI); this one is white with a navy outline and is signed
// above with the teammate's first name and "del equipo". No AI label appears
// on it. Used by the client's chat and by the staff console's "as the client
// sees it" preview, so both show the same thing.

export default function TeamMessage({ byline, text }: { byline: string; text: string }) {
  return (
    <div data-testid="team-message" className="flex min-w-0 max-w-[80%] flex-col items-start">
      <p data-testid="team-byline" className="mb-1 flex items-center gap-1.5 pl-1 text-xs font-semibold text-blue-700">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-700 text-white">
          <Icon name="person" size={12} strokeWidth={2.25} />
        </span>
        {byline}
      </p>
      <div className="whitespace-pre-line break-words rounded-[22px] rounded-bl-md border-[1.5px] border-blue-300 bg-white px-4 py-2.5 text-[16px] leading-snug text-slate-900">
        {text}
      </div>
    </div>
  );
}
