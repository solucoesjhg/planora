import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { currentSession } from "@/server/auth/dal";

/**
 * The front door. Signed in there is nothing to say here — go to the panel.
 * Signed out it says what the product is and offers the two ways in.
 */
export default async function HomePage() {
  const session = await currentSession();
  if (session) redirect("/dashboard");

  return (
    <div className="relative z-1 flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-2 rounded-full bg-sienna" />
          <span className="pln-display text-lg text-primary">Planora</span>
        </span>
        <ThemeToggle />
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-6 pb-24">
        <h1 className="pln-display text-balance text-4xl leading-tight text-primary">
          O quadro que sabe como o projeto realmente vai.
        </h1>

        <p className="max-w-prose text-secondary">
          Progresso por fase, saúde do projeto com o motivo de cada alerta,
          bloqueios que impedem a conclusão indevida, e histórico que se escreve
          sozinho a cada mudança de etapa.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Link href="/register">
            <Button variant="primary">Criar conta</Button>
          </Link>
          <Link href="/login">
            <Button variant="ghost">Entrar</Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
