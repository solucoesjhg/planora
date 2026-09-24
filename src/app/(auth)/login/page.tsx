import { CONFIRMATION_PARAM } from "@/lib/confirmation-link";
import { safeDestination } from "@/lib/nav";
import { CONFIRMATION_EXPIRED, CONFIRMATION_PENDING } from "@/lib/strings";
import { readConfirmation } from "@/server/auth/confirmation";
import { authSecret } from "@/server/auth/secret";
import { LoginForm } from "./login-form";

// The server page reads searchParams and hands the value down, rather than the
// client calling useSearchParams — which would force this route out of the
// prerender and need a Suspense boundary to build at all.
export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const params = await searchParams;
  // Not merely "starts with a slash": `//evil.example` does too, and a browser
  // reads it as another host (src/lib/nav.ts).
  const destination = safeDestination(params.next);

  // The confirmation link lands here, and signing in with it is what confirms
  // the address (ADR 0007). The token is read here only to say so, and to fill
  // in the address it was sent to; the sign-in hook checks it again.
  const token = params[CONFIRMATION_PARAM];
  const confirmation =
    typeof token === "string" ? await readConfirmation(token, authSecret()) : null;

  const notice =
    token === undefined
      ? null
      : confirmation
        ? { tone: "done" as const, message: CONFIRMATION_PENDING }
        : { tone: "problem" as const, message: CONFIRMATION_EXPIRED };

  return (
    <LoginForm
      next={destination}
      notice={notice}
      confirmation={
        confirmation && typeof token === "string"
          ? { token, email: confirmation.email }
          : null
      }
    />
  );
}
