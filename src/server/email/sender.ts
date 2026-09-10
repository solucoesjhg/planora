/**
 * Transactional email (DEVELOPMENT_PLAN.md §7 Phase 3).
 *
 * Verification, password reset and workspace invitations need real delivery
 * before any product feature does. Once this plumbing exists — a provider, a
 * local inbox, versioned templates — every later notification is one more
 * template rather than one more integration.
 */

export type EmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
};

export type EmailSender = {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
};

/** Development and tests: nothing leaves the machine. */
export function memorySender(): EmailSender & {
  readonly outbox: EmailMessage[];
} {
  const outbox: EmailMessage[] = [];
  return {
    name: "memory",
    outbox,
    async send(message) {
      outbox.push(message);
    },
  };
}

/** Development: a real inbox with a real interface, on localhost. */
export function mailpitSender(baseUrl: string, from: string): EmailSender {
  return {
    name: "mailpit",
    async send(message) {
      const response = await fetch(`${baseUrl}/api/v1/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          From: { Email: addressOf(from), Name: nameOf(from) },
          To: [{ Email: message.to }],
          Subject: message.subject,
          HTML: message.html,
          Text: message.text,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `mailpit refused the message: ${response.status} ${await response.text()}`,
        );
      }
    },
  };
}

/** Production. */
export function resendSender(apiKey: string, from: string): EmailSender {
  return {
    name: "resend",
    async send(message) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `resend refused the message: ${response.status} ${await response.text()}`,
        );
      }
    },
  };
}

/**
 * The sender this process should use.
 *
 * Resend when it is configured, the local inbox otherwise — except in
 * production, where the local inbox is a machine that does not exist. Falling
 * back there would make every verification email throw at signup, which is a
 * broken product for anybody trying to create an account.
 */
export function senderFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): EmailSender {
  const from = env["EMAIL_FROM"] ?? "Planora <no-reply@localhost>";
  const apiKey = env["RESEND_API_KEY"];

  if (apiKey && apiKey.length > 0) return resendSender(apiKey, from);

  if (env["NODE_ENV"] === "production") {
    throw new Error(
      "RESEND_API_KEY is required in production: without it, account " +
        "verification and invitations would be posted to a local inbox that " +
        "is not there.",
    );
  }

  return mailpitSender(env["MAILPIT_URL"] ?? "http://127.0.0.1:8025", from);
}

function addressOf(from: string): string {
  return from.match(/<(.+)>/)?.[1] ?? from;
}

function nameOf(from: string): string {
  return from.replace(/<.+>/, "").trim();
}
