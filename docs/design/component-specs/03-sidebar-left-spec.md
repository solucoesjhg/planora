# Componente: SidebarLeft

## Objetivo visual

Sidebar esquerda fixa, elegante e institucional. Ela deve parecer uma peça estrutural do produto, não um menu genérico.

---

## Medidas

```txt
largura: 238px
altura: 100vh
padding horizontal: 16px
padding vertical: 28px
border-right: 1px
item height: 58px
item radius: 12px
```

---

## Anatomia

```txt
SidebarLeft
├── logo / marca
├── nav principal
│   ├── Kanban
│   ├── Projetos
│   ├── Painel
│   ├── Arquivos
│   ├── Usuários
│   ├── Assistente IA
│   └── Configurações
└── usuário logado
```

---

## CSS recomendado

```css
.pln-sidebar-left {
  width: 238px;
  height: 100vh;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 28px 16px;
  border-right: 1px solid rgba(232, 221, 200, 0.10);
  background: rgba(12, 15, 14, 0.96);
}

.pln-sidebar-logo {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 48px;
  padding: 0 8px;
  font-family: var(--pln-font-serif);
  font-size: 31px;
  letter-spacing: -0.02em;
  color: var(--pln-accent-sienna);
}

.pln-sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pln-sidebar-item {
  height: 58px;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  border-radius: 12px;
  color: var(--pln-text-secondary);
  font-size: 15px;
  transition: background 180ms ease, color 180ms ease;
}

.pln-sidebar-item:hover {
  background: rgba(255,255,255,0.035);
  color: var(--pln-text-primary);
}

.pln-sidebar-item[data-active="true"] {
  background: linear-gradient(90deg, rgba(90,55,42,0.95), rgba(42,30,24,0.72));
  color: var(--pln-text-primary);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
}
```

---

## Regras

- O item ativo usa marrom/sienna bem escuro, não laranja vivo.
- Ícones devem ser lineares e finos.
- Não usar ícones preenchidos grandes.
- Não usar texto muito branco nos itens inativos.
- Logo deve usar serif e cor sienna.
