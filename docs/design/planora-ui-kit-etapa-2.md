# Planora UI Kit — Etapa 2: Design Tokens

Este pacote define os **tokens visuais oficiais** para o Planora, com foco em reproduzir fielmente a referência dark premium: fundo matte, textura sutil, cards com paper grain, bordas finas, sombras elegantes, tipografia editorial e acentos por fase.

## Objetivo

A Etapa 1 gerou referências/assets visuais. A Etapa 2 transforma a estética em regras reproduzíveis por código.

A partir daqui, o Antigravity/Codex deve parar de “interpretar a imagem” e passar a aplicar estes tokens.

## Arquivos gerados

```txt
planora-design-tokens.json
planora-tokens.css
planora-tailwind-extension.md
planora-component-rules.md
```

## Regra principal para os cards

Não use imagem rasterizada como card inteiro.

Use o card como **componente CSS**, com:

- fundo neutro;
- textura paper grain via pseudo-elemento;
- borda fina;
- sombra;
- divisores arquitetônicos à direita;
- cor aplicada por variável CSS.

A cor do card deve entrar por:

```css
--pln-card-accent
```

Exemplo:

```tsx
<article className="pln-task-card pln-accent-execution">
  <span className="pln-card-divider-1" />
  <span className="pln-card-divider-2" />
  ...
</article>
```

Para cor dinâmica via Tailwind/React:

```tsx
<article
  className="pln-task-card"
  style={{ "--pln-card-accent": column.color } as React.CSSProperties}
>
  <span className="pln-card-divider-1" />
  <span className="pln-card-divider-2" />
</article>
```

## Cores centrais

```txt
App background:       #0E1110
Surface:              #121614
Panel:                #151915
Card:                 #181C19
Card hover:           #1B201C

Text primary:         #EEE5D6
Text secondary:       #AFA697
Text muted:           #8F887D

Border subtle:        rgba(232,221,200,0.10)
Border default:       rgba(232,221,200,0.14)

Burnt Sienna:         #A85C3A
Muted Gold:           #C4A35A
Stormy Sky:           #6F7F8C
Sage Green:           #6EA47A
Danger/High:          #D57964
Info/Low:             #6F9CB1
```

## Fases do Kanban

```txt
Planejamento: #6F7F8C   (Stormy Sky)
Execução:     #A85C3A   (Burnt Sienna)
Revisão:      #C4A35A   (Muted Gold)
Concluído:    #6EA47A   (Sage Green)
```

> Errata (2026-09-17): a primeira versão dava a Planejamento e a Revisão o
> mesmo dourado, e metade do quadro ficava indistinguível. As quatro fases
> agora têm cor própria, todas da paleta acima. Ver `10-decisoes-e-erratas.md`.

A cor da fase deve pintar apenas ícone da coluna, faixa direita do card, divisores internos do card e indicadores pontuais. Não deve pintar o card inteiro.

## Medidas principais

```txt
Sidebar esquerda:       238px
Sidebar direita:        338px
Padding do conteúdo:    40px horizontal / 28px vertical
Header mínimo:          116px
Filterbar:              72px
Coluna Kanban:          300px
Gap entre colunas:      12px
Task card min-height:   114px
Task card padding:      16px
Task card radius:       10px
Column radius:          12px
Panel radius:           14px
```

## Tipografia

Use duas famílias:

```txt
Display / títulos: Cormorant Garamond, Georgia, serif
UI / textos:       Inter, Manrope, system-ui, sans-serif
```

## Fundo do app

O fundo **não deve ter luzes laranjas ou azuis fortes**. Use apenas base `#0E1110`, textura granular sutil, vignette leve e um brilho branco quase imperceptível no topo.

## Prompt para o AG/Codex

```txt
Use os arquivos da Etapa 2 como fonte única de verdade visual.

Implemente o design do Planora usando:
- planora-design-tokens.json para decisões de valores;
- planora-tokens.css para variáveis e classes base;
- Tailwind apenas como utilitário auxiliar.

Não invente cores, sombras, bordas, raios ou espaçamentos fora dos tokens.
Não use imagens rasterizadas para cards completos.
O TaskCard deve ser CSS-driven, neutro por padrão, recebendo cor por --pln-card-accent.
O fundo do app não deve conter luzes coloridas fortes.
Preserve o visual dark matte, premium, editorial e orgânico.
```
