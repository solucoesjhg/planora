# Planora UI Kit — Etapa 3
## Especificação componente por componente

Este pacote transforma a referência visual do Planora em instruções de implementação para Antigravity/Codex.

Objetivo: evitar que o agente tente “interpretar” a imagem inteira. Ele deve reconstruir a tela em componentes isolados, usando os tokens da Etapa 2 como fonte única de verdade visual.

---

## Regra-mãe

A UI deve ser construída em camadas:

```txt
Design Tokens → Component Primitives → Componentes do Produto → Tela Final
```

Nunca construa a tela inteira primeiro.

---

## Componentes desta etapa

1. `TaskCard`
2. `KanbanColumn`
3. `SidebarLeft`
4. `SidebarRight`
5. `TopHeader`
6. `FilterBar`
7. `ProgressDonut`
8. `ProjectHealthCard`

---

## Ordem correta de implementação

```txt
1. Aplicar tokens globais
2. Criar primitive CardSurface
3. Criar TaskCard neutro
4. Criar KanbanColumn usando TaskCard
5. Criar SidebarLeft
6. Criar SidebarRight
7. Criar Header + FilterBar
8. Montar a tela Kanban
```

---

## Proibição importante

Não use imagem rasterizada como card inteiro.

O card deve ser CSS-driven, responsivo e colorido por variável CSS:

```tsx
style={{ "--pln-card-accent": column.color } as React.CSSProperties}
```

O asset visual do card serve apenas como referência de textura/formato, não como background final inteiro.

---

## Linguagem visual obrigatória

- Dark matte como tema padrão; o tema claro é uma versão em osso quente da
  mesma paleta, nunca uma inversão (ver `10-decisoes-e-erratas.md`)
- Textura paper grain discreta
- Bordas finas e pouco contrastadas
- Sombras suaves, não “glow”
- Tipografia serifada nos títulos grandes e títulos de painéis
- Sans-serif nos textos de UI
- Cards retangulares longos com cantos arredondados
- Divisores arquitetônicos verticais na lateral direita do card
- Accent color aplicado somente em detalhes controlados

---

## O que o agente NÃO deve fazer

- Não inventar gradientes coloridos no fundo
- Não usar luzes laranja/azul no background do app
- Não aplicar cor forte no corpo inteiro do card
- Não usar sombras neon
- Não aumentar demais o contraste das bordas
- Não usar cards quadrados ou muito altos
- Não usar UI glassmorphism intensa
- Não usar background blur pesado
- Não colocar regras de negócio no componente visual
