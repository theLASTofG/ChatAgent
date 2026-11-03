# Relatório de Status — ProjetoIA (IA de Respostas, custo zero)

**Data:** 03/11/2026 · **Última alteração no código:** 30/10/2026

## 1. Resumo executivo
App de chat com IA (web + Android) que usa só APIs gratuitas. O backend está **funcional e testado**: os 20 testes de fumaça (`npm test`) passam. Há **dois bloqueios**: o projeto **não tem versionamento próprio** e **ainda não foi publicado em lugar nenhum**. Também falta o **ícone real** do PWA/APK, e o README está **desatualizado**.

## 2. Stack e arquitetura
- **Backend:** Node ≥18 + Express (`server.js`, ~820 linhas). Dependências: express, cors, dotenv.
- **Frontend:** PWA em JS puro (`public/`: `index.html`, `app.js` ~1070 linhas, `styles.css`, `sw.js`, `manifest.json`, `theme-boot.js`).
- **Deploy previsto:** `vercel.json` já está configurado (Vercel). O README cita o Render.com.
- **Android:** `capacitor.config.json` (`com.projetoia.respostas`). A pasta `android/` ainda não foi gerada.

## 3. Funcionalidades prontas
- **Vários provedores com fallback automático:** Groq → OpenRouter (só modelos `:free`) → Gemini. Aceita várias chaves por provedor, usadas em rodízio, e troca de chave ao receber 429.
- **Modelos:** gpt-oss-120b/20b e qwen3.8-27b (Groq); gemma-4 e nemotron-3 (OpenRouter); gemma-4-31b e gemini-3-flash-preview (Gemini).
- **Níveis de uso:** *standard* e *pro*. O *pro* dá prioridade ao Gemini, com janela de 120k e max_tokens 2500.
- **8 personas:** Assistente Geral, Dev Sênior, Professor, Resumidor, Tradutor e três de atendimento clínico (Notas SOAP/DAP, Briefing Pré-Sessão, Organizador de Caso e Metas), que seguem regras clínicas específicas.
- **Memória:** memória do caso (4k caracteres) e resumo contínuo (3k). Os dois são mantidos mesmo quando o histórico é cortado.
- **Endpoints:** `/api/status`, `/api/chat`, `/api/chat/stream` (SSE), `/api/summarize`, `/api/save-key`.
- **Idiomas:** PT e EN.
- **Modo Demo:** funciona sem chave nenhuma, com respostas simuladas.
- **Segurança:** limite de requisições por IP (429 com cabeçalhos X-RateLimit), CORS restrito via `ALLOWED_ORIGINS`, cabeçalhos nosniff, X-Frame-Options e Referrer-Policy, proteção contra injeção de cabeçalho pela chave, `save-key` aceito só a partir de localhost (a chave fica só em memória) e chaves que nunca aparecem no `/api/status`.

## 4. Problemas e riscos (por prioridade)
1. **🔴 Sem repositório Git próprio.** O Git em uso está na pasta do usuário (`C:/Users/famil`), sem nenhum commit, e o projeto aparece lá como "não rastreado". Não existe histórico nem backup.
   **Ação:** rodar `git init` dentro de `ProjetoIA`, fazer o primeiro commit e criar o repositório no GitHub. O `.gitignore` já exclui `.env` e `node_modules`.
2. **🔴 Nada publicado.** Não há deploy na Vercel nem no Render, então o caminho PWA no celular e o APK ainda não podem ser testados de verdade.
3. **🟠 As chaves reais estão no `.env` local** (Groq, OpenRouter e Gemini). Elas estão protegidas pelo `.gitignore`, mas precisam ser cadastradas como variáveis de ambiente no provedor de deploy. Se o `.env` já tiver sido compartilhado em algum momento, as chaves devem ser trocadas.
4. **🟠 Configuração de produção pendente:** `ALLOWED_ORIGINS` e `TRUST_PROXY` estão vazios. Sem eles, o limite por IP fica errado atrás da Vercel e o CORS fica aberto.
5. **🟡 Documentação desatualizada:** o README e o `manifest.json` ainda falam em Llama 3.3, Mixtral e só Groq. Não mencionam OpenRouter, Gemini, as personas clínicas, o nível *pro* nem o resumo.
6. **🟡 Ícone provisório:** o ícone é um SVG com o texto "IA" embutido no manifest. Para instalar como PWA e publicar o APK na Play Store, são necessários PNGs de 192 e 512 px.
7. **🟡 Personas clínicas:** lidam com dados sensíveis de pacientes. Falta definir uma política de privacidade e LGPD (o que é enviado a provedores externos e se existe aviso ao usuário).
8. **🟡 Limites dos testes:** só há smoke tests do backend. Não existem testes da interface nem testes com as APIs reais (os provedores são simulados nos testes).

## 5. Próximos passos sugeridos
1. Criar o repositório Git do projeto e enviar ao GitHub.
2. Fazer o deploy na Vercel com as variáveis de ambiente, incluindo `ALLOWED_ORIGINS` e `TRUST_PROXY=1`.
3. Testar no celular: instalar como PWA e validar o streaming e o fallback com chaves reais.
4. Atualizar o README e o manifest e criar os ícones PNG.
5. Gerar o APK: `npx cap add android`, depois `npx cap sync`, e configurar a URL do backend.
6. Definir o aviso de privacidade das personas clínicas.

## 6. Perguntas para a agente gerente
- Qual é a plataforma oficial de deploy: Vercel ou Render?
- O foco das personas clínicas (counseling) é o público principal do produto? Se for, a política de privacidade e LGPD passa a ser prioridade.
- Qual é a meta de distribuição: só PWA ou APK na Play Store?
- O frontend deve ganhar testes automatizados?
