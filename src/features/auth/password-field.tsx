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
  readonly password: string;
  readonly feedback: PasswordFeedback;
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onBlur: () => void;
  /**
   * For the submit button: calls the field finished and answers with the
   * refusal the form should stop on, if the field already knows one.
   * Anything it does not know yet — still checking, or the corpus out of reach
   * — goes to the server, which decides.
   */
  readonly settle: () => PasswordRefusal | null;
};

/**
 * The password field's state (ADR 0008): the shape rules as the person types,
 * the server's live check once they pause, and the verdicts already heard, so
 * going back to a password tried a moment ago costs nothing.
 */
export function usePasswordCheck(identity: Identity): PasswordCheck {
  const [password, setPassword] = useState("");
  const [settled, setSettled] = useState(false);
  const [verdicts, setVerdicts] = useState<ReadonlyMap<string, PasswordVerdict>>(
    () => new Map(),
  );

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

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    // A paste or a password manager fills the field at once: nothing more is
    // coming, so there is no pause to wait for.
    const filled = Math.abs(value.length - password.length) > 1;

    setPassword(value);
    setSettled(false);
    clearTimeout(timer.current);
    if (asking.current && asking.current.password !== value) {
      asking.current.controller.abort();
      asking.current = null;
    }

    const known = verdicts;
    timer.current = setTimeout(
      () => {
        setSettled(true);
        ask(value, known);
      },
      filled ? 0 : PAUSE_MS,
    );
  }

  function onBlur() {
    clearTimeout(timer.current);
    setSettled(true);
    ask(password, verdicts);
  }

  function settle(): PasswordRefusal | null {
    setSettled(true);
    const final = passwordFeedback(password, identity, verdicts.get(password), true);
    return final.kind === "refused" ? final.reason : null;
  }

  return {
    password,
    feedback: passwordFeedback(password, identity, verdicts.get(password), settled),
    onChange,
    onBlur,
    settle,
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
 * The password input with its live line. The line is the field's status, read
 * by screen readers politely and linked to the input, so focusing the input
 * reads the verdict too.
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
          value={check.password}
          onChange={check.onChange}
          onBlur={check.onBlur}
        />
      )}
    </Field>
  );
}
