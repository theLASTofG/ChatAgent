---
name: ui-clinical-craft
description: Design system e diretrizes visuais de alto padrão para interfaces clínicas e workspaces de IA (inspirado em Claude.ai, Linear e Heidi Health). Use sempre que criar ou refatorar HTML, CSS e componentes visuais no ProjetoIA.
---

# UI Clinical Craft — Guia de Design Visual para o ProjetoIA

Esta skill define a linguagem visual do **ProjetoIA** para que a interface deixe de parecer um template genérico e tenha o acabamento de um produto SaaS clínico e de produtividade de primeira linha (referências: **Claude.ai**, **Heidi Health**, **Linear**).

## 1. Paleta de Cores e Superfícies (Fim do Cinza Chapado)

Nunca use cinza puro monótono (`#121212` / `#232323` sem matiz) ou branco hospitalar estéril (`#ffffff` chapado em tudo). Use superfícies com leve temperatura cromática e profundidade em camadas:

- **Tema Escuro (Obsidian Slate):**
  - `--bg`: `#0c0e12` (fundo principal profundo com leve toque ardósia)
  - `--sidebar`: `#080a0d` (barra lateral mais recolhida)
  - `--surface`: `#141820` (cards, composer, popovers)
  - `--surface-hover`: `#1c212b`
  - `--surface-elevated`: `#181d27`
  - `--bubble`: `#1b212d` (balão do usuário com borda sutil)
  - `--border`: `rgba(255, 255, 255, 0.07)`
  - `--border-strong`: `rgba(255, 255, 255, 0.14)`
  - `--shadow`: `0 12px 36px -4px rgba(0, 0, 0, 0.55), 0 2px 10px rgba(0, 0, 0, 0.35)`

- **Tema Claro (Warm Paper / Consultório Acolhedor):**
  - `--bg`: `#faf8f5` (papel creme quente, confortável para leitura longa entre sessões)
  - `--sidebar`: `#f2efe9`
  - `--surface`: `#ffffff`
  - `--surface-hover`: `#f5f2ec`
  - `--surface-elevated`: `#ffffff`
  - `--bubble`: `#efeae1`
  - `--border`: `rgba(15, 23, 42, 0.08)`
  - `--border-strong`: `rgba(15, 23, 42, 0.16)`
  - `--shadow`: `0 10px 30px -5px rgba(15, 23, 42, 0.07), 0 2px 8px rgba(15, 23, 42, 0.04)`

- **Cor de Destaque Clínica (`green` / Esmeralda Sálvia):**
  - Deve usar `#0d9488` (claro) / `#10b981` (escuro) com `--accent-soft: color-mix(in srgb, var(--accent) 12%, transparent)` para badges, chips ativos e anéis de foco.

## 2. Cabeçalho, Workspace Switcher e Hierarquia

1. **Topbar Translúcida:**
   - Use `background: color-mix(in srgb, var(--bg) 82%, transparent)` com `backdrop-filter: blur(12px)` e uma linha inferior sutil quando houver mensagens.
2. **Seletor de Modo (Clínica vs. Geral) na Sidebar:**
   - Um controle segmentado (`segmented-workspace`) no topo da barra lateral permitindo alternar entre **Clínica** e **Geral**.
   - Na lista da barra lateral, cada conversa deve exibir uma mini-tag ou indicador sutil quando possuir **Memória do Caso** preenchida.

## 3. Estado Vazio (Welcome Screen) com Grid de Cards 2x2

Em vez de botões de pílula simples sem hierarquia:
- Apresente um subtítulo contextual abaixo do `h1#welcomeTitle` (ex.: no modo Clínica: *"Prontuários SOAP/DAP, evolução CFP e memória contínua do caso com anonimização local"*).
- Transforme `.suggestions` em um **grid responsivo 2x2** (`grid-template-columns: repeat(2, minmax(0, 1fr))` no desktop, `1fr` no mobile) de **Cards de Ação (`.suggestion-card`)**:
  - Cada card contém um cabeçalho com badge da persona/ação, título em `font-weight: 600` e uma linha curta de descrição em `--text-2`.
  - Hover com elevação sutil (`transform: translateY(-2px)` e `border-color: var(--border-strong)`).

## 4. Composer de Nível Agente e Ditado Pós-Sessão

- O `.composer` deve ter borda refinada, sombra suave e anel de foco (`box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent)`).
- A barra inferior (`.composer-actions`) deve alinhar à esquerda o `.model-picker` e um **indicador compacto de contexto (`#contextMeter`)**, e à direita o botão de voz (`#micBtn` com timer `00:00` visível quando gravando) e o botão de envio (`#sendBtn`).

## 5. Estilização de Respostas Clínicas e Alertas

- Alertas iniciados por `ATENÇÃO — RISCO` ou `ATTENTION — RISK` devem receber destaque visual imediato (borda lateral e fundo suave âmbar/vermelho).
- Títulos de seções clínicas (`S — Subjective`, `O — Objective`, `A — Assessment`, `P — Plan`, `D — Data`) devem ter espaçamento limpo, tipografia clara e fácil escaneabilidade para revisão rápida entre consultas.
