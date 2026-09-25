"use client";

import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Field, Input } from "@/components/ui/field";
import {
  type Identity,
  type PasswordRefusal,
  type PasswordVerdict,
  isPasswordVerdict,
} from "@/domain/passwords";
import { authClient } from "@/lib/auth-client";
import { PASSWORD_CHECK_PATH } from "@/lib/password-check";
import { PASSWORD_REFUSALS } from "@/lib/strings";
import {
  type PasswordFeedback,
  feedbackStatus,
  passwordFeedback,
  remember,
  worthAsking,
} from "./password-feedback";

/** How long the person has to stop typing before the server is asked. */
const PAUSE_MS = 500;

/** How long an answer may take before the field says it could not check. */
const PATIENCE_MS = 5000;

export type PasswordCheck = {
  readonly feedback: PasswordFeedback;
  /** What a screen reader hears: only a settled verdict, never each keystroke. */
  readonly announcement: string;
  /** A refusal said out loud when a submit stops on it, every time. */
  readonly alert: { readonly id: number; readonly text: string } | null;
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onBlur: () => void;
  /**
   * For the submit button, with what the input holds right now: calls the
   * field finished and answers with the refusal the form should stop on, if
   * the field already knows one. Anything it does not know yet — still
   * checking, or the corpus out of reach — goes to the server, which decides.
   */
  readonly settle: (password: string, identity?: Identity) => PasswordRefusal | null;
  /** The server refused this password at submit: the field says so from now on. */
  readonly refuse: (password: string, reason: PasswordRefusal) => void;
};

/**
 * The password field's state (ADR 0008): the shape rules as the person types,
 * the server's live check once they pause, and the verdicts already heard, so
 * going back to a password tried a moment ago costs nothing.
 *
 * The input itself stays uncontrolled. Text typed before the page hydrated, or
 * restored by the browser, is in the input and not in this state; a controlled
 * input would overwrite it with an empty string on the next render. So the
 * form reads the input when it submits, and hands that value to `settle`.
 */
export function usePasswordCheck(identity: Identity): PasswordCheck {
  const [password, setPassword] = useState("");
  const [settled, setSettled] = useState(false);
  const [verdicts, setVerdicts] = useState<ReadonlyMap<string, PasswordVerdict>>(
    () => new Map(),
  );
  const [alert, setAlert] = useState<PasswordCheck["alert"]>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const asking = useRef<{ password: string; controller: AbortController } | null>(null);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      asking.current?.controller.abort();
    },
    [],
  );

  function ask(value: string, known: ReadonlyMap<string, PasswordVerdict>) {
    if (!worthAsking(value) || known.has(value)) return;
    if (asking.current?.password === value) return;

    asking.current?.controller.abort();
    const controller = new AbortController();
    asking.current = { password: value, controller };

    void askServer(value, controller.signal).then((verdict) => {
      if (asking.current?.controller === controller) asking.current = null;
      if (verdict !== null) setVerdicts((current) => remember(current, value, verdict));
    });
  }

  function follow(value: string, delayMs: number) {
    setPassword(value);
    setSettled(false);
    clearTimeout(timer.current);
    if (asking.current && asking.current.password !== value) {
      asking.current.controller.abort();
      asking.current = null;
    }

    const known = verdicts;
    timer.current = setTimeout(() => {
      setSettled(true);
      ask(value, known);
    }, delayMs);
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    // A paste or a password manager fills the field at once: nothing more is
    // coming, so there is no pause to wait for.
    follow(value, Math.abs(value.length - password.length) > 1 ? 0 : PAUSE_MS);
  }

  function onBlur() {
    clearTimeout(timer.current);
    setSettled(true);
    ask(password, verdicts);
  }

  function settle(value: string, current: Identity = identity): PasswordRefusal | null {
    if (value !== password) follow(value, 0);
    setSettled(true);

    const final = passwordFeedback(value, current, verdicts.get(value), true);
    if (final.kind !== "refused") return null;

    setAlert((previous) => ({
      id: (previous?.id ?? 0) + 1,
      text: PASSWORD_REFUSALS[final.reason],
    }));
    return final.reason;
  }

  function refuse(value: string, reason: PasswordRefusal) {
    if (value !== password) setPassword(value);
    setSettled(true);
    setVerdicts((current) => remember(current, value, reason));
    setAlert((previous) => ({ id: (previous?.id ?? 0) + 1, text: PASSWORD_REFUSALS[reason] }));
  }

  const feedback = passwordFeedback(password, identity, verdicts.get(password), settled);

  return {
    feedback,
    announcement:
      settled && feedback.kind !== "checking" ? feedbackStatus(feedback).text : "",
    alert,
    onChange,
    onBlur,
    settle,
    refuse,
  };
}

/**
 * One question to the live check. `null` when the question was withdrawn —
 * the person typed on — so there is nothing to record; "unavailable" when it
 * could not be answered, whatever the reason: the submit decides then.
 */
async function askServer(
  password: string,
  withdrawn: AbortSignal,
): Promise<PasswordVerdict | null> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  withdrawn.addEventListener("abort", stop);
  const patience = setTimeout(stop, PATIENCE_MS);

  try {
    const { data, error } = await authClient.$fetch<{ verdict?: unknown }>(PASSWORD_CHECK_PATH, {
      method: "POST",
      body: { password },
      signal: controller.signal,
    });
    if (withdrawn.aborted) return null;
    return !error && isPasswordVerdict(data?.verdict) ? data.verdict : "unavailable";
  } catch {
    return withdrawn.aborted ? null : "unavailable";
  } finally {
    clearTimeout(patience);
    withdrawn.removeEventListener("abort", stop);
  }
}

/**
 * The refusal a submit came back with, when it was the password's: the reason
 * the hook names beside its message (`src/server/auth/config.ts`).
 */
export function passwordRefusalOf(error: unknown): PasswordRefusal | null {
  if (typeof error !== "object" || error === null) return null;
  const { code, reason } = error as { code?: unknown; reason?: unknown };
  if (code !== "WEAK_PASSWORD" || !isPasswordVerdict(reason)) return null;
  return reason === "accepted" || reason === "unavailable" ? null : reason;
}

/**
 * The password input with its line. The line under the input describes it, so
 * focusing the input reads the verdict; a separate, hidden region announces a
 * verdict once the person pauses, and a hidden alert repeats a refusal each
 * time a submit stops on it.
 */
export function PasswordField({
  label,
  check,
  autoComplete,
  autoFocus,
}: {
  readonly label: string;
  readonly check: PasswordCheck;
  readonly autoComplete: "new-password";
  readonly autoFocus?: boolean;
}) {
  return (
    <>
      <Field label={label} status={feedbackStatus(check.feedback)}>
        {(id, describedBy) => (
          <Input
            id={id}
            name="password"
            type="password"
            required
            autoComplete={autoComplete}
            autoFocus={autoFocus}
            aria-describedby={describedBy}
            aria-invalid={check.feedback.kind === "refused" || undefined}
            onChange={check.onChange}
            onBlur={check.onBlur}
          />
        )}
      </Field>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {check.announcement}
      </p>
      {check.alert ? (
        <p key={check.alert.id} role="alert" className="sr-only">
          {check.alert.text}
        </p>
      ) : null}
    </>
  );
}
