import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The 404 the application actually shows (DEVELOPMENT_PLAN.md §2.3).
 *
 * `notFound()` is thrown deliberately in several places — a task in another
 * workspace, a project that was deleted — and until now every one of them
 * landed on the framework's default page. A refusal deserves the product's own
 * voice, especially the ones that are a security answer rather than a mistake.
 */
export default function NotFound() {
  return (
    <main className="pln-ground flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="rounded-full border border-line bg-surface p-3.5 text-muted">
        <FileQuestion size={20} aria-hidden />
      </span>

      <div className="flex flex-col gap-2">
        <h1 className="pln-display text-2xl text-primary">
          Não encontramos esta página
        </h1>
        <p className="max-w-sm text-[13px] text-secondary">
          Ou ela não existe, ou pertence a um espaço de trabalho que não é o seu.
          Nós não dizemos qual dos dois.
        </p>
      </div>

      <Link href="/dashboard">
        <Button variant="primary">Voltar ao painel</Button>
      </Link>
    </main>
  );
}
