# Componente: SidebarRight

## Objetivo visual

A sidebar direita é uma área de inteligência contextual do projeto. Ela deve exibir progresso, saúde, tarefas principais e projetos sem poluir a tela.

---

## Medidas

```txt
largura: 338px
altura: 100vh
padding: 20px
gap entre painéis: 16px
border-left: 1px
panel radius: 12px
panel padding: 20px
```

---

## Blocos

```txt
SidebarRight
├── ProgressCard
│   └── ProgressDonut
├── ProjectHealthCard
├── MainTasksCard
└── MiniProjectsCard
```

---

## CSS recomendado

```css
.pln-sidebar-right {
  width: 338px;
  height: 100vh;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  border-left: 1px solid rgba(232, 221, 200, 0.10);
  background: rgba(14, 17, 16, 0.96);
}

.pln-side-panel {
  position: relative;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid rgba(232, 221, 200, 0.10);
  background:
    linear-gradient(180deg, rgba(255,255,255,0.018), rgba(255,255,255,0.004)),
    #151915;
  padding: 20px;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.035),
    0 16px 36px rgba(0,0,0,0.14);
}

.pln-side-panel-title {
  font-family: var(--pln-font-serif);
  font-size: 19px;
  color: var(--pln-text-primary);
}

.pln-progress-donut {
  width: 164px;
  height: 164px;
  margin: 16px auto 0;
  border-radius: 999px;
  padding: 15px;
  background: conic-gradient(from 210deg, #6EA47A 0 38%, #C4A35A 38% 66%, #A85C3A 66% 100%);
  box-shadow: 0 20px 50px rgba(0,0,0,0.25);
}

.pln-progress-donut-inner {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: #111411;
  box-shadow: inset 0 0 20px rgba(0,0,0,0.55);
}
```

---

## Regras

- Não usar painel com fundo claro.
- Não usar gráfico com cores saturadas.
- Saúde do projeto deve ser compacta.
- Tarefas principais devem ter linhas divisórias finas.
- Mini lista de projetos deve ter item ativo com fundo sienna escuro.
