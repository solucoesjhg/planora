# Planora — Tailwind Extension

Use este bloco como referência para estender o Tailwind.

## tailwind.config.ts

```ts
import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Cormorant Garamond", "Georgia", "serif"],
        ui: ["Inter", "Manrope", "system-ui", "sans-serif"],
      },
      colors: {
        planora: {
          app: "#0E1110",
          appSoft: "#101412",
          surface: "#121614",
          panel: "#151915",
          panelElevated: "#171C18",
          card: "#181C19",
          cardHover: "#1B201C",
          text: "#EEE5D6",
          textSecondary: "#AFA697",
          textMuted: "#8F887D",
          textSubtle: "#746E66",
          sienna: "#A85C3A",
          siennaMuted: "#7A3F2D",
          gold: "#C4A35A",
          stormy: "#6F7F8C",
          sage: "#6EA47A",
          danger: "#D57964",
          info: "#6F9CB1",
        },
      },
      borderRadius: {
        "pln-button": "10px",
        "pln-card": "10px",
        "pln-column": "12px",
        "pln-panel": "14px",
      },
      boxShadow: {
        "pln-card": "0 16px 35px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.035)",
        "pln-card-hover": "0 22px 55px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.045)",
        "pln-panel": "0 18px 50px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.035)",
      },
      width: {
        "sidebar-left": "238px",
        "sidebar-right": "338px",
        "kanban-column": "300px",
      },
      minHeight: {
        "task-card": "114px",
      },
    },
  },
  plugins: [],
} satisfies Config;
```

## Exemplo de uso

```tsx
<article
  className="pln-task-card"
  style={{ "--pln-card-accent": "#6F7F8C" } as React.CSSProperties}
>
  <span className="pln-card-divider-1" />
  <span className="pln-card-divider-2" />
  <h3 className="text-[15px] font-medium text-planora-text">
    Contratação de fornecedores
  </h3>
</article>
```
