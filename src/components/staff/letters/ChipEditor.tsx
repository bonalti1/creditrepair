"use client";

import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from "react";
import { chipText, isChipKey, TOKEN, type ChipKey } from "@/lib/letters/versions/source";
import { useStaffLocale } from "@/lib/staff/i18n/StaffLocale";
import type { StaffLocale } from "@/lib/staff/i18n/locale";

// The letter text, editable, with each chip ({partidas}, {detalles}, …) shown
// as one solid piece: it cannot be typed into or split, only removed whole or
// inserted from the buttons. The text is plain: a line break is a line, a
// blank line starts a paragraph.
//
// The element is uncontrolled while the owner types (React does not rewrite
// it on every key, so the caret stays put). The text is written into it when
// `resetKey` changes: another letter or version opened, or a draft thrown away.
// A chip's label is in the member's language; the text around it is the
// letter's own English.

export interface ChipEditorHandle {
  /** Puts a chip where the caret is (or at the end) and reports the new text. */
  insertChip(key: ChipKey): void;
  focus(): void;
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const CHIP_CLASS =
  "mx-0.5 inline-flex select-none items-center gap-1 whitespace-nowrap rounded-md border px-1.5 align-baseline font-sans text-[12.5px] font-semibold leading-[1.45]";
const KNOWN = `${CHIP_CLASS} border-blue-200 bg-blue-50 text-blue-800`;
const UNKNOWN = `${CHIP_CLASS} border-red-300 bg-red-50 text-red-700`;

function chipHtml(key: string, locale: StaffLocale): string {
  const known = isChipKey(key);
  const label = known ? chipText(key, locale).label : `{${key}}`;
  const help = known ? chipText(key, locale).help : locale === "es" ? "Esta ficha no existe" : "This chip doesn't exist";
  return `<span data-chip="${escape(key)}" contenteditable="false" class="${known ? KNOWN : UNKNOWN}" title="${escape(help)}"><span aria-hidden="true">${known ? "⦿" : "!"}</span>${escape(label)}</span>`;
}

/** The text as the editor's HTML: escaped text, line breaks, and a span per chip. */
export function textToHtml(text: string, locale: StaffLocale = "en"): string {
  let html = "";
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    html += escape(text.slice(last, match.index)).replace(/\n/g, "<br>");
    html += chipHtml(match[1]!, locale);
    last = match.index! + match[0].length;
  }
  html += escape(text.slice(last)).replace(/\n/g, "<br>");
  // A trailing line break needs a second one to show as a line.
  return text.endsWith("\n") ? `${html}<br>` : html;
}

/** The editor's content back as text. */
export function domToText(root: Node): string {
  let out = "";
  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? "").replace(/ /g, " ");
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.chip !== undefined) {
      out += `{${node.dataset.chip}}`;
      return;
    }
    if (node.tagName === "BR") {
      out += "\n";
      return;
    }
    if (node.tagName === "DIV" || node.tagName === "P") {
      // Some browsers wrap a new line in a block: it starts a line of its own.
      if (out.length > 0 && !out.endsWith("\n")) out += "\n";
      out += domToText(node);
      return;
    }
    out += domToText(node);
  });
  return out;
}

export default function ChipEditor({
  value,
  resetKey,
  onChange,
  readOnly = false,
  label,
  ref,
}: {
  value: string;
  resetKey: string;
  onChange: (text: string) => void;
  readOnly?: boolean;
  label: string;
  ref?: Ref<ChipEditorHandle>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);
  const { locale } = useStaffLocale();

  // Written in when another text is opened (or always, read-only).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (readOnly || shown.current !== resetKey) {
      el.innerHTML = textToHtml(value, locale);
      shown.current = resetKey;
    }
  }, [resetKey, readOnly, value, locale]);

  const emit = () => {
    if (box.current) onChange(domToText(box.current));
  };

  const caretInside = (): Range | null => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !box.current) return null;
    const range = selection.getRangeAt(0);
    return box.current.contains(range.commonAncestorContainer) ? range : null;
  };

  useImperativeHandle(ref, () => ({
    insertChip(key: ChipKey) {
      const el = box.current;
      if (!el || readOnly) return;
      const holder = document.createElement("span");
      holder.innerHTML = chipHtml(key, locale);
      const chip = holder.firstChild as HTMLElement;
      const space = document.createTextNode(" ");
      const range = caretInside();
      if (range) {
        range.deleteContents();
        range.insertNode(space);
        range.insertNode(chip);
        const selection = window.getSelection()!;
        const after = document.createRange();
        after.setStartAfter(space);
        after.collapse(true);
        selection.removeAllRanges();
        selection.addRange(after);
      } else {
        el.appendChild(chip);
        el.appendChild(space);
      }
      emit();
    },
    focus() {
      box.current?.focus();
    },
  }));

  return (
    <div
      ref={box}
      role="textbox"
      aria-multiline="true"
      aria-label={label}
      aria-readonly={readOnly}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      spellCheck={!readOnly}
      data-testid="letter-editor"
      onInput={emit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          // A plain line break: never a new block the text would not keep.
          e.preventDefault();
          document.execCommand("insertLineBreak");
          emit();
        }
      }}
      onPaste={(e) => {
        // Only text comes in: no formatting, no pasted markup.
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, text);
        emit();
      }}
      onDrop={(e) => e.preventDefault()}
      className={`min-h-[22rem] whitespace-pre-wrap break-words rounded-2xl border px-4 py-3 font-serif text-[15px] leading-[1.65] text-slate-900 outline-none sm:px-5 ${
        readOnly ? "border-slate-200 bg-slate-50" : "border-slate-300 bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      }`}
    />
  );
}
