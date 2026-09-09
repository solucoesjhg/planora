import { LoginForm } from "./login-form";

// The server page reads searchParams and hands the value down, rather than the
// client calling useSearchParams — which would force this route out of the
// prerender and need a Suspense boundary to build at all.
export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const { next } = await searchParams;
  const destination = typeof next === "string" && next.startsWith("/") ? next : "/dashboard";

  return <LoginForm next={destination} />;
}
