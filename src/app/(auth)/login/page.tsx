import { safeDestination } from "@/lib/nav";
import {
  EMAIL_VERIFIED,
  VERIFICATION_FAILED,
  VERIFICATION_FAILED_FALLBACK,
  VERIFIED_PARAM,
} from "@/lib/strings";
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

  // The verification link lands here rather than signing anybody in, so the
  // form has to say why it is being shown — and Better Auth appends its error
  // to that same callback instead of replacing it, so a link that failed
  // arrives carrying both. The failure is what the person needs to read.
  const failure = typeof params.error === "string" ? params.error : null;
  const notice = failure
    ? {
        tone: "problem" as const,
        message: VERIFICATION_FAILED[failure] ?? VERIFICATION_FAILED_FALLBACK,
      }
    : params[VERIFIED_PARAM] === "1"
      ? { tone: "done" as const, message: EMAIL_VERIFIED }
      : null;

  return <LoginForm next={destination} notice={notice} />;
}
