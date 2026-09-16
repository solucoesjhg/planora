# Planora UI Kit — Decisões e erratas

O kit das Etapas 2 e 3 continua sendo a fonte de verdade visual. Este arquivo
registra onde o produto se afastou dele de propósito, onde o próprio kit se
contradizia e qual lado venceu, e o que ainda falta construir. Sem este
registro, a próxima pessoa que ler o spec "conserta" de volta o que foi
decidido.

Última revisão: 2026-09-17.

## Desvios deliberados

### Tema claro

O kit é só escuro. O produto tem um tema claro, escolhido pela pessoa ou pelo
sistema, definido em `src/styles/tokens.css` como uma versão em osso quente da
mesma paleta: mesmos acentos, mesmas medidas, fundos e textos trocados de
ponta, nunca invertidos. Toda regra do kit que diz "escuro" vale para o tema
escuro; no claro vale o token equivalente.

### Cores das fases

O kit dava a Planejamento e a Revisão o mesmo dourado. Não era intenção, era
descuido. Desde 2026-09-16 cada fase tem uma cor da paleta:

| Fase | Escuro | Claro |
|---|---|---|
| Planejamento | Stormy Sky `#6F7F8C` | `#4E6070` |
| Execução | Burnt Sienna `#A85C3A` | `#8F4A2B` |
| Revisão | Muted Gold `#C4A35A` | `#8A6B1E` |
| Concluído | Sage Green `#6EA47A` | `#3B7550` |

`planora-tokens.css`, `planora-design-tokens.json` e a Etapa 2 foram
atualizados.

### Degradê no topo da coluna

O spec 02 dizia que a cor da fase não entra no corpo da coluna. Desde
2026-09-16 ela entra de uma forma só: um degradê contínuo, cor cheia na
aresta superior caindo até sumir na bandeja, com paradas em pixels. Sem faixa
sólida, sem linha de cabeçalho. O contraste do título fica acima de 10:1 nos
dois temas. O spec 02 foi atualizado.

### Ordem e nomes da barra lateral

O spec 03 lista Kanban, Projetos, Painel. O produto lista Painel, Projetos,
Quadro, porque o painel virou a primeira tela na Fase 8 e "Quadro" é a palavra
que o produto usa em toda a interface. "Assistente" fica sem o "IA" pelo
mesmo motivo. O resto do spec 03 vale: 58px por item, 15px, item ativo em
siena escuro, logo serifado em siena.

### Grão do papel

O kit desenha o grão com gradientes radiais. O produto usa turbulência SVG
num pseudo-elemento, pela mesma razão que o kit dá: textura procedural, sem
imagem embutida, atrás do conteúdo. A intensidade fica nos tokens
`--pln-sheet-grain-opacity` e `--pln-tray-grain-opacity`; trocar a textura
inteira é trocar `--pln-paper-grain`.

### "Nova tarefa" acima dos cards

O spec 02 põe o botão de adicionar dentro do cabeçalho da coluna. O produto
o põe logo abaixo do cabeçalho, com rótulo, fora da faixa que rola. Mesmo
efeito que o spec queria, o controle nunca se move, e o rótulo ajuda quem
chega pela primeira vez.

### Sem estrela de favorito

O spec 05 desenha uma estrela dourada ao lado do título. Não existe favorito
no produto ainda. Um controle que não faz nada é pior que nenhum; a estrela
entra quando a funcionalidade entrar.

### O quadro no celular: uma fase por vez

O kit não desenhou o celular. Em 2026-09-17, a partir de uma crítica
estruturada da tela em 390px e de três direções desenhadas lado a lado, a
escolhida foi a **A, abas de fase**: abaixo de 768px o quadro mostra uma
coluna de cada vez, ocupando a largura toda, com encaixe ao deslizar, e uma
linha de abas acima diz em que fase se está e troca de fase ao toque. A aba
é o cabeçalho da coluna: o menu da coluna e o "Nova coluna" moram na linha
das abas, e a coluna perde a bandeja, o degradê e o cabeçalho próprios. Uma
aba também recebe um card arrastado, que é como se muda de fase com uma
coluna só na tela.

Junto com a direção, o que a crítica apontou e vale para qualquer tela de
celular do produto:

- cabeçalho com três coisas: menu, título em uma linha, avatar. O sino e o
  tema ficam na gaveta;
- uma faixa de saúde tocável sob o título, com veredito e progresso ajustado,
  abrindo o painel como gaveta, no lugar do ícone que ninguém encontrava;
- barra inferior fixa com Painel, Projetos, Quadro e Mais;
- sem texto de ajuda; card com 40px de respiro à direita em vez de 56px;
  "Nova tarefa" com 44px de altura;
- arrastar por toque só com pressão longa de 250ms; deslizar rola.

As direções B (carrossel com indicador) e C (lista por fase) ficam
registradas no canvas de design da sessão de 2026-09-17, caso a A não se
prove com uso.

## Onde o kit se contradizia, e qual lado venceu

| Item | Tokens | Spec de componente | Vence |
|---|---|---|---|
| Raio do card | 10px | 12px | Tokens, 10px |
| Raio da coluna | 12px | 14px | Tokens, 12px |
| Opacidade da faixa do card | 0,75 | 0,85 | Spec, 0,85 |
| Opacidade das linhas do card | 0,60 e 0,25 | 0,55 e 0,22 | Spec, 0,55 e 0,22 |
| Texto secundário | `#AFA697` | `#D7CEC0` | Tokens |

A regra é: medida e cor vêm dos tokens; desenho de componente vem do spec.

## Ainda não construído

- **Abas do cabeçalho** (spec 05). Dependem de haver mais de uma vista por
  projeto. Entram com a funcionalidade.
- **Barra de filtros** (spec 05). Busca de 374px e filtros de 44 a 48px.
  Depende de busca e filtro no quadro. O token `--pln-filterbar-h` já existe.
- **Painel direito completo** (spec 04). O donut, as tarefas principais e a
  mini lista de projetos existem desde 2026-09-17. O painel também mostra
  veredito, tendência e dimensões, que o spec não previa e que ficam.
