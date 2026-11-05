# Klimbo — Copiloto Clínico & Assistente (custo zero)

**Klimbo** é um chat de IA para web e Android que usa **só APIs gratuitas** (Groq, OpenRouter e Google Gemini), com uma suíte clínica para psicólogos e counselors: notas SOAP/DAP, prontuário CFP, formulação 5Ps, memória contínua do caso e anonimização LGPD feita no próprio aparelho.

Sem banco de dados: conversas e memórias de caso ficam no `localStorage` do dispositivo. O servidor só repassa cada mensagem ao provedor de IA e guarda as chaves.

---

## Arquitetura

| Camada | O que faz |
|---|---|
| `server.js` (Node ≥ 18 + Express) | Personas, regras clínicas, cascata de provedores, orçamento de contexto por modelo, resumo de reambientação, rate limit e cabeçalhos de segurança |
| `public/` (PWA em JS puro) | Interface, streaming SSE, workspaces Clínica/Geral, memória do caso, ditado por voz, filtro de privacidade |
| `public/pii.js` | Regras de anonimização usadas no navegador e nos testes |
| `test-smoke.js` | Testes de fumaça sem gastar cota (provedores simulados) |

Dependências de produção: `express`, `cors` e `dotenv`. Nada mais.

### Provedores e cascata de fallback

A ordem é **Groq → OpenRouter (só modelos `:free`) → Gemini**. Cada variável de chave aceita várias chaves separadas por vírgula, usadas em rodízio. Se um modelo responde 429, 5xx ou timeout, o servidor tenta o próximo modelo ou a próxima chave antes do primeiro byte da resposta, então o usuário nunca vê duas respostas misturadas.

No compositor há um seletor de modelo: **Auto (Cascata Inteligente)** ou um modelo específico, agrupado por provedor.

### Janela de contexto e auto-compactação

Cada modelo tem seu orçamento:

- **Janela ampla** (120 mil caracteres, até 2.500 tokens de resposta): Gemini 3 Flash, Gemma 4 31B, GPT-OSS 120B e Nemotron 3 Ultra.
- **Janela padrão** (14 mil caracteres, até 1.500 tokens): os demais.

Se o modelo escolhido falhar e a cascata cair num modelo menor, o contexto é recortado de novo para a janela dele.

Quando a conversa passa de **75% da janela**, o app compacta sozinho: as mensagens antigas viram um **resumo de reambientação** (objetivo, fatos críticos, decisões e hipóteses, acordos, pendências e estado atual) e as **4 últimas mensagens seguem inteiras**. A tela continua mostrando a conversa completa, com um aviso no ponto do corte. O medidor `% ctx` no compositor mostra a ocupação estimada.

### Personas (10)

| Grupo | Personas |
|---|---|
| Geral | Assistente Geral, Dev Sênior, Professor, Resumidor, Tradutor |
| Clínica | Notas SOAP / DAP, Prontuário CFP (Res. 01/2009), Formulação 5Ps & Psicoeducação, Briefing Pré-Sessão, Organizador de Caso e Metas |

As personas clínicas seguem regras comuns: o julgamento clínico é do profissional, hipóteses ficam marcadas como tal, nada é inventado ("Não informado" quando falta dado) e qualquer indício de risco aparece no topo como **ATENÇÃO — RISCO**, destacado em vermelho na interface.

### Privacidade e segurança

- **Anonimização local (LGPD):** antes de sair do aparelho, o texto troca e-mails, telefones, CPF, RG, Cartão Nacional de Saúde (CNS), CEP e SSN por marcadores como `[CPF_OCULTO]`.
- **Nomes do caso:** em *Memória do caso → Termos/nomes a ocultar*, liste nomes reais (`João Silva, Maria`). Eles viram `[CLIENTE_OCULTO]`, ou o pseudônimo que você definir com `=` (`João Silva=M.`).
- **Prompt injection:** a memória do caso e o resumo vão dentro de `<memoria_caso>` e `<resumo_conversa>`, tratados pela IA só como dados.
- **Servidor:** rate limit por IP, CORS configurável, chaves nunca devolvidas ao cliente, cabeçalhos `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` e `Cross-Origin-Opener-Policy`, e CSP na página.

O filtro pega padrões óbvios. Nomes que não estejam na lista do caso e endereços continuam passando, então revise antes de enviar.

### Conta opcional (Google) e painel do admin

Sem login, o Klimbo funciona 100% local e offline. Para liberar **Entrar com Google**, rode `schema.sql` no SQL Editor do Supabase, ative o provedor Google em *Authentication → Providers* e defina `SUPABASE_URL` e `SUPABASE_ANON_KEY` (nunca a `service_role`) no `.env` ou na Vercel.

- **Contadores:** cada resposta soma conversas, documentações clínicas (SOAP, CFP, 5Ps) e tokens estimados em `usage_counters`. Nenhum conteúdo clínico sai do aparelho.
- **Painel do Klimbo:** o botão aparece na barra lateral só para contas com `role = 'admin'`. Ele mostra profissionais cadastrados, conversas, documentações clínicas e tokens processados, todos via `admin_usage_totals()`, que devolve só totais e recusa quem não é admin. Para promover a primeira conta, rode no Supabase: `update public.profiles set role = 'admin' where email = 'voce@exemplo.com';`
- **Falhas de login** (cancelamento no Google, rede, timeout, SDK bloqueado) viram um aviso em amarelo. O app não trava e os dados locais continuam intactos.

---

## Rodar no PC

```bash
npm install
```

```bash
npm start
```

Abra **http://localhost:3000**. Sem nenhuma chave o app roda em **Modo Demo** (respostas simuladas).

Para rodar os testes:

```bash
npm test
```

## Chaves gratuitas (sem cartão)

Copie `.env.example` para `.env` e preencha pelo menos uma:

- Groq: https://console.groq.com/keys → `GROQ_API_KEY`
- OpenRouter: https://openrouter.ai/keys → `OPENROUTER_API_KEY`
- Gemini: https://aistudio.google.com/apikey → `GEMINI_API_KEY`

Também dá para colar chaves em *Configurações → Chaves e modelo*. Nesse caso elas ficam salvas só naquele aparelho.

## Deploy na Vercel

O `vercel.json` já está configurado.

1. Importe o repositório na Vercel.
2. Em *Settings → Environment Variables*, cadastre as chaves e também:
   - `TRUST_PROXY=1`, para o rate limit ver o IP real do usuário;
   - `ALLOWED_ORIGINS=https://seu-app.vercel.app`, mais `https://localhost` se for usar o APK.
3. Faça o deploy. Cada push na branch principal publica uma versão nova.

Na Vercel o servidor roda como função serverless, então o contador do rate limit pode zerar entre execuções.

## Android

- **PWA:** abra a URL publicada no Chrome do celular → menu `⋮` → *Instalar aplicativo*.
- **APK (Capacitor):**

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
```

```bash
npx cap add android
```

```bash
npx cap sync
```

```bash
npx cap open android
```

No app, informe a URL do backend em *Configurações → Chaves e modelo → URL do backend*.
