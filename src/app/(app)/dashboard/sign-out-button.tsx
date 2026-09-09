"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await signOut();
        router.push("/login");
        router.refresh();
      }}
      className="rounded border px-3 py-1 text-sm disabled:opacity-60"
    >
      {busy ? "Saindo..." : "Sair"}
    </button>
  );
}
