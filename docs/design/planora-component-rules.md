# Planora — Regras de Componentes

## 1. App Background

Obrigatório:

```tsx
<div className="pln-app">
  ...
</div>
```

Não criar gradientes fortes coloridos. Não usar luzes laranjas/azuis como background.

## 2. Task Card

O `TaskCard` deve ser neutro.

Obrigatório:

```tsx
<article className="pln-task-card" style={{ "--pln-card-accent": phaseColor }}>
  <span className="pln-card-divider-1" />
  <span className="pln-card-divider-2" />
</article>
```

Não usar:

```txt
bg-red-500
bg-blue-500
bg-green-500
card inteiro colorido
imagem de card inteira
```

A cor deve estar somente na faixa direita de 3px, nas duas linhas verticais internas e em ícones/badges pontuais.

## 3. Kanban Column

```txt
width: 300px
border-radius: 12px
border: 1px solid rgba(232,221,200,0.10)
background: #121614 / #151915
```

A coluna deve ter rolagem interna e não empurrar o layout inteiro.

## 4. Sidebar

```txt
left width: 238px
right width: 338px
```

A sidebar esquerda deve ter destaque sienna apenas no item ativo.

## 5. Painéis da direita

Todos os widgets usam:

```txt
background: #151915
border: rgba(232,221,200,0.10)
radius: 14px
shadow: pln-panel
```

## 6. Tipografia

Títulos grandes e nomes de coluna usam `font-display`. Textos de UI, badges e metadata usam `font-ui`.

## 7. Proibição

O AG/Codex não pode inventar cores adicionais, shadows fora dos tokens, border radius diferentes, fundos neon, cards com preenchimento colorido ou cards como imagens inteiras.
