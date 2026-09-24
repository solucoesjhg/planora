/**
 * What an attachment may be (DEVELOPMENT_PLAN.md §7 Phase 7 · ADR 0006).
 *
 * The browser declares a type and a size when it asks for a ticket, and then
 * sends whatever bytes it likes, with whatever `Content-Type` it likes, straight
 * to the store. So the declaration is a question, and what the store says it
 * holds is the answer: an attachment is kept only when the two agree and the
 * answer is on this list. The bucket enforces the same list and the same size
 * on its own, so that what never should have landed is refused at the door and
 * not merely afterwards.
 */

/** 25 MB — a photograph of a wall, a PDF of a quote, a spreadsheet. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** No SVG, no HTML: those are documents that can carry script, not files. */
export const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

/**
 * A `Content-Type` reduced to the media type it names: `Text/Plain;charset=UTF-8`
 * and `text/plain` are the same answer.
 */
export function mediaType(contentType: string): string {
  return (contentType.split(";")[0] ?? "").trim().toLowerCase();
}

export function isAllowedType(contentType: string): boolean {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mediaType(contentType));
}

/**
 * Whether what landed is what was asked for. A different type is refused even
 * when it is also on the list: the name, the icon and the preview were all
 * decided by the declaration.
 */
export function landedAsDeclared(declared: string, landed: string): boolean {
  return isAllowedType(landed) && mediaType(landed) === mediaType(declared);
}

export type BucketSettings = {
  readonly public: boolean;
  /** Bytes; `null` when the bucket leaves it to the project's global limit. */
  readonly fileSizeLimit: number | null;
  /** `null` or empty when the bucket accepts any type. */
  readonly allowedMimeTypes: readonly string[] | null;
};

export type BucketProblem =
  | "public"
  | "no-size-limit"
  | "size-limit-above-ours"
  | "any-type-accepted"
  | "type-outside-ours";

/**
 * What is wrong with a bucket for holding attachments, or nothing. A bucket may
 * be stricter than this list; it may not be looser.
 */
export function bucketProblems(bucket: BucketSettings): BucketProblem[] {
  const problems: BucketProblem[] = [];
  if (bucket.public) problems.push("public");

  if (bucket.fileSizeLimit === null) problems.push("no-size-limit");
  else if (bucket.fileSizeLimit > MAX_ATTACHMENT_BYTES) problems.push("size-limit-above-ours");

  const types = bucket.allowedMimeTypes ?? [];
  if (types.length === 0) problems.push("any-type-accepted");
  else if (types.some((type) => !isAllowedType(type))) problems.push("type-outside-ours");

  return problems;
}
