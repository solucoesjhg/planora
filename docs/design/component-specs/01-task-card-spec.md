# Componente: TaskCard

## Objetivo visual

O `TaskCard` é o elemento visual mais importante do Kanban. Ele deve parecer um cartão físico escuro, fosco, com textura orgânica de cartolina/papel, mas ainda ser totalmente construído com CSS/Tailwind.

O card deve ser neutro por padrão. A cor da fase/coluna deve entrar apenas por uma variável CSS: `--pln-card-accent`.

---

## Anatomia do card

```txt
TaskCard
├── superfície neutra escura
├── textura paper grain discreta
├── borda fina
├── sombra externa suave
├── brilho interno quase invisível
├── conteúdo textual
│   ├── título
│   ├── prioridade
│   ├── checklist
│   ├── prazo
│   └── avatar
└── lateral direita
    ├── 1 faixa grossa de accent color
    ├── 2 linhas verticais finas
    └── área de respiro para ícones/estado
```

---

## Medidas obrigatórias

```txt
largura: 100%
altura mínima: 100px a 114px
padding: 16px
padding-right: 56px
border-radius: 12px
border: 1px sólido com baixa opacidade
faixa de accent direita: 3px
linhas internas: 1px cada
distância das linhas até a direita: 36px e 42px
distância da faixa colorida: right: 0
```

---

## CSS base recomendado

```css
.pln-task-card {
  --pln-card-accent: #6EA47A;
  position: relative;
  overflow: hidden;
  min-height: 108px;
  width: 100%;
  padding: 16px;
  padding-right: 56px;
  border-radius: 12px;
  border: 1px solid rgba(232, 221, 200, 0.10);
  background:
    linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.006)),
    #171B18;
  box-shadow:
    0 16px 35px rgba(0, 0, 0, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.035),
    inset 0 -1px 0 rgba(0, 0, 0, 0.35);
  transition: transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
}

.pln-task-card:hover {
  transform: translateY(-2px);
  border-color: rgba(232, 221, 200, 0.18);
  box-shadow:
    0 22px 55px rgba(0, 0, 0, 0.30),
    inset 0 1px 0 rgba(255, 255, 255, 0.045),
    inset 0 -1px 0 rgba(0, 0, 0, 0.42);
}

.pln-task-card::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.28;
  mix-blend-mode: screen;
  background-image:
    radial-gradient(circle at 18% 24%, rgba(255,255,255,0.055) 0 1px, transparent 1px),
    radial-gradient(circle at 77% 36%, rgba(255,255,255,0.035) 0 1px, transparent 1px),
    radial-gradient(circle at 42% 82%, rgba(255,255,255,0.025) 0 1px, transparent 1px);
  background-size: 18px 18px, 24px 24px, 31px 31px;
}

.pln-task-card::after {
  content: "";
  position: absolute;
  top: 0;
  right: 0;
  width: 3px;
  height: 100%;
  background: var(--pln-card-accent);
  opacity: 0.85;
}

.pln-card-divider-1,
.pln-card-divider-2 {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--pln-card-accent);
  pointer-events: none;
}

.pln-card-divider-1 { right: 42px; opacity: 0.55; }
.pln-card-divider-2 { right: 36px; opacity: 0.22; }
```

---

## JSX recomendado

```tsx
type TaskCardProps = {
  title: string;
  priority: "Alta" | "Média" | "Baixa";
  checklist: string;
  dueDate: string;
  avatarLabel?: string;
  accentColor: string;
  done?: boolean;
  blocked?: boolean;
};

export function TaskCard({
  title,
  priority,
  checklist,
  dueDate,
  avatarLabel = "PL",
  accentColor,
  done,
  blocked,
}: TaskCardProps) {
  return (
    <article
      className="pln-task-card"
      style={{ "--pln-card-accent": accentColor } as React.CSSProperties}
      data-done={done ? "true" : "false"}
      data-blocked={blocked ? "true" : "false"}
    >
      <span className="pln-card-divider-1" />
      <span className="pln-card-divider-2" />
      <div className="relative z-10">
        <h3 className="line-clamp-2 text-[15px] font-medium leading-snug text-pln-text-primary">
          {title}
        </h3>
        <div className="mt-4 flex items-center gap-2 text-[11px] text-pln-text-muted">
          <span className="inline-flex items-center gap-1">
            <Flag className="h-3 w-3" />
            {priority}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-5 text-xs text-pln-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <CheckSquare className="h-3.5 w-3.5" />
            {checklist}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" />
            {dueDate}
          </span>
          <div className="ml-auto grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/10 text-[10px]">
            {avatarLabel}
          </div>
        </div>
      </div>
    </article>
  );
}
```

---

## Estados visuais

```css
.pln-task-card[data-done="true"] h3 {
  color: rgba(238, 229, 214, 0.55);
  text-decoration: line-through;
}

.pln-task-card[data-blocked="true"] {
  border-color: rgba(184, 90, 70, 0.26);
}
```

---

## Erros comuns que o AG deve evitar

- fazer card com fundo preto puro
- colocar gradiente colorido no card inteiro
- deixar a faixa direita larga demais
- criar bordas brancas fortes
- usar sombra azul, laranja ou neon
- fazer card com altura variável exagerada
- remover a textura paper grain
- esquecer `padding-right` para acomodar as linhas verticais
