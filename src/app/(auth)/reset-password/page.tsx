import { ResetPasswordForm } from "./reset-password-form";

/**
 * Better Auth's callback lands here with `?token=` when the link is good and
 * `?error=INVALID_TOKEN` when it is unknown or expired. The server page reads
 * both so the client form never needs useSearchParams and its Suspense
 * boundary — the same reason /login reads `next` here.
 */
export default async function ResetPasswordPage({
  searchParams,
}: PageProps<"/reset-password">) {
  const { token, error } = await searchParams;
  const valid = typeof token === "string" && token.length > 0 ? token : null;

  return <ResetPasswordForm token={valid} expired={typeof error === "string" || !valid} />;
}
