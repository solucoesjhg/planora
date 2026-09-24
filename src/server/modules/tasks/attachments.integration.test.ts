import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { fixedId } from "@/lib/id";
import { isRefused } from "@/lib/result";
import { tenantContext } from "@/server/auth/tenant";
import type { Connection, Transaction } from "@/server/db/client";
import { attachments } from "@/server/db/schema";
import { seed, seedIds } from "@/server/db/seed";
import { memoryStorage, type MemoryStorage } from "@/server/storage/storage";
import { connectAndMigrate, hasDatabase } from "@/server/test-support/database";
import {
  ABANDONED_AFTER_MS,
  confirmUpload,
  linkFor,
  MAX_ATTACHMENT_BYTES,
  removeAttachment,
  requestUpload,
  safeName,
  sweepAbandonedUploads,
} from "./attachments";

const suite = describe.skipIf(!hasDatabase);

suite("attachments", () => {
  let connection: Connection;
  let storage: MemoryStorage;

  const owner = () => tenantContext(seedIds.workspace, seedIds.user, "owner");
  const viewer = () => tenantContext(seedIds.workspace, seedIds.user, "viewer");
  const projectId = seedIds.projects[0]!;
  const taskId = seedIds.task(1);

  beforeAll(async () => {
    connection = await connectAndMigrate();
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await seed(connection.db);
    storage = memoryStorage();
  });

  /**
   * One transaction on the suite's own connection, where production hands
   * these four `null`.
   *
   * Given nothing to borrow, each of them opens a scope per statement and
   * reaches the store between them, which is the shape the barrier requires
   * and the reason they are not wrapped (ADR 0002). Given a transaction they
   * run inside it, and that is what this suite hands them: the lane would
   * take them to `getDatabase()`, which is the application's database and not
   * this one (test-support/database-url.ts). What is asserted below is the
   * behaviour — the order of the object and the row, and every refusal — and
   * the scoping does not change it.
   */
  const scoped = <T>(run: (tx: Transaction) => Promise<T>): Promise<T> =>
    connection.db.transaction(run);

  const request = (over: Partial<Parameters<typeof requestUpload>[3]> = {}) =>
    scoped((tx) =>
      requestUpload(tx, owner(), storage, {
        projectId,
        taskId,
        name: "planta baixa.pdf",
        mime: "application/pdf",
        size: 2048,
        ...over,
      }),
    );

  /** The browser's whole round: a ticket, the bytes, the confirmation. */
  async function uploaded(
    bytes = new Uint8Array([1, 2, 3]),
    landed = "application/pdf",
    over: Partial<Parameters<typeof requestUpload>[3]> = {},
  ): Promise<{ attachmentId: string; path: string }> {
    const ticket = await request(over);
    if (isRefused(ticket)) throw new Error(ticket.reason);
    const path = await pathOf(ticket.value.attachmentId);
    await storage.put(path, bytes, landed);
    const confirmed = await scoped((tx) =>
      confirmUpload(tx, owner(), storage, ticket.value.attachmentId),
    );
    if (isRefused(confirmed)) throw new Error(confirmed.reason);
    return { attachmentId: ticket.value.attachmentId, path };
  }

  async function pathOf(attachmentId: string): Promise<string> {
    const [row] = await connection.db
      .select({ path: attachments.path })
      .from(attachments)
      .where(eq(attachments.id, attachmentId));
    return row!.path;
  }

  it("hands out a ticket and writes a row nobody sees yet", async () => {
    const result = await request();
    if (isRefused(result)) throw new Error(result.reason);

    expect(result.value.ticket.url).toContain(result.value.attachmentId);
    expect(result.value.ticket.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const [row] = await connection.db
      .select()
      .from(attachments)
      .where(eq(attachments.id, result.value.attachmentId));

    expect(row?.status).toBe("pending");
    expect(row?.name).toBe("planta-baixa.pdf");
    // The tenant is visible in the path, so a stray object is traceable.
    expect(row?.path.startsWith(`${seedIds.workspace}/${projectId}/`)).toBe(true);
  });

  it("refuses a type that can carry script, and anyone who may not write", async () => {
    const svg = await request({ mime: "image/svg+xml", name: "logo.svg" });
    expect(isRefused(svg) && svg.reason).toBe("unsupported-type");

    const byViewer = await scoped((tx) =>
      requestUpload(tx, viewer(), storage, {
        projectId,
        taskId,
        name: "a.pdf",
        mime: "application/pdf",
        size: 10,
      }),
    );
    expect(isRefused(byViewer) && byViewer.reason).toBe("forbidden");
  });

  it("records what the store holds, not what the browser claimed", async () => {
    const ticket = await request({ size: 10 });
    if (isRefused(ticket)) throw new Error(ticket.reason);

    const [row] = await connection.db
      .select({ path: attachments.path })
      .from(attachments)
      .where(eq(attachments.id, ticket.value.attachmentId));

    // The browser uploads 4 bytes, having said 10.
    await storage.put(row!.path, new Uint8Array([1, 2, 3, 4]), "application/pdf");

    const confirmed = await scoped((tx) =>
      confirmUpload(tx, owner(), storage, ticket.value.attachmentId),
    );
    if (isRefused(confirmed)) throw new Error(confirmed.reason);

    expect(confirmed.value.size).toBe(4);
    expect(confirmed.value.checksum.startsWith("sha256:")).toBe(true);

    const [stored] = await connection.db
      .select()
      .from(attachments)
      .where(eq(attachments.id, ticket.value.attachmentId));
    expect(stored?.status).toBe("stored");
    expect(stored?.size).toBe(4);
    expect(stored?.storedAt).not.toBeNull();
  });

  it("refuses to confirm an upload that never landed", async () => {
    const ticket = await request();
    if (isRefused(ticket)) throw new Error(ticket.reason);

    const confirmed = await scoped((tx) =>
      confirmUpload(tx, owner(), storage, ticket.value.attachmentId),
    );
    expect(isRefused(confirmed) && confirmed.reason).toBe("missing");
  });

  /**
   * What the first production deploy showed: the bucket was not there, the
   * store threw, the Server Action rejected with its message stripped, and
   * "Enviando…" stayed on the screen for good. A store that fails is a refusal
   * the interface can name, and the cause goes where the deployer will look.
   */
  it("a store that cannot issue a ticket is a refusal, and leaves no row", async () => {
    const broken: MemoryStorage = {
      ...storage,
      async upload() {
        throw new Error("storage refused an upload ticket: Bucket not found");
      },
    };
    const rows = () => connection.db.select().from(attachments);
    const before = (await rows()).length;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const result = await scoped((tx) =>
        requestUpload(tx, owner(), broken, {
          projectId,
          taskId,
          name: "planta baixa.pdf",
          mime: "application/pdf",
          size: 2048,
        }),
      );

      expect(isRefused(result) && result.reason).toBe("storage-unavailable");
      expect(isRefused(result) && result.detail).toContain("Bucket not found");
      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining("issue an upload ticket"),
        expect.any(Error),
      );
    } finally {
      logged.mockRestore();
    }

    // Nothing is left waiting for bytes that can never come.
    expect((await rows()).length).toBe(before);
  });

  it("a store that cannot say what landed is a refusal too, not 'missing'", async () => {
    const ticket = await request();
    if (isRefused(ticket)) throw new Error(ticket.reason);

    const silent: MemoryStorage = {
      ...storage,
      async head() {
        throw new Error("fetch failed");
      },
    };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    let confirmed;
    try {
      confirmed = await scoped((tx) =>
        confirmUpload(tx, owner(), silent, ticket.value.attachmentId),
      );
    } finally {
      logged.mockRestore();
    }
    expect(isRefused(confirmed) && confirmed.reason).toBe("storage-unavailable");

    // The row is still pending: the bytes may well be there.
    const [row] = await connection.db
      .select()
      .from(attachments)
      .where(eq(attachments.id, ticket.value.attachmentId));
    expect(row?.status).toBe("pending");
  });

  it("a link the store will not sign is a refusal the route can tell apart", async () => {
    const { attachmentId } = await uploaded();

    const mute: MemoryStorage = {
      ...storage,
      async signedUrl() {
        throw new Error("Invalid JWT");
      },
    };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    let link;
    try {
      link = await scoped((tx) => linkFor(tx, owner(), mute, attachmentId));
    } finally {
      logged.mockRestore();
    }
    expect(isRefused(link) && link.reason).toBe("storage-unavailable");
  });

  it("throws away an object that arrived larger than the limit", async () => {
    const ticket = await request({ size: 1024 });
    if (isRefused(ticket)) throw new Error(ticket.reason);

    const [row] = await connection.db
      .select({ path: attachments.path })
      .from(attachments)
      .where(eq(attachments.id, ticket.value.attachmentId));

    await storage.put(
      row!.path,
      new Uint8Array(MAX_ATTACHMENT_BYTES + 1),
      "application/pdf",
    );

    const confirmed = await scoped((tx) =>
      confirmUpload(tx, owner(), storage, ticket.value.attachmentId),
    );
    expect(isRefused(confirmed) && confirmed.reason).toBe("too-large");

    // Neither the bytes nor the row survive it.
    expect(storage.objects.has(row!.path)).toBe(false);
    expect(
      await connection.db
        .select()
        .from(attachments)
        .where(eq(attachments.id, ticket.value.attachmentId)),
    ).toHaveLength(0);
  });

  it("signs a link only after the workspace check, and the link expires", async () => {
    const { attachmentId } = await uploaded();

    const stranger = tenantContext(seedIds.projects[1]!, seedIds.user, "owner");
    const refusedLink = await scoped((tx) =>
      linkFor(tx, stranger, storage, attachmentId),
    );
    expect(isRefused(refusedLink) && refusedLink.reason).toBe("not-found");

    const link = await scoped((tx) =>
      linkFor(tx, owner(), storage, attachmentId, 60),
    );
    if (isRefused(link)) throw new Error(link.reason);

    expect(link.value.url).toContain("exp=");
    expect(link.value.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(link.value.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it("removes the bytes with the row", async () => {
    const ticket = await request();
    if (isRefused(ticket)) throw new Error(ticket.reason);

    const [row] = await connection.db
      .select({ path: attachments.path })
      .from(attachments)
      .where(eq(attachments.id, ticket.value.attachmentId));
    await storage.put(row!.path, new Uint8Array([9]), "application/pdf");

    const removed = await scoped((tx) =>
      removeAttachment(tx, owner(), storage, ticket.value.attachmentId),
    );
    expect(isRefused(removed)).toBe(false);
    expect(storage.objects.has(row!.path)).toBe(false);
    expect(
      await connection.db
        .select()
        .from(attachments)
        .where(eq(attachments.id, ticket.value.attachmentId)),
    ).toHaveLength(0);
  });

  /*
   * The audit of 2026-09-24 (ADR 0006). The type was checked only as declared:
   * a ticket asked for as a PNG took an SVG, confirmation never compared, and
   * the store served it inline from its own origin. Uploads nobody confirmed
   * were never measured, never removed, and still signed a link.
   */

  it("takes away bytes that are not the type the ticket was asked for", async () => {
    const ticket = await request({ mime: "image/png", name: "planta.png" });
    if (isRefused(ticket)) throw new Error(ticket.reason);
    const path = await pathOf(ticket.value.attachmentId);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await storage.put(path, svg, "image/svg+xml");

    const confirmed = await scoped((tx) =>
      confirmUpload(tx, owner(), storage, ticket.value.attachmentId),
    );

    expect(isRefused(confirmed) && confirmed.reason).toBe("unsupported-type");
    expect(storage.objects.has(path)).toBe(false);
    expect(
      await connection.db.select().from(attachments).where(eq(attachments.id, ticket.value.attachmentId)),
    ).toHaveLength(0);
  });

  it("keeps a type that differs from the declaration only in its parameters", async () => {
    const { attachmentId } = await uploaded(
      new TextEncoder().encode("a,b\n1,2\n"),
      "text/csv; charset=UTF-8",
      { mime: "text/csv", name: "orcamento.csv" },
    );
    const [row] = await connection.db.select().from(attachments).where(eq(attachments.id, attachmentId));
    expect(row?.status).toBe("stored");
  });

  it("signs no link for an upload nobody confirmed", async () => {
    const ticket = await request();
    if (isRefused(ticket)) throw new Error(ticket.reason);
    await storage.put(await pathOf(ticket.value.attachmentId), new Uint8Array([1]), "application/pdf");

    const link = await scoped((tx) => linkFor(tx, owner(), storage, ticket.value.attachmentId));
    expect(isRefused(link) && link.reason).toBe("not-found");
  });

  it("sweeps away an upload nobody confirmed, and leaves a recent one and a kept one", async () => {
    const abandoned = await request({ name: "esquecido.pdf" });
    const recent = await request({ name: "a-caminho.pdf" });
    if (isRefused(abandoned) || isRefused(recent)) throw new Error("expected tickets");
    const kept = await uploaded();
    const abandonedPath = await pathOf(abandoned.value.attachmentId);
    await storage.put(abandonedPath, new Uint8Array(1024), "application/x-msdownload");
    await storage.put(await pathOf(recent.value.attachmentId), new Uint8Array([1]), "application/pdf");

    const now = new Date();
    await connection.db
      .update(attachments)
      .set({ createdAt: new Date(now.getTime() - ABANDONED_AFTER_MS - 60_000) })
      .where(eq(attachments.id, abandoned.value.attachmentId));
    // A kept file is never swept, however old.
    await connection.db
      .update(attachments)
      .set({ createdAt: new Date(now.getTime() - 30 * 86_400_000) })
      .where(eq(attachments.id, kept.attachmentId));

    const result = await sweepAbandonedUploads(connection.db, storage, now);

    expect(result).toStrictEqual({ swept: 1, failed: 0 });
    expect(storage.objects.has(abandonedPath)).toBe(false);
    const left = await connection.db.select({ id: attachments.id }).from(attachments);
    expect(left.map((row) => row.id).sort()).toStrictEqual(
      [recent.value.attachmentId, kept.attachmentId].sort(),
    );
  });

  it("lets only whoever sent a file, or a manager, take it away", async () => {
    const { attachmentId, path } = await uploaded();
    const colleague = tenantContext(seedIds.workspace, fixedId("user", 7), "member");
    const manager = tenantContext(seedIds.workspace, fixedId("user", 8), "manager");

    const byColleague = await scoped((tx) => removeAttachment(tx, colleague, storage, attachmentId));
    expect(isRefused(byColleague) && byColleague.reason).toBe("forbidden");
    expect(storage.objects.has(path)).toBe(true);

    const byManager = await scoped((tx) => removeAttachment(tx, manager, storage, attachmentId));
    expect(isRefused(byManager)).toBe(false);
    expect(storage.objects.has(path)).toBe(false);
  });
});

describe("safeName", () => {
  it("keeps a readable name without letting it travel", () => {
    expect(safeName("Planta Baixa v2.pdf")).toBe("Planta-Baixa-v2.pdf");
    expect(safeName("../../etc/passwd")).not.toContain("/");
    expect(safeName("../../etc/passwd").startsWith(".")).toBe(false);
    expect(safeName("")).toBe("arquivo");
  });
});
