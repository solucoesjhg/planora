"use client";

import { CalendarDays, Inbox } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select } from "@/components/ui/select";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ToastProvider, useToast } from "@/components/ui/toast";

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "ghost", "danger"];
const TONES: BadgeTone[] = [
  "neutral",
  "planning",
  "execution",
  "review",
  "done",
  "high",
  "medium",
  "low",
  "blocked",
];

export function UiGallery() {
  const [due, setDue] = useState<Date | null>(new Date(2026, 8, 18));

  return (
    <ToastProvider>
      <AppShell
        title="Primitivos"
        account={<Account />}
        panelTitle="Saúde do projeto"
        panel={<PanelPreview />}
      >
        <div className="flex max-w-4xl flex-col gap-10">
          <Section title="Button">
            <div className="flex flex-wrap items-center gap-3">
              {VARIANTS.map((variant) => (
                <Button key={variant} variant={variant}>
                  {variant}
                </Button>
              ))}
              <Button variant="primary" size="sm">
                pequeno
              </Button>
              <Button disabled>desabilitado</Button>
            </div>
          </Section>

          <Section title="Badge">
            <div className="flex flex-wrap items-center gap-2">
              {TONES.map((tone) => (
                <Badge key={tone} tone={tone}>
                  {tone}
                </Badge>
              ))}
            </div>
          </Section>

          <Section title="Campos">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Título">
                {(id) => <Input id={id} placeholder="Instalar bancada" />}
              </Field>
              <Field label="Prazo" hint="Deixe vazio se não houver data">
                {(id) => (
                  <Popover>
                    <PopoverTrigger
                      render={
                        <Button
                          id={id}
                          variant="secondary"
                          className="w-full justify-between font-normal"
                        >
                          {due ? due.toLocaleDateString("pt-BR") : "Escolher data"}
                          <CalendarDays size={15} aria-hidden />
                        </Button>
                      }
                    />
                    <PopoverContent>
                      <Calendar value={due} onSelect={setDue} />
                    </PopoverContent>
                  </Popover>
                )}
              </Field>
              <Field label="Responsável" error="Escolha alguém para tocar isto">
                {(id) => (
                  <Input id={id} aria-invalid defaultValue="ninguém" />
                )}
              </Field>
              <Field label="Prioridade">
                {(id) => (
                  <Select
                    id={id}
                    defaultValue="medium"
                    items={[
                      { value: "high", label: "Alta" },
                      { value: "medium", label: "Média" },
                      { value: "low", label: "Baixa" },
                    ]}
                  />
                )}
              </Field>
              <Field label="Notas internas" className="sm:col-span-2">
                {(id) => <Textarea id={id} placeholder="O que ficou pendente nesta fase" />}
              </Field>
            </div>
          </Section>

          <Section title="Sobreposições">
            <div className="flex flex-wrap items-center gap-3">
              <Dialog>
                <DialogTrigger
                  render={<Button variant="secondary">Abrir diálogo</Button>}
                />
                <DialogContent
                  title="Concluir tarefa"
                  description="Ainda há 2 itens de checklist abertos."
                  footer={
                    <>
                      <DialogClose render={<Button variant="ghost">Cancelar</Button>} />
                      <DialogClose render={<Button variant="primary">Concluir mesmo assim</Button>} />
                    </>
                  }
                >
                  Concluir agora registra a tarefa como forçada no histórico.
                </DialogContent>
              </Dialog>

              <Popover>
                <PopoverTrigger
                  render={
                    <Button variant="secondary">
                      <CalendarDays size={15} aria-hidden />
                      {due ? due.toLocaleDateString("pt-BR") : "Escolher data"}
                    </Button>
                  }
                />
                <PopoverContent>
                  <Calendar value={due} onSelect={setDue} />
                </PopoverContent>
              </Popover>

              <ToastButton />
            </div>
          </Section>

          <Section title="Estado vazio">
            <EmptyState
              icon={Inbox}
              title="Nenhum projeto ainda"
              description="Crie o primeiro para ver progresso, saúde e gargalos aparecerem aqui."
              action={<Button variant="primary">Criar projeto</Button>}
            />
          </Section>

          <Section title="Tema">
            <div className="flex items-center gap-3 text-[13px] text-secondary">
              <ThemeToggle />
              Escuro por padrão, claro suportado.
            </div>
          </Section>
        </div>
      </AppShell>
    </ToastProvider>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[11px] font-medium tracking-[0.14em] text-subtle uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ToastButton() {
  const toast = useToast();

  return (
    <Button
      variant="secondary"
      onClick={() =>
        toast.add({
          title: "Movimento recusado",
          description: "TSK-14 está bloqueada por uma dependência aberta.",
        })
      }
    >
      Mostrar aviso
    </Button>
  );
}

function Account() {
  return (
    <div className="flex items-center gap-2">
      <Avatar name="Henrique Zanellus" size="sm" />
      <ThemeToggle />
    </div>
  );
}

function PanelPreview() {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-panel border border-line bg-panel p-4 shadow-panel">
        <p className="text-[11px] tracking-[0.12em] text-subtle uppercase">
          Progresso ajustado
        </p>
        <p className="pln-display mt-1 text-3xl text-primary">62%</p>
        <p className="mt-1 text-xs text-secondary">Bruto 71% — 9 pontos parados</p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[11px] tracking-[0.12em] text-subtle uppercase">
          Gargalos
        </p>
        <div className="flex items-center justify-between gap-2 border-b border-hairline pb-2 text-[13px]">
          <span className="truncate text-secondary">TSK-14 Fundação</span>
          <Badge tone="blocked">bloqueada</Badge>
        </div>
        <div className="flex items-center justify-between gap-2 text-[13px]">
          <span className="truncate text-secondary">TSK-22 Laudo</span>
          <Badge tone="high">atrasada</Badge>
        </div>
      </div>
    </div>
  );
}
