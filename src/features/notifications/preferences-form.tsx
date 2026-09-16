"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import {
  DEFAULT_CHANNELS,
  NOTIFIABLE_TYPES,
  NOTIFICATION_TYPE_LABELS,
  type Channels,
  type NotifiableType,
} from "@/lib/notifications";
import { savePreferencesAction } from "@/server/modules/notifications/actions";

export type PreferencesInput = {
  readonly channels: Partial<Record<NotifiableType, Partial<Channels>>>;
  readonly digest: "none" | "daily" | "weekly";
};

const DIGEST_OPTIONS = [
  { value: "none", label: "Sem resumo — cada aviso por si" },
  { value: "daily", label: "Resumo diário do que ficou sem ler" },
  { value: "weekly", label: "Resumo semanal do que ficou sem ler" },
];

export function PreferencesForm({ initial }: { initial: PreferencesInput }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [channels, setChannels] = useState<PreferencesInput["channels"]>(initial.channels);
  const [digest, setDigest] = useState(initial.digest);

  function channelOf(type: NotifiableType): Channels {
    const own = channels[type];
    return {
      inApp: own?.inApp ?? DEFAULT_CHANNELS[type].inApp,
      email: own?.email ?? DEFAULT_CHANNELS[type].email,
    };
  }

  function set(type: NotifiableType, key: keyof Channels, value: boolean): void {
    setChannels({ ...channels, [type]: { ...channelOf(type), [key]: value } });
  }

  function save(): void {
    startTransition(async () => {
      await savePreferencesAction({ channels, digest });
      toast.add({ title: "Preferências salvas" });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5" data-testid="preferences-form">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[11px] tracking-[0.12em] text-subtle uppercase">
            <th className="py-2 font-normal">Evento</th>
            <th className="py-2 text-center font-normal">Caixa de entrada</th>
            <th className="py-2 text-center font-normal">E-mail</th>
          </tr>
        </thead>
        <tbody>
          {NOTIFIABLE_TYPES.map((type) => {
            const current = channelOf(type);
            return (
              <tr key={type} className="border-t border-hairline">
                <td className="py-2 text-secondary">{NOTIFICATION_TYPE_LABELS[type]}</td>
                <td className="py-2 text-center">
                  <input
                    type="checkbox"
                    aria-label={`${NOTIFICATION_TYPE_LABELS[type]} na caixa de entrada`}
                    className="accent-sienna"
                    checked={current.inApp}
                    onChange={(event) => set(type, "inApp", event.target.checked)}
                  />
                </td>
                <td className="py-2 text-center">
                  <input
                    type="checkbox"
                    aria-label={`${NOTIFICATION_TYPE_LABELS[type]} por e-mail`}
                    className="accent-sienna"
                    checked={current.email}
                    onChange={(event) => set(type, "email", event.target.checked)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Field label="Resumo por e-mail">
        {(id) => (
          <Select
            id={id}
            items={DIGEST_OPTIONS}
            value={digest}
            onValueChange={(value) => setDigest(value as PreferencesInput["digest"])}
          />
        )}
      </Field>

      <div>
        <Button variant="primary" disabled={pending} onClick={save}>
          {pending ? "Salvando…" : "Salvar preferências"}
        </Button>
      </div>
    </div>
  );
}
