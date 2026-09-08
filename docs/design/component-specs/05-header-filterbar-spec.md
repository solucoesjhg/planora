# Componentes: TopHeader e FilterBar

## TopHeader

### Objetivo

Área superior com nome do projeto, abas e ações principais. Deve parecer editorial, limpo e com hierarquia forte.

### Medidas

```txt
padding bottom: 16px
border-bottom: 1px
título: 40px
label "Projeto": 12px uppercase
gap entre abas: 36px
```

### Regras visuais

- Título usa fonte serifada.
- A estrela usa Muted Gold.
- Aba ativa usa texto claro e underline fino sienna.
- Ações do topo usam botões escuros com borda discreta.
- Não colocar fundo pesado atrás do header inteiro.

---

## FilterBar

### Objetivo

Faixa de busca e filtros abaixo do header. Deve ser funcional e discreta.

### Medidas

```txt
height dos inputs/botões: 44px a 48px
search width: 374px
gap: 12px
radius: 10px
```

### CSS recomendado

```css
.pln-search-box {
  height: 48px;
  width: 374px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  border-radius: 10px;
  border: 1px solid rgba(232,221,200,0.10);
  background: #121614;
  color: var(--pln-text-subtle);
  font-size: 14px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.025);
}

.pln-filter-button {
  height: 48px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border-radius: 10px;
  border: 1px solid rgba(232,221,200,0.10);
  background: rgba(255,255,255,0.025);
  color: var(--pln-text-secondary);
  font-size: 14px;
}
```

---

## Regras

- Search não deve ser grande demais.
- Botão Nova Coluna usa borda sienna e fundo sienna muito transparente.
- Filtros não devem parecer botões primários.
- Não usar sombras grandes nos filtros.
