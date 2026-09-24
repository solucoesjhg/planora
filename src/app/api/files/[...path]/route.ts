import { NextResponse } from "next/server";
import { authSecret } from "@/server/auth/secret";
import { MAX_ATTACHMENT_BYTES } from "@/domain/attachments";
import {
  localObjectExists,
  readLocalObject,
  verifyLocalLink,
  writeLocalObject,
} from "@/server/storage/local";
import { getStorage } from "@/server/storage";

/**
 * The bytes, in development (DEVELOPMENT_PLAN.md §5.1).
 *
 * In production the browser talks to Supabase Storage directly and this route
 * is never reached. Locally it stands in for it: the same two operations, gated
 * by the same kind of signature — issued by `storage/local.ts`, checked here.
 *
 * There is deliberately no session check. A signature is the credential, the
 * way it is with the real bucket; the workspace check happened before the URL
 * existed, in `linkFor`.
 */

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const guard = await authorize(request, context, "read");
  if (guard.refusal) return guard.refusal;

  const object = await readLocalObject(guard.path);
  if (!object) return NextResponse.json({ error: "not-found" }, { status: 404 });

  return new Response(new Uint8Array(object.bytes), {
    headers: {
      "content-type": object.mime,
      "content-length": String(object.bytes.byteLength),
      // Private and short: the URL it came from expires anyway.
      "cache-control": "private, max-age=60",
      "content-disposition": `inline; filename="${fileNameOf(guard.path)}"`,
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * An upload, the way the bucket takes one (ADR 0006): stored under the type the
 * ticket was signed for — not the `Content-Type` that arrives with the bytes —
 * and never over an object already there, so a ticket cannot be replayed to
 * replace a file after it was confirmed.
 */
export async function PUT(request: Request, context: Context): Promise<Response> {
  const guard = await authorize(request, context, "upload");
  if (guard.refusal) return guard.refusal;

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: "too-large" }, { status: 413 });
  }
  if (await localObjectExists(guard.path)) {
    return NextResponse.json({ error: "exists" }, { status: 409 });
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: "too-large" }, { status: 413 });
  }

  await writeLocalObject(guard.path, bytes, guard.type ?? "application/octet-stream");

  return NextResponse.json({ ok: true });
}

async function authorize(
  request: Request,
  context: Context,
  intent: "read" | "upload",
): Promise<{ path: string; type: string | undefined; refusal: Response | null }> {
  const notFound = NextResponse.json({ error: "not-found" }, { status: 404 });
  const { path: segments } = await context.params;
  let path: string;
  try {
    path = segments.map(decodeURIComponent).join("/");
  } catch {
    // A stray `%` is a URL nobody here issued, not a server error.
    return { path: "", type: undefined, refusal: notFound };
  }

  if (getStorage().name !== "local") {
    // Production signs its URLs at the bucket; this route would be a second,
    // weaker door onto the same objects.
    return { path, type: undefined, refusal: notFound };
  }

  const url = new URL(request.url);
  const expires = Number(url.searchParams.get("exp"));
  const signature = url.searchParams.get("sig") ?? "";
  // An upload's type is part of what was signed; a read carries none.
  const type = intent === "upload" ? (url.searchParams.get("type") ?? "") : undefined;
  const valid = await verifyLocalLink(intent, path, expires, signature, authSecret(), type);
  if (!valid) {
    return { path, type, refusal: NextResponse.json({ error: "expired" }, { status: 403 }) };
  }

  return { path, type, refusal: null };
}

function fileNameOf(path: string): string {
  return (path.split("/").at(-1) ?? "arquivo").replaceAll('"', "");
}
