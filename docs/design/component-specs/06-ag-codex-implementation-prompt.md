# Prompt de implementação para Antigravity/Codex

Use este prompt quando for pedir ao AG/Codex para implementar a Etapa 3.

---

Você está implementando a UI do Planora com base no UI Kit.

Antes de codar:
1. Leia `planora-design-tokens.json`.
2. Leia `planora-tokens.css`.
3. Leia todos os arquivos da pasta `planora_ui_kit_etapa_3_component_specs`.
4. Não tente copiar a tela inteira de uma vez.

Ordem obrigatória:
1. Criar os estilos globais dos tokens.
2. Criar `CardSurface` se necessário.
3. Criar `TaskCard` isolado.
4. Criar `KanbanColumn` isolado.
5. Criar `SidebarLeft`.
6. Criar `SidebarRight`.
7. Criar `TopHeader`.
8. Criar `FilterBar`.
9. Só então montar a página Kanban.

Regras visuais:
- O fundo do app deve ser dark matte, sem luzes coloridas fortes.
- O card deve ser neutro; a cor da coluna entra somente por `--pln-card-accent`.
- Não use imagem rasterizada como card inteiro.
- Não invente cores fora dos tokens.
- Não use glow neon.
- Não use glassmorphism exagerado.
- Não use bordas brancas fortes.
- Não use background colorido dentro dos cards.

Regras de código:
- Criar componentes pequenos.
- Não colocar regra de negócio nos componentes visuais.
- Aceitar props tipadas em TypeScript.
- Manter UI em Português do Brasil.
- Usar Lucide React para ícones.
- Usar Tailwind apenas se preservar exatamente os tokens.
- Para visual complexo, usar CSS customizado com classes `pln-*`.

Critério de aceite:
- `TaskCard` precisa parecer um cartão físico escuro fosco.
- `TaskCard` precisa ter textura paper grain discreta.
- `TaskCard` precisa ter duas linhas verticais finas internas e uma faixa direita colorida.
- `KanbanColumn` precisa ter scroll interno próprio.
- `SidebarLeft` precisa ter 238px.
- `SidebarRight` precisa ter 338px.
- Header precisa usar serif no título.
- A tela não pode ter luzes azuis/laranjas no background.
