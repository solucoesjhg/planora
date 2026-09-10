"use client";

import { useEffect } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Where an unexpected error lands (DEVELOPMENT_PLAN.md §2.3).
 *
 * The architecture says refusals are values and only the unexpected throws —
 * which was true, except that nothing caught the unexpected. This is that
 * boundary: it keeps the shell, says what happened without pretending to know
 * why, and offers the one thing that sometimes works.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Until Phase 11 wires real error reporting, the console is the report.
    console.error("unhandled error", error);
  }, [error]);

  return (
    <main className="pln-ground flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="pln-display text-2xl text-primary">Algo quebrou aqui</h1>
        <p className="max-w-sm text-[13px] text-secondary">
          O erro foi registrado. Nada do que você tinha salvo se perdeu — o que
          falhou foi a montagem desta tela.
        </p>
        {error.digest ? (
          <p className="font-mono text-[11px] text-subtle">
            referência {error.digest}
          </p>
        ) : null}
      </div>

      <Button variant="primary" onClick={reset}>
        <RotateCw size={14} aria-hidden />
        Tentar de novo
      </Button>
    </main>
  );
}
