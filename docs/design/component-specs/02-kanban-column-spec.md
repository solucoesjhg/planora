# Componente: KanbanColumn

## Objetivo visual

A coluna deve parecer uma bandeja vertical escura, neutra e organizada. Ela não deve competir visualmente com os cards. A coluna é o suporte; o card é o protagonista.

---

## Anatomia

```txt
KanbanColumn
├── container vertical
├── header fixo
│   ├── ícone da fase
│   ├── título serifado
│   ├── badge de contagem
│   ├── botão adicionar
│   └── menu
└── lista rolável de TaskCards
```

---

## Medidas

```txt
largura mínima: 300px
largura ideal: 300px a 320px
border-radius: 14px
gap interno entre cards: 12px
padding lista: 12px
header height: 64px
```

---

## CSS recomendado

```css
.pln-kanban-column {
  min-width: 300px;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  border: 1px solid rgba(232, 221, 200, 0.10);
  background:
    linear-gradient(180deg, rgba(255,255,255,0.018), rgba(255,255,255,0.004)),
    rgba(18, 22, 20, 0.82);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.035),
    0 18px 40px rgba(0,0,0,0.16);
}

.pln-kanban-column-header {
  height: 64px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(232, 221, 200, 0.07);
}

.pln-kanban-column-title {
  font-family: var(--pln-font-serif);
  font-size: 19px;
  color: var(--pln-text-primary);
  letter-spacing: -0.01em;
}

.pln-kanban-column-count {
  min-width: 28px;
  height: 28px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  border: 1px solid rgba(232, 221, 200, 0.10);
  background: rgba(255,255,255,0.035);
  font-size: 12px;
  color: var(--pln-text-muted);
}

.pln-kanban-column-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  padding-right: 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
```

---

## Regras

- A coluna não deve ter background colorido forte.
- A cor da fase aparece no ícone e nos cards, não no corpo da coluna.
- Header deve ser limpo, com título serifado.
- Lista deve ter scroll próprio.
- Não usar sombra colorida.
