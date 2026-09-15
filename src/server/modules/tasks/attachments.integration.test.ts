import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { isRefused } from "@/lib/result";
import { tenantContext } from "@/server/auth/tenant";
import type { Connection } from "@/server/db/client";
import { attachments } from "@/server/db/schema";
import { seed, seedIds } from "@/server/db/seed";
import { memoryStorage, type MemoryStorage } from "@/server/storage/storage";
import { connectAndMigrate, hasDatabase } from "@/server/test-support/database";
import {
  confirmUpload,
  linkFor,
  MAX_ATTACHMENT_BYTES,
  removeAttachment,
  requestUpload,
  safeName,
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

  const request = (over: Partial<Parameters<typeof requestUpload>[3]> = {}) =>
    requestUpload(connection.db, owner(), storage, {
      projectId,
      taskId,
      name: "planta baixa.pdf",
      mime: "application/pdf",
      size: 2048,
      ...over,
    });

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

    const byViewer = await requestUpload(connection.db, viewer(), storage, {
      projectId,
      taskId,
      name: "a.pdf",
      mime: "application/pdf",
      size: 10,
    });
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

    const confirmed = await confirmUpload(
      connection.db,
      owner(),
      storage,
      ticket.value.attachmentId,
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

    const confirmed = await confirmUpload(
      connection.db,
      owner(),
      storage,
      ticket.value.attachmentId,
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
      const result = await requestUpload(connection.db, owner(), broken, {
        projectId,
        taskId,
        name: "planta baixa.pdf",
        mime: "application/pdf",
        size: 2048,
      });

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
      confirmed = await confirmUpload(
        connection.db,
        owner(),
        silent,
        ticket.value.attachmentId,
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
    const ticket = await request();
    if (isRefused(ticket)) throw new Error(ticket.reason);

    const mute: MemoryStorage = {
      ...storage,
      async signedUrl() {
        throw new Error("Invalid JWT");
      },
    };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    let link;
    try {
      link = await linkFor(connection.db, owner(), mute, ticket.value.attachmentId);
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

    const confirmed = await confirmUpload(
      connection.db,
      owner(),
      storage,
      ticket.value.attachmentId,
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
    const ticket = await request();
    if (isRefused(ticket)) throw new Error(ticket.reason);

    const stranger = tenantContext(seedIds.projects[1]!, seedIds.user, "owner");
    const refusedLink = await linkFor(
      connection.db,
      stranger,
      storage,
      ticket.value.attachmentId,
    );
    expect(isRefused(refusedLink) && refusedLink.reason).toBe("not-found");

    const link = await linkFor(
      connection.db,
      owner(),
      storage,
      ticket.value.attachmentId,
      60,
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

    const removed = await removeAttachment(
      connection.db,
      owner(),
      storage,
      ticket.value.attachmentId,
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
});

describe("safeName", () => {
  it("keeps a readable name without letting it travel", () => {
    expect(safeName("Planta Baixa v2.pdf")).toBe("Planta-Baixa-v2.pdf");
    expect(safeName("../../etc/passwd")).not.toContain("/");
    expect(safeName("../../etc/passwd").startsWith(".")).toBe(false);
    expect(safeName("")).toBe("arquivo");
  });
});
