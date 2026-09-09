import type { ReactNode } from "react";

// Deliberately plain: the design system arrives in Phase 4 and restyles these.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-16">
      {children}
    </main>
  );
}
