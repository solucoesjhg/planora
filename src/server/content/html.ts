/**
 * What the editor writes, and what may be stored (DEVELOPMENT_PLAN.md §7 Phase 7).
 *
 * The task body and the comments are HTML, produced by Tiptap in a browser we
 * do not control. Anything arriving from a client is a proposal: it is parsed
 * against an allowlist here, on the server, before it reaches a column that
 * some other screen will render.
 *
 * The allowlist is the editor's own vocabulary plus `<section
 * data-phase-note>`, which `domain/phase-history` writes when a task leaves a
 * phase. Nothing else survives: no `style`, no `class`, no `svg`, no event
 * handler, and no `javascript:` in an `href`.
 */

import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "code",
  "pre",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "hr",
  "a",
  "img",
  "section",
];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    // The label a phase leaves behind, written by the domain.
    section: ["data-phase-note"],
    li: ["data-checked"],
    ol: ["start"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  // An image may also come from our own signed route, which is a relative URL.
  allowedSchemesAppliedToAttributes: ["href", "src"],
  allowProtocolRelative: false,
  transformTags: {
    // A link that leaves the app opens without handing the opener over.
    a: (tagName, attributes) => ({
      tagName,
      attribs: { ...attributes, rel: "noopener noreferrer nofollow" },
    }),
  },
};

/** The stored form of anything a person wrote in an editor. */
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}

/**
 * True when the value carries no text and no image — an editor that looks
 * empty still emits `<p></p>`, and that should count as nothing written.
 */
export function isBlankRichText(html: string): boolean {
  const withoutImages = html.replace(/<img\b[^>]*>/gi, "");
  return sanitizeHtml(withoutImages, { allowedTags: [], allowedAttributes: {} })
    .replaceAll("&nbsp;", " ")
    .trim()
    .length === 0;
}
