"use client";

/**
 * The boundary of last resort: an error thrown by the root layout itself,
 * where there is no shell left to keep. It renders its own document, so it
 * cannot rely on anything above it — including the fonts and the tokens.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          background: "#12100e",
          color: "#f2ece3",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "1.5rem",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 500, margin: 0 }}>
          O Planora não conseguiu carregar
        </h1>
        <p style={{ fontSize: "0.85rem", opacity: 0.75, maxWidth: "28rem" }}>
          A falha aconteceu antes de a interface existir. Recarregar costuma
          resolver; se insistir, o problema está do nosso lado.
          {error.digest ? ` Referência ${error.digest}.` : ""}
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            border: "1px solid rgba(242,236,227,0.25)",
            background: "transparent",
            color: "inherit",
            borderRadius: "8px",
            padding: "0.5rem 1rem",
            cursor: "pointer",
            font: "inherit",
          }}
        >
          Tentar de novo
        </button>
      </body>
    </html>
  );
}
