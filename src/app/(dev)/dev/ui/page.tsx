import { notFound } from "next/navigation";
import { UiGallery } from "./gallery";

/**
 * Every primitive in every state, against the real theme (§5.2). This is what
 * we have instead of Storybook: one route, no second build, and it renders the
 * same CSS the product does.
 *
 * Off in production unless a deployment asks for it — the E2E suite runs
 * against a production build and needs it.
 */
export default function DevUiPage() {
  const enabled =
    process.env.NODE_ENV !== "production" ||
    process.env["ENABLE_DEV_ROUTES"] === "1";

  if (!enabled) notFound();
  return <UiGallery />;
}
