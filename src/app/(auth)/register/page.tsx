import { RegisterForm } from "./register-form";

// The server page reads searchParams and hands the destination down, the way
// /login does — and for the same reason: `next` is where an invitation was
// leading before it asked the person to have an account first.
export default async function RegisterPage({
  searchParams,
}: PageProps<"/register">) {
  const { next } = await searchParams;
  const destination = typeof next === "string" && next.startsWith("/") ? next : "/dashboard";

  return <RegisterForm next={destination} />;
}
