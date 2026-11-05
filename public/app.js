'use strict';

// ===========================================================================
// Armazenamento local (try/catch: modo anônimo ou storage bloqueado)
// ===========================================================================
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* cota cheia */ }
  }
};

const PERSONA_INFO = {
  geral: 'Conversa do dia a dia, direta e útil',
  dev: 'Código correto, revisado e explicado',
  professor: 'Explica passo a passo, com exemplos',
  resumidor: 'Vai direto ao ponto, sem rodeios',
  tradutor: 'Traduz preservando tom e formatação',
  soap_notes: 'Notas de sessão viram SOAP ou DAP',
  pre_session: 'Preparo de 30 segundos antes da sessão',
  case_organizer: 'Metas, cronograma e evolução do caso',
  cfp_record: 'Evolução ética e objetiva (Res. CFP 01/2009)',
  case_formulation: '5Ps do caso e material para o paciente'
};
// Mini-tag da persona na lista de conversas
const PERSONA_TAG = {
  geral: 'Geral', dev: 'Dev', professor: 'Prof', resumidor: 'Resumo', tradutor: 'Trad',
  soap_notes: 'SOAP', pre_session: 'Brief', case_organizer: 'Caso', cfp_record: 'CFP', case_formulation: '5Ps'
};
const PERSONA_GROUPS = { geral: 'Geral', counseling: 'Counseling / Psicologia' };
const FALLBACK_PERSONAS = [
  { id: 'geral', name: 'Assistente Geral', group: 'geral' },
  { id: 'dev', name: 'Dev Sênior', group: 'geral' },
  { id: 'professor', name: 'Professor', group: 'geral' },
  { id: 'resumidor', name: 'Resumidor', group: 'geral' },
  { id: 'tradutor', name: 'Tradutor', group: 'geral' },
  { id: 'soap_notes', name: 'Notas SOAP / DAP', group: 'counseling' },
  { id: 'pre_session', name: 'Briefing Pré-Sessão', group: 'counseling' },
  { id: 'case_organizer', name: 'Organizador de Caso e Metas', group: 'counseling' },
  { id: 'cfp_record', name: 'Prontuário CFP (Res. 01/2009)', group: 'counseling' },
  { id: 'case_formulation', name: 'Formulação 5Ps & Psicoeducação', group: 'counseling' }
];
// Workspaces: cards da tela inicial. "fill" só preenche o campo (o profissional cola as notas)
const WORKSPACES = {
  counseling: {
    subtitle: 'Prontuários SOAP/DAP, evolução CFP e memória contínua do caso com anonimização local',
    defaultPersona: 'soap_notes',
    cards: [
      { persona: 'soap_notes', badge: 'SOAP / DAP', title: 'Notas SOAP / DAP pós-sessão', desc: 'Cole ou dite as anotações e receba o registro estruturado.', prompt: 'Transforme estas anotações da sessão em notas SOAP:\n\n', fill: true },
      { persona: 'cfp_record', badge: 'CFP 01/2009', title: 'Evolução de Prontuário CFP', desc: 'Registro ético e objetivo, só com o que consta no relato.', prompt: 'Registre a evolução desta sessão no prontuário (Res. CFP 01/2009):\n\n', fill: true },
      { persona: 'pre_session', badge: 'Briefing', title: 'Briefing de 30s pré-sessão', desc: 'Última sessão, pendências e focos de hoje, a partir da memória do caso.', prompt: 'Prepare o briefing para a sessão de hoje.' },
      { persona: 'case_formulation', badge: '5Ps', title: 'Formulação 5Ps & tarefa para o paciente', desc: 'Organiza o caso e gera um material acolhedor para enviar ao cliente.', prompt: 'Monte a formulação 5Ps e a tarefa para o paciente com base nestas notas:\n\n', fill: true }
    ]
  },
  geral: {
    subtitle: 'Modelos open-source gratuitos com troca automática de provedor',
    defaultPersona: 'geral',
    cards: [
      { persona: 'geral', badge: 'Geral', title: 'Explicar IA generativa', desc: 'Uma explicação simples, sem jargão.', prompt: 'Explique de forma simples como funciona a inteligência artificial generativa.' },
      { persona: 'dev', badge: 'Dev Sênior', title: 'Validar CPF em JavaScript', desc: 'Função revisada, com os riscos apontados.', prompt: 'Escreva uma função em JavaScript para validar e-mail e formatar CPF.' },
      { persona: 'professor', badge: 'Professor', title: 'Plano de estudos Android', desc: '4 semanas, do simples ao app publicado.', prompt: 'Monte um plano de estudos de 4 semanas para criar apps Android.' },
      { persona: 'resumidor', badge: 'Resumidor', title: 'Técnicas de foco', desc: 'Direto ao ponto, em até 5 itens.', prompt: 'Quais são as melhores técnicas de foco para estudar e programar?' }
    ]
  }
};
const LIMITS = { caseMemory: 4000, rollingSummary: 3000, redactTerms: 600 };
// Cauda quente: as últimas mensagens (2 pares usuário/IA) nunca são compactadas
const HOT_TAIL = 4;
const VOICE_LANG = { pt: 'pt-BR', en: 'en-US' };

const settings = Object.assign(
  {
    keys: { groq: '', openrouter: '', gemini: '' }, systemPrompt: '', backendUrl: '', model: '', sidebarClosed: false,
    lang: 'pt', pii: true, workspace: 'counseling', freshChatAfter: '30'
  },
  store.get('ia.settings', {})
);
delete settings.tier; // botão Pro antigo: o orçamento de contexto agora vem do modelo
settings.appearance = Object.assign({}, window.APPEARANCE_DEFAULTS, settings.appearance || {});

let threads = store.get('ia.threads', []);
let activeId = store.get('ia.active', null);
let personas = FALLBACK_PERSONAS;
let serverStatus = null;
let controller = null; // AbortController da geração em andamento
let busy = false;

const $ = (id) => document.getElementById(id);
const el = {
  layout: $('layout'), drawer: $('drawer'), backdrop: $('drawerBackdrop'),
  menuBtn: $('menuBtn'), collapseBtn: $('collapseBtn'), newChat: $('newChatBtn'), topNewChat: $('topNewChatBtn'),
  search: $('threadSearch'), threadList: $('threadList'),
  dot: $('apiStatusDot'), statusText: $('apiStatusText'), model: $('modelSelect'),
  personaBtn: $('personaBtn'), personaName: $('personaName'), personaBar: $('personaBar'),
  banner: $('missingKeyBanner'), bannerBtn: $('bannerConfigBtn'),
  chat: $('chatContainer'), list: $('messagesList'),
  form: $('chatForm'), input: $('userInput'), send: $('sendBtn'), mic: $('micBtn'),
  modal: $('settingsModal'), openSettings: $('openSettingsBtn'), closeSettings: $('closeSettingsBtn'),
  saveSettings: $('saveSettingsBtn'), feedback: $('settingsFeedback'),
  accountBox: $('accountBox'), loginBtn: $('loginBtn'), logoutBtn: $('logoutBtn'), accountProfile: $('accountProfile'),
  accountAvatar: $('accountAvatar'), accountName: $('accountName'), accountEmail: $('accountEmail'),
  adminBtn: $('adminBtn'), adminModal: $('adminModal'), closeAdmin: $('closeAdminBtn'), refreshAdmin: $('refreshAdminBtn'),
  adminFeedback: $('adminFeedback'), adminUpdated: $('adminUpdated'),
  exportBackupBtn: $('exportBackupBtn'), importBackupBtn: $('importBackupBtn'), importBackupInput: $('importBackupInput'), backupFeedback: $('backupFeedback'),
  groqKey: $('groqKeyInput'), orKey: $('openrouterKeyInput'), geminiKey: $('geminiKeyInput'),
  sysPrompt: $('systemPromptInput'), backendUrl: $('backendUrlInput'),
  fontSize: $('fontSizeInput'), fontSizeValue: $('fontSizeValue'), motion: $('motionInput'),
  langBtn: $('langBtn'), memoryBtn: $('memoryBtn'), memoryDot: $('memoryDot'),
  memoryPanel: $('memoryPanel'), caseMemory: $('caseMemoryInput'), rollingSummary: $('rollingSummaryInput'),
  caseMemoryCount: $('caseMemoryCount'), rollingSummaryCount: $('rollingSummaryCount'),
  summarizeBtn: $('summarizeBtn'), memoryHint: $('memoryHint'), pii: $('piiInput'), freshChat: $('freshChatSelect'), piiBadge: $('piiBadge'),
  redactTerms: $('redactTermsInput'), workspace: $('workspaceSwitch'), suggestions: $('suggestions'),
  welcomeSub: $('welcomeSubtitle'), meter: $('contextMeter'), meterFill: $('contextMeterFill'),
  meterText: $('contextMeterText'), micTimer: $('micTimer')
};

// Ícones de traço (constantes confiáveis, nunca vêm do usuário)
const ICON = {
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5L20 7"/></svg>',
  speak: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  regen: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>'
};

function apiUrl(path) {
  const base = /^https?:\/\//i.test(settings.backendUrl) ? settings.backendUrl.replace(/\/+$/, '') : '';
  return base + path;
}

function hasClientKey() {
  return Object.values(settings.keys).some((k) => k && k.trim());
}

function saveSettingsStore() {
  store.set('ia.settings', settings);
}

const isMobile = () => window.matchMedia('(max-width: 860px)').matches;

// ===========================================================================
// Filtro de privacidade: regras em pii.js (CPF, RG, CNS, CEP, e-mail, telefone)
// ===========================================================================
const { redactPII } = window.PII;

// Termos do caso (nomes reais) são trocados sempre que configurados;
// as regras de documentos/contatos seguem o interruptor de privacidade.
function privacy(text, thread) {
  const terms = thread?.redactTerms || '';
  if (settings.pii) return redactPII(text, terms);
  return terms ? window.PII.redactTerms(String(text || ''), terms) : text;
}

// ===========================================================================
// Markdown seguro: TUDO é escapado antes; só geramos tags conhecidas.
// ===========================================================================
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function renderInline(raw) {
  const slots = [];
  const hold = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = escapeHtml(raw.replace(/\u0000/g, ''));
  s = s.replace(/`([^`\n]+)`/g, (_, c) => hold(`<code>${c}</code>`));
  // [texto](https://...) — só http(s); o texto já está escapado
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s()]+)\)/g, (_, t, u) =>
    hold(`<a href="${u}" target="_blank" rel="noopener noreferrer nofollow">${t}</a>`));
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, (_, pre, u) =>
    pre + hold(`<a href="${u}" target="_blank" rel="noopener noreferrer nofollow">${u}</a>`));
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

// "ATENÇÃO — RISCO" / "ATTENTION — RISK" no começo de um bloco (com ou sem #, **, >)
const RISK_RE = /^[\s>#*_-]*(ATENÇÃO|ATTENTION)\s*[—–-]+\s*(RISCO|RISK)/i;

function renderMarkdown(src, nested = false) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l || '');

  while (i < lines.length) {
    const line = lines[i];

    if (!nested && RISK_RE.test(line)) {
      // O bloco vai até a próxima linha vazia; se o alerta for só um título, inclui o parágrafo seguinte
      const block = [];
      while (i < lines.length && lines[i].trim()) block.push(lines[i++]);
      if (block.length === 1) {
        while (i < lines.length && !lines[i].trim()) i++;
        while (i < lines.length && lines[i].trim()) block.push(lines[i++]);
      }
      out.push(`<div class="risk-callout" role="alert"><div class="risk-head">${ICON.alert}<span>Alerta clínico</span></div>` +
        `${renderMarkdown(block.join('\n'), true)}</div>`);
      continue;
    }

    const fence = line.match(/^\s*```\s*([\w#+.-]*)/);
    if (fence) {
      const lang = fence[1] || 'texto';
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++; // fecha (ou fim do stream ainda aberto)
      out.push(`<div class="code-block"><div class="code-head"><span>${escapeHtml(lang)}</span>` +
        `<button type="button" class="copy-code">${ICON.copy}<span>Copiar código</span></button></div>` +
        `<pre><code>${escapeHtml(code.join('\n'))}</code></pre></div>`);
      continue;
    }

    if (line.includes('|') && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      out.push('<div class="table-wrap"><table><thead><tr>' + head.map((h) => `<th>${renderInline(h)}</th>`).join('') +
        '</tr></thead><tbody>' + rows.map((r) => '<tr>' + r.map((c) => `<td>${renderInline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table></div>');
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length + 2}>${renderInline(h[2])}</h${h[1].length + 2}>`); i++; continue; }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    if (/^\s*>/.test(line)) {
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${q.map(renderInline).join('<br>')}</blockquote>`);
      continue;
    }

    const listRe = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
    if (listRe.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items = [];
      while (i < lines.length && listRe.test(lines[i])) items.push(lines[i++].match(listRe)[2]);
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => `<li>${renderInline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }

    if (!line.trim()) { i++; continue; }

    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,4}\s|>|[-*+]\s|\d+[.)]\s)/.test(lines[i]) &&
      !(lines[i].includes('|') && isTableSep(lines[i + 1]))) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    out.push(`<p>${para.map(renderInline).join('<br>')}</p>`);
  }
  return out.join('');
}

function stripMarkdown(md) {
  return String(md)
    .replace(/```[\s\S]*?```/g, ' (bloco de código) ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`#>|~]/g, '')
    .replace(/-{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ===========================================================================
// Aparência (tema, fonte, cor, tamanho, espaçamento, animações)
// ===========================================================================
function setAppearance(patch) {
  Object.assign(settings.appearance, patch);
  window.applyAppearance(settings.appearance);
  saveSettingsStore();
  syncAppearanceControls();
}

function syncAppearanceControls() {
  const a = settings.appearance;
  document.querySelectorAll('[data-setting]').forEach((group) => {
    const value = a[group.dataset.setting];
    group.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.value === value));
  });
  el.fontSize.value = a.fontSize;
  el.fontSizeValue.textContent = `${a.fontSize}px`;
  el.motion.checked = a.motion;
}

window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (settings.appearance.theme === 'system') window.applyAppearance(settings.appearance);
});

// ===========================================================================
// Conversas (threads)
// ===========================================================================
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function saveThreads() {
  // Não persiste estado transitório de geração
  store.set('ia.threads', threads.map((t) => ({ ...t, messages: t.messages.map(({ pending, ...m }) => m) })));
  store.set('ia.active', activeId);
}

function activeThread() { return threads.find((t) => t.id === activeId); }

function createThread(persona) {
  const t = {
    id: uid(), title: 'Nova conversa', messages: [], updatedAt: Date.now(),
    persona: persona || activeThread()?.persona || WORKSPACES[currentWorkspace()].defaultPersona,
    caseMemory: '', rollingSummary: '', redactTerms: '', summarizedUpTo: 0, compactedAt: 0, needsSummary: false
  };
  threads.unshift(t);
  activeId = t.id;
  saveThreads();
  return t;
}

function ensureThread() {
  return activeThread() || createThread();
}

// Conversas vazias (sem mensagens nem memória) não ficam acumulando no histórico
function dropEmptyThreads() {
  threads = threads.filter((t) => t.messages.length || t.caseMemory || t.rollingSummary || t.redactTerms || t.id === activeId);
}

function makeTitle(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean || 'Nova conversa';
}

function newChat() {
  stopGeneration();
  const current = activeThread();
  if (!current || current.messages.length) createThread(current?.persona);
  dropEmptyThreads();
  saveThreads();
  renderAll();
  closeDrawer();
  el.input.focus();
}

function switchThread(id) {
  if (id !== activeId) {
    stopGeneration();
    activeId = id;
    dropEmptyThreads();
    saveThreads();
    renderAll();
  }
  closeDrawer();
}

function deleteThread(id) {
  const t = threads.find((x) => x.id === id);
  if (!t || !confirm(`Apagar a conversa "${t.title}"?`)) return;
  if (id === activeId) stopGeneration();
  threads = threads.filter((x) => x.id !== id);
  if (id === activeId) activeId = threads[0]?.id || null;
  saveThreads();
  renderAll();
}

function exportThread(id) {
  const t = threads.find((x) => x.id === id);
  if (!t || !t.messages.length) return toast('Nada para exportar');
  const persona = personas.find((p) => p.id === t.persona);
  const memory = [];
  if (t.caseMemory) memory.push('## Memória fixa do caso', '', t.caseMemory, '');
  if (t.rollingSummary) memory.push('## Resumo de longo prazo', '', t.rollingSummary, '');
  const md = [`# ${t.title}`, '', `_Persona: ${persona ? persona.name : t.persona} · Exportado em ${new Date().toLocaleString('pt-BR')}_`, '']
    .concat(memory)
    .concat(t.messages.map((m) => `## ${m.role === 'user' ? 'Você' : 'IA'}\n\n${m.content}\n`))
    .join('\n');
  downloadFile(`${t.title.replace(/[^\wÀ-ſ -]+/g, '').trim().slice(0, 40) || 'conversa'}.md`, md, 'text/markdown;charset=utf-8');
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------------------
// Exportação clínica (SOAP, CFP, 5Ps): texto limpo para o prontuário oficial
// ---------------------------------------------------------------------------
const CLINICAL_EXPORT = new Set(['soap_notes', 'cfp_record', 'case_formulation']);

// Pseudônimo do caso: alias de "Termos a ocultar" (Nome=M.) ou 1º nome entre aspas na memória
function casePseudonym(t) {
  const terms = window.PII?.parseTerms ? window.PII.parseTerms(t.redactTerms || '') : [];
  const alias = terms.map((x) => x.alias).find((a) => a && !/^\[.*\]$/.test(a));
  if (alias) return alias;
  const quoted = String(t.caseMemory || '').match(/["“]([^"”]{1,30})["”]/);
  return quoted ? quoted[1].trim() : 'Caso sem pseudônimo';
}

// Remove marcadores de markdown e frases de cortesia da IA, preservando a estrutura de linhas
function clinicalPlainText(md) {
  const lines = String(md).replace(/\r/g, '').replace(/```[a-z]*\n?/gi, '').split('\n').map((l) => l
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/^(\s*)[*+]\s+/, '$1- ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/, '')
    .replace(/\s+$/, ''));
  const intro = /^(claro|certo|perfeito|ótimo|aqui está|aqui estão|segue|seguem|com certeza)\b.*[:!.]$/i;
  const outro = /^(espero (ter ajudado|que)|se precisar|posso ajudar|quer que eu|deseja que eu)/i;
  while (lines.length && (!lines[0].trim() || intro.test(lines[0].trim()))) lines.shift();
  while (lines.length && (!lines[lines.length - 1].trim() || outro.test(lines[lines.length - 1].trim()))) lines.pop();
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function clinicalRecord(t, msg, format) {
  const persona = personas.find((p) => p.id === t.persona);
  const model = persona ? persona.name : t.persona;
  const when = new Date(t.updatedAt || Date.now());
  const stamp = when.toLocaleString('pt-BR');
  const pseudo = casePseudonym(t);
  const note = 'Rascunho gerado com apoio de IA. Revisar antes de incluir no prontuário.';
  const lines = format === 'md'
    ? [`# Registro clínico — ${pseudo}`, '', `- **Caso:** ${pseudo}`, `- **Modelo de registro:** ${model}`, `- **Data/hora:** ${stamp}`, '', '---', '', msg.content.trim(), '', '---', `_${note}_`]
    : [`REGISTRO CLÍNICO — ${pseudo}`, `Modelo de registro: ${model}`, `Data/hora: ${stamp}`, '', clinicalPlainText(msg.content), '', note];
  const pad = (n) => String(n).padStart(2, '0');
  const fileStamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}_${pad(when.getHours())}${pad(when.getMinutes())}`;
  const slug = pseudo.replace(/[^\wÀ-ſ-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'caso';
  return { name: `registro_${slug}_${fileStamp}.${format}`, content: lines.join('\n') + '\n' };
}

function exportBar() {
  const bar = document.createElement('div');
  bar.className = 'export-bar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Exportar registro clínico');
  const mk = (action, icon, label, title) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'export-btn';
    b.dataset.action = action;
    b.title = title;
    b.innerHTML = `${ICON[icon]}<span>${label}</span>`;
    return b;
  };
  bar.append(
    mk('clin-copy', 'copy', 'Copiar formatado', 'Copiar texto limpo para o prontuário eletrônico'),
    mk('clin-txt', 'download', '.txt', 'Baixar registro em texto'),
    mk('clin-md', 'download', '.md', 'Baixar registro em Markdown')
  );
  return bar;
}

// ---------------------------------------------------------------------------
// Backup e restauração (JSON local)
// ---------------------------------------------------------------------------
const BRAND_TITLE = 'Klimbo — Copiloto Clínico & Assistente';
const BACKUP_KIND = 'klimbo-backup';
const BACKUP_KINDS = new Set([BACKUP_KIND, 'ia-respostas-backup']); // aceita backups de antes do rebranding

function exportBackup() {
  saveThreads();
  const data = { kind: BACKUP_KIND, version: 1, exportedAt: new Date().toISOString(), threads: store.get('ia.threads', []), active: activeId };
  if (!data.threads.length) return setBackupFeedback('Nada para exportar ainda');
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  downloadFile(`ia-backup_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`, JSON.stringify(data, null, 2), 'application/json');
  setBackupFeedback(`${data.threads.length} conversa(s) exportada(s). Chaves de API não são incluídas.`);
}

function validThread(t) {
  return t && typeof t.id === 'string' && Array.isArray(t.messages) &&
    t.messages.every((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
}

async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return setBackupFeedback('Arquivo inválido: não é um JSON'); }
  if (!data || !BACKUP_KINDS.has(data.kind) || !Array.isArray(data.threads)) return setBackupFeedback('Arquivo não é um backup do Klimbo');
  const incoming = data.threads.filter(validThread);
  const byId = new Map(threads.map((t) => [t.id, t]));
  let added = 0, updated = 0;
  for (const raw of incoming) {
    const t = {
      title: 'Conversa importada', caseMemory: '', rollingSummary: '', redactTerms: '', summarizedUpTo: 0, compactedAt: 0, needsSummary: false,
      ...raw, title: String(raw.title || 'Conversa importada'), updatedAt: Number(raw.updatedAt) || Date.now(),
      messages: raw.messages.map(({ pending, ...m }) => m)
    };
    const cur = byId.get(t.id);
    if (!cur) { threads.push(t); byId.set(t.id, t); added++; }
    else if (t.updatedAt > (cur.updatedAt || 0)) { Object.assign(cur, t); updated++; }
  }
  threads.sort((a, b) => b.updatedAt - a.updatedAt);
  saveThreads();
  renderAll();
  setBackupFeedback(`Restaurado: ${added} nova(s), ${updated} atualizada(s)` + (incoming.length < data.threads.length ? `, ${data.threads.length - incoming.length} ignorada(s)` : ''));
}

function setBackupFeedback(text) { el.backupFeedback.textContent = text; }

// ===========================================================================
// Renderização
// ===========================================================================
function iconButton(icon, action, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-btn';
  b.innerHTML = ICON[icon];
  b.title = label;
  b.setAttribute('aria-label', label);
  if (action) b.dataset.action = action;
  return b;
}

// Texto pesquisável: título, persona (id, nome e tag), memória do caso, termos/pseudônimos, resumo e mensagens
function threadHaystack(t) {
  const p = personas.find((x) => x.id === t.persona);
  return [t.title, t.persona, p?.name, PERSONA_TAG[t.persona], t.caseMemory, t.redactTerms, t.rollingSummary, ...t.messages.map((m) => m.content)]
    .filter(Boolean).join('\n').toLowerCase();
}

function renderThreadList() {
  const q = el.search.value.trim().toLowerCase();
  el.threadList.textContent = '';
  const items = threads
    .filter((t) => t.messages.length || t.caseMemory || t.rollingSummary)
    .filter((t) => !q || threadHaystack(t).includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'thread-empty';
    li.textContent = q ? 'Nada encontrado' : 'Suas conversas aparecem aqui';
    el.threadList.appendChild(li);
    return;
  }
  for (const t of items) {
    const li = document.createElement('li');
    li.className = 'thread-item' + (t.id === activeId ? ' active' : '');
    const open = document.createElement('button');
    open.className = 'thread-open';
    const tag = PERSONA_TAG[t.persona];
    if (tag) {
      const chip = document.createElement('span');
      const group = personas.find((p) => p.id === t.persona)?.group;
      chip.className = 'thread-tag' + (group === 'counseling' ? ' clinical' : '');
      chip.textContent = tag;
      open.appendChild(chip);
    }
    const title = document.createElement('span');
    title.className = 'thread-title';
    title.textContent = t.title;
    open.appendChild(title);
    if (t.caseMemory) {
      const mem = document.createElement('span');
      mem.className = 'thread-mem';
      mem.title = 'Memória do caso ativa';
      open.appendChild(mem);
    }
    open.title = t.caseMemory ? `${t.title} · memória do caso ativa` : t.title;
    open.addEventListener('click', () => switchThread(t.id));
    const exp = iconButton('download', null, 'Exportar .md');
    exp.classList.add('thread-more');
    exp.addEventListener('click', () => exportThread(t.id));
    const del = iconButton('trash', null, 'Apagar conversa');
    del.classList.add('thread-more');
    del.addEventListener('click', () => deleteThread(t.id));
    li.append(open, exp, del);
    el.threadList.appendChild(li);
  }
}

function currentPersonaId() {
  return activeThread()?.persona || 'geral';
}

function renderPersonas() {
  const current = currentPersonaId();
  const p = personas.find((x) => x.id === current) || personas[0];
  el.personaName.textContent = p.name;
  el.personaBar.textContent = '';
  let lastGroup = null;
  for (const item of personas) {
    const group = item.group || 'geral';
    if (group !== lastGroup) {
      const header = document.createElement('div');
      header.className = 'popover-group';
      header.textContent = PERSONA_GROUPS[group] || group;
      el.personaBar.appendChild(header);
      lastGroup = group;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'persona-option' + (item.id === current ? ' active' : '');
    b.setAttribute('role', 'option');
    const text = document.createElement('span');
    text.className = 'po-text';
    const strong = document.createElement('strong');
    strong.textContent = item.name;
    const small = document.createElement('small');
    small.textContent = PERSONA_INFO[item.id] || '';
    text.append(strong, small);
    const check = document.createElement('span');
    check.className = 'po-check';
    check.innerHTML = ICON.check;
    b.append(text, check);
    b.addEventListener('click', () => { setPersona(item.id); togglePersonaMenu(false); });
    el.personaBar.appendChild(b);
  }
}

function togglePersonaMenu(force) {
  const open = force ?? el.personaBar.hidden;
  el.personaBar.hidden = !open;
  el.personaBtn.setAttribute('aria-expanded', String(open));
}

function setPersona(id) {
  const t = activeThread();
  if (t && t.messages.length && t.persona !== id) {
    // Persona nova em conversa já iniciada => começa outra conversa (contexto limpo)
    stopGeneration();
    createThread(id);
  } else {
    ensureThread().persona = id;
    saveThreads();
  }
  renderAll();
}

function metaLabel(m) {
  const meta = m.meta || {};
  const parts = [];
  if (meta.providerUsed === 'demo') parts.push('modo demo');
  else if (meta.modelUsed) parts.push(meta.modelUsed);
  if (meta.fallbackTriggered) parts.push('fallback');
  if (meta.trimmedCount) parts.push(`${meta.trimmedCount} msgs fora da janela`);
  if (meta.durationMs) parts.push(`${(meta.durationMs / 1000).toFixed(1)}s`);
  if (meta.stopped) parts.push('interrompida');
  return parts.join(' · ');
}

function messageNode(m, index, isLast) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${m.role}` + (m.meta?.error ? ' error' : '') + (isLast ? ' last' : '');
  wrap.dataset.index = index;

  const body = document.createElement('div');
  body.className = 'md';
  if (m.role === 'user') body.textContent = m.content;
  else if (m.content) body.innerHTML = renderMarkdown(m.content);
  else body.innerHTML = '<span class="thinking"><i></i><i></i><i></i></span>';
  wrap.appendChild(body);

  if (!m.pending) {
    const bar = document.createElement('div');
    bar.className = 'msg-actions';
    bar.appendChild(iconButton('copy', 'copy', 'Copiar'));
    if (m.role === 'assistant') {
      bar.appendChild(iconButton('speak', 'speak', 'Ouvir'));
      if (isLast) bar.appendChild(iconButton('regen', 'regen', 'Regenerar'));
      const meta = document.createElement('span');
      meta.className = 'msg-meta';
      meta.textContent = metaLabel(m);
      bar.appendChild(meta);
    }
    if (m.role === 'assistant' && m.content && !m.meta?.error && CLINICAL_EXPORT.has(activeThread()?.persona)) wrap.appendChild(exportBar());
    wrap.appendChild(bar);
  }
  return wrap;
}

function renderMessages() {
  const t = activeThread();
  const msgs = t ? t.messages : [];
  el.list.textContent = '';
  el.layout.classList.toggle('is-empty', msgs.length === 0);
  msgs.forEach((m, i) => {
    // O histórico visual fica inteiro; só marca onde o contexto foi compactado
    if (i && i === t.compactedAt) {
      const note = document.createElement('div');
      note.className = 'compact-note';
      note.textContent = 'Contexto compactado e reambientado automaticamente';
      el.list.appendChild(note);
    }
    el.list.appendChild(messageNode(m, i, i === msgs.length - 1));
  });
  scrollToBottom(true);
}

function renderAll() {
  const t = activeThread();
  document.title = t && t.messages.length ? `${t.title} · Klimbo` : BRAND_TITLE;
  renderPersonas();
  renderWorkspace();
  renderThreadList();
  renderMessages();
  renderMemory();
  updateContextMeter();
}

// ===========================================================================
// Workspace (Clínica | Geral): subtítulo e cards da tela inicial
// ===========================================================================
function currentWorkspace() {
  return WORKSPACES[settings.workspace] ? settings.workspace : 'counseling';
}

function renderWorkspace() {
  const ws = currentWorkspace();
  el.workspace.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.workspace === ws;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  });
  el.welcomeSub.textContent = WORKSPACES[ws].subtitle;
  el.suggestions.textContent = '';
  for (const card of WORKSPACES[ws].cards) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'suggestion-card';
    const badge = document.createElement('span');
    badge.className = 'sc-badge';
    badge.textContent = card.badge;
    const title = document.createElement('strong');
    title.className = 'sc-title';
    title.textContent = card.title;
    const desc = document.createElement('span');
    desc.className = 'sc-desc';
    desc.textContent = card.desc;
    b.append(badge, title, desc);
    b.addEventListener('click', () => useCard(card));
    el.suggestions.appendChild(b);
  }
}

function useCard(card) {
  setPersona(card.persona);
  if (!card.fill) return sendMessage(card.prompt);
  el.input.value = card.prompt;
  autoGrow();
  el.input.focus();
  el.input.setSelectionRange(el.input.value.length, el.input.value.length);
}

function setWorkspace(ws) {
  if (!WORKSPACES[ws] || ws === settings.workspace) return;
  settings.workspace = ws;
  saveSettingsStore();
  alignEmptyThread();
  renderAll();
}

// Conversa ainda vazia assume a persona padrão do workspace, se for de outro grupo
// ---------------------------------------------------------------------------
// Conversa nova ao voltar: depois de um tempo sem uso o app abre vazio (como o
// ChatGPT/Claude), mas um recarregar rápido ou trocar de aba não perde o fio.
// ---------------------------------------------------------------------------
function freshChatAfterMs() {
  const v = settings.freshChatAfter ?? '30';
  return v === 'never' ? Infinity : Math.max(0, Number(v) || 0) * 60000;
}

function markSeen() { store.set('ia.lastSeen', Date.now()); }

// onResume: app voltou do segundo plano (aba/PWA). "Sempre" vale só para abertura.
function maybeStartFresh({ onResume = false } = {}) {
  const ttl = freshChatAfterMs();
  if (ttl === Infinity || (onResume && ttl === 0)) return false;
  const t = activeThread();
  if (!t || !t.messages.length || busy || el.input.value.trim()) return false;
  const last = Math.max(t.updatedAt || 0, store.get('ia.lastSeen', 0));
  if (ttl && Date.now() - last < ttl) return false;
  createThread(t.persona);
  dropEmptyThreads();
  saveThreads();
  return true;
}

function alignEmptyThread() {
  const t = activeThread();
  if (t && t.messages.length) return;
  const ws = currentWorkspace();
  const group = (id) => FALLBACK_PERSONAS.find((p) => p.id === id)?.group;
  if (t && group(t.persona) === ws) return;
  ensureThread().persona = WORKSPACES[ws].defaultPersona;
  saveThreads();
}

// ===========================================================================
// Medidor da janela de contexto (estimativa local, em caracteres)
// ===========================================================================
const SYSTEM_OVERHEAD_CHARS = 1200; // regras da persona e de estilo enviadas pelo servidor
const MAX_MESSAGE_CHARS = 8000; // o servidor corta cada mensagem neste tamanho

function contextBudget() {
  const id = settings.model || serverStatus?.defaultModel;
  return serverStatus?.models?.find((m) => m.id === id)?.maxContextChars || serverStatus?.maxContextChars || 14000;
}

function updateContextMeter() {
  const t = activeThread();
  if (t && compacting.has(t.id)) {
    el.meter.className = 'context-meter busy';
    el.meterText.textContent = 'Compactando...';
    return;
  }
  let chars = el.input.value.length;
  if (t && (t.messages.length || t.caseMemory || t.rollingSummary)) {
    chars += SYSTEM_OVERHEAD_CHARS + (t.caseMemory || '').length + (t.rollingSummary || '').length;
    const start = Math.min(t.summarizedUpTo || 0, Math.max(0, t.messages.length - HOT_TAIL));
    for (const m of t.messages.slice(start)) chars += Math.min((m.content || '').length, MAX_MESSAGE_CHARS);
  }
  const budget = contextBudget();
  const pct = Math.min(100, Math.round((chars / budget) * 100));
  el.meter.className = 'context-meter' + (pct > 60 ? ' warn' : '');
  el.meterFill.style.width = `${pct}%`;
  el.meterText.textContent = `${pct}% ctx`;
  el.meter.title = `Janela de contexto: ~${chars.toLocaleString('pt-BR')} de ${budget.toLocaleString('pt-BR')} caracteres. Acima de 75% a conversa é compactada sozinha.`;
}

// ===========================================================================
// Memória do caso (camada 1: ficha fixa · camada 2: resumo de longo prazo)
// ===========================================================================
function renderMemory() {
  const t = activeThread();
  el.caseMemory.value = t?.caseMemory || '';
  el.rollingSummary.value = t?.rollingSummary || '';
  el.redactTerms.value = t?.redactTerms || '';
  updateMemoryCounts();
  const pending = Boolean(t?.needsSummary);
  el.memoryDot.hidden = !pending;
  el.memoryHint.textContent = pending
    ? 'A compactação automática falhou. Tente compactar manualmente.'
    : t?.summarizedUpTo ? `Resumo cobre ${t.summarizedUpTo} mensagens; as mais recentes seguem inteiras.` : '';
}

function updateMemoryCounts() {
  el.caseMemoryCount.textContent = `${el.caseMemory.value.length}/${LIMITS.caseMemory}`;
  el.rollingSummaryCount.textContent = `${el.rollingSummary.value.length}/${LIMITS.rollingSummary}`;
}

function toggleMemoryPanel(force) {
  const open = force ?? el.memoryPanel.hidden;
  el.memoryPanel.hidden = !open;
  el.memoryBtn.setAttribute('aria-expanded', String(open));
  if (open) renderMemory();
}

let memorySaveTimer = null;
function onMemoryInput(field) {
  const t = ensureThread();
  const input = { caseMemory: el.caseMemory, rollingSummary: el.rollingSummary, redactTerms: el.redactTerms }[field];
  t[field] = input.value.slice(0, LIMITS[field]);
  t.updatedAt = Date.now();
  updateMemoryCounts();
  updateContextMeter();
  clearTimeout(memorySaveTimer);
  memorySaveTimer = setTimeout(() => { saveThreads(); renderThreadList(); }, 400);
}

// ===========================================================================
// Auto-compactação e reambientação do contexto (estilo OpenCode / Letta)
// Mensagens antigas viram resumo de handoff; a cauda quente segue inteira.
// ===========================================================================
const compacting = new Set(); // ids de conversas sendo compactadas

async function compactThread(thread, { manual = false } = {}) {
  if (!thread || compacting.has(thread.id)) return;
  const cut = Math.max(0, thread.messages.length - HOT_TAIL);
  const from = Math.min(thread.summarizedUpTo || 0, cut);
  const chunk = thread.messages.slice(from, cut).filter((m) => !m.pending && !m.meta?.error && m.content);
  if (!chunk.length) {
    if (manual) toast(`Nada para compactar: as ${HOT_TAIL} últimas mensagens ficam sempre na janela`);
    return;
  }
  compacting.add(thread.id);
  if (thread.id === activeId) updateContextMeter();
  if (manual) el.summarizeBtn.classList.add('loading');
  try {
    const res = await fetch(apiUrl('/api/summarize'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        previousSummary: privacy(thread.rollingSummary || '', thread),
        messages: chunk.map((m) => ({ role: m.role, content: privacy(m.content, thread) })),
        lang: settings.lang,
        apiKeys: clientKeys()
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.summary) throw new Error(data.error || `Erro HTTP ${res.status}`);
    // Grava na conversa que pediu o resumo, mesmo se o usuário já trocou de conversa
    thread.rollingSummary = data.summary.slice(0, LIMITS.rollingSummary);
    thread.summarizedUpTo = cut;
    thread.compactedAt = cut;
    thread.needsSummary = false;
    thread.updatedAt = Date.now();
    saveThreads();
    if (thread.id === activeId) { renderMessages(); renderMemory(); }
    if (manual) toast('Contexto compactado');
  } catch (err) {
    thread.needsSummary = true;
    saveThreads();
    if (thread.id === activeId) renderMemory();
    toast(manual ? err.message || 'Não foi possível compactar agora' : 'Compactação automática falhou; tente na Memória do caso');
  } finally {
    compacting.delete(thread.id);
    if (thread.id === activeId) updateContextMeter();
    if (manual) el.summarizeBtn.classList.remove('loading');
  }
}

// ===========================================================================
// Idioma e privacidade
// ===========================================================================
function renderModeControls() {
  el.langBtn.textContent = settings.lang === 'en' ? 'EN' : 'PT';
  el.langBtn.title = settings.lang === 'en' ? 'Respostas e voz em inglês (clique para português)' : 'Respostas e voz em português (clique para inglês)';
  el.input.placeholder = settings.lang === 'en' ? 'Ask anything' : 'Pergunte alguma coisa';
  el.piiBadge.hidden = !settings.pii;
}

function toggleLang() {
  settings.lang = settings.lang === 'en' ? 'pt' : 'en';
  saveSettingsStore();
  renderModeControls();
  toast(settings.lang === 'en' ? 'Responses and voice in English' : 'Respostas e voz em português');
}

// Coloca o cursor pulsante no fim do último bloco de texto
function appendCaret(body) {
  let target = body.lastElementChild || body;
  while (target && /^(UL|OL|BLOCKQUOTE)$/.test(target.tagName) && target.lastElementChild) target = target.lastElementChild;
  if (!target || /^(DIV|PRE|TABLE|HR)$/.test(target.tagName)) target = body;
  const caret = document.createElement('span');
  caret.className = 'caret';
  target.appendChild(caret);
}

let renderQueued = false;
function scheduleStreamRender(threadId, msg) {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    // Usuário trocou de conversa, ou a resposta já terminou (render final já feito)
    if (threadId !== activeId || !msg.pending) return;
    const node = el.list.lastElementChild;
    if (!node) return;
    const body = node.querySelector('.md');
    body.innerHTML = renderMarkdown(msg.content);
    appendCaret(body);
    scrollToBottom();
  });
}

function scrollToBottom(force) {
  const c = el.chat;
  const nearBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 160;
  if (force || nearBottom) c.scrollTop = c.scrollHeight;
}

// tone: 'info' (padrão, some em 2 s) ou 'warn' (paleta de aviso, fica mais tempo e é lido por leitores de tela)
function toast(text, { tone = 'info', duration } = {}) {
  document.querySelectorAll('.toast').forEach((n) => n.remove());
  const n = document.createElement('div');
  n.className = tone === 'warn' ? 'toast toast-warn' : 'toast';
  n.setAttribute('role', tone === 'warn' ? 'alert' : 'status');
  if (tone === 'warn') {
    n.insertAdjacentHTML('afterbegin', ICON.alert);
    const span = document.createElement('span');
    span.textContent = text;
    n.appendChild(span);
    n.addEventListener('click', () => n.remove());
  } else {
    n.textContent = text;
  }
  document.body.appendChild(n);
  setTimeout(() => n.remove(), duration ?? (tone === 'warn' ? 6000 : 2000));
}


// ===========================================================================
// Envio + Streaming SSE
// ===========================================================================
function setBusy(v) {
  busy = v;
  el.send.classList.toggle('busy', v);
  el.send.title = v ? 'Parar geração' : 'Enviar';
  el.send.setAttribute('aria-label', el.send.title);
  updateSendState();
}

function updateSendState() {
  el.send.classList.toggle('empty', !busy && !el.input.value.trim());
}

function stopGeneration() {
  if (controller) controller.abort();
}

function clientKeys() {
  const keys = {};
  for (const [k, v] of Object.entries(settings.keys)) if (v && v.trim()) keys[k] = v.trim();
  return keys;
}

// Tudo que sai do aparelho passa pelo filtro de privacidade (se ativo)
function buildPayload(thread, message, history) {
  return {
    message: privacy(message, thread),
    history: history.filter((m) => !m.meta?.error && m.content).map((m) => ({ role: m.role, content: privacy(m.content, thread) })),
    persona: thread.persona,
    model: settings.model || undefined,
    systemPrompt: settings.systemPrompt ? privacy(settings.systemPrompt, thread) : undefined,
    lang: settings.lang,
    caseMemory: thread.caseMemory ? privacy(thread.caseMemory, thread) : undefined,
    rollingSummary: thread.rollingSummary ? privacy(thread.rollingSummary, thread) : undefined,
    apiKeys: clientKeys()
  };
}

async function streamChat(payload, signal, onEvent) {
  const res = await fetch(apiUrl('/api/chat/stream'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(payload),
    signal
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Erro HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (!data) continue;
      let ev;
      try { ev = JSON.parse(data); } catch { continue; } // evento malformado
      onEvent(ev);
    }
  }
}

async function sendMessage(text, { regenerate = false } = {}) {
  if (busy) return;
  const thread = ensureThread();

  if (!regenerate) {
    text = text.trim();
    if (!text) return;
    // Guarda na conversa exatamente o que foi enviado: o usuário vê o que foi ocultado
    const safe = privacy(text, thread);
    if (safe !== text) toast('Dados sensíveis ocultados antes do envio');
    text = safe;
    if (!thread.messages.length) thread.title = makeTitle(text);
    thread.messages.push({ role: 'user', content: text });
  }
  // Só o que vem depois do último ponto de compactação vai bruto; a cauda quente
  // é garantida mesmo com dados antigos em que summarizedUpTo cobria tudo
  const start = Math.min(thread.summarizedUpTo || 0, Math.max(0, thread.messages.length - 1 - HOT_TAIL));
  const history = thread.messages.slice(start, -1);
  const message = thread.messages[thread.messages.length - 1].content;
  const reply = { role: 'assistant', content: '', meta: {}, pending: true };
  thread.messages.push(reply);
  thread.updatedAt = Date.now();
  saveThreads();
  renderAll();

  const myController = new AbortController();
  controller = myController;
  setBusy(true);

  try {
    await streamChat(buildPayload(thread, message, history), myController.signal, (ev) => {
      if (ev.type === 'meta') Object.assign(reply.meta, ev);
      else if (ev.type === 'token') { reply.content += ev.text; scheduleStreamRender(thread.id, reply); }
      else if (ev.type === 'done') reply.meta.durationMs = ev.durationMs;
      else if (ev.type === 'error') throw new Error(ev.error);
    });
  } catch (err) {
    if (myController.signal.aborted) {
      reply.meta.stopped = true;
    } else {
      reply.meta.error = true;
      reply.content = (reply.content ? `${reply.content}\n\n` : '') + (err.message || 'Falha de conexão.');
    }
  } finally {
    delete reply.pending;
    if (!reply.content) reply.content = '_Geração interrompida._';
    thread.updatedAt = Date.now();
    if (controller === myController) { controller = null; setBusy(false); }
    saveThreads();
    if (thread.id === activeId) { renderMessages(); renderMemory(); updateContextMeter(); }
    renderThreadList();
    // Só contadores agregados (nunca conteúdo) e só se logado; no modo local é no-op
    if (!reply.meta.error && !reply.meta.stopped) {
      window.Auth?.trackUsage({
        chats: 1,
        clinicalNotes: CLINICAL_EXPORT.has(thread.persona) ? 1 : 0,
        tokens: thread.messages.reduce((n, m) => n + m.content.length, 0) / 4
      });
    }
    // Janela perto do limite (~75%) ou já cortando: compacta em segundo plano
    if (!reply.meta.error && (reply.meta.compactSuggested || reply.meta.trimmedCount > 0)) compactThread(thread);
  }
}

function regenerate() {
  const t = activeThread();
  if (!t || busy) return;
  if (t.messages[t.messages.length - 1]?.role === 'assistant') t.messages.pop();
  if (t.messages[t.messages.length - 1]?.role !== 'user') return;
  sendMessage('', { regenerate: true });
}

// ===========================================================================
// Voz: ditado (SpeechRecognition) e leitura (speechSynthesis)
// ===========================================================================
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
let dictation = null; // { started, timer, base, finals } enquanto o ditado estiver ativo

function formatClock(ms) {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Ditado pós-sessão: contínuo (não para na primeira pausa) e com cronômetro MM:SS
function toggleDictation() {
  if (!Recognition) return toast('Ditado por voz não suportado neste navegador');
  if (dictation) return stopDictation();
  const d = { started: Date.now(), base: el.input.value ? `${el.input.value.trimEnd()} ` : '', finals: '' };
  dictation = d;
  el.mic.classList.add('recording');
  el.mic.title = 'Parar ditado';
  el.micTimer.hidden = false;
  el.micTimer.textContent = '00:00';
  d.timer = setInterval(() => { el.micTimer.textContent = formatClock(Date.now() - d.started); }, 1000);
  startRecognizer(d);
}

function startRecognizer(d) {
  const r = new Recognition();
  recognizer = r;
  r.lang = VOICE_LANG[settings.lang] || 'pt-BR';
  r.interimResults = true;
  r.continuous = true;
  const openedAt = Date.now();
  let heard = false;
  r.onresult = (e) => {
    heard = true;
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) d.finals += `${res[0].transcript.trim()} `;
      else interim += res[0].transcript;
    }
    el.input.value = d.base + d.finals + interim;
    autoGrow();
  };
  r.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      toast('Permita o uso do microfone para ditar');
      stopDictation();
    } else if (e.error !== 'aborted' && e.error !== 'no-speech') {
      toast(`Microfone: ${e.error}`);
    }
  };
  // O navegador encerra sozinho após silêncio longo: reabre enquanto o ditado estiver ativo
  r.onend = () => {
    if (dictation !== d || recognizer !== r) return;
    if (heard || Date.now() - openedAt > 2000) startRecognizer(d);
    else stopDictation();
  };
  try { r.start(); } catch { stopDictation(); }
}

function stopDictation() {
  const d = dictation;
  dictation = null;
  if (d) clearInterval(d.timer);
  const r = recognizer;
  recognizer = null;
  if (r) { try { r.stop(); } catch { /* já parado */ } }
  el.mic.classList.remove('recording');
  el.mic.title = 'Ditar por voz';
  el.micTimer.hidden = true;
}

let speakingBtn = null;
function resetSpeakBtn(btn) {
  btn.innerHTML = ICON.speak;
  btn.classList.remove('on');
  btn.title = 'Ouvir';
}

function speak(text, btn) {
  if (!('speechSynthesis' in window)) return toast('Leitura em voz alta não suportada aqui');
  const synth = window.speechSynthesis;
  const wasThis = speakingBtn === btn;
  synth.cancel();
  if (speakingBtn) resetSpeakBtn(speakingBtn);
  speakingBtn = null;
  if (wasThis) return; // segundo clique = parar
  const u = new SpeechSynthesisUtterance(stripMarkdown(text));
  u.lang = VOICE_LANG[settings.lang] || 'pt-BR';
  const prefix = settings.lang === 'en' ? 'en' : 'pt';
  const voice = synth.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith(prefix));
  if (voice) u.voice = voice;
  u.onend = u.onerror = () => { if (speakingBtn === btn) { resetSpeakBtn(btn); speakingBtn = null; } };
  speakingBtn = btn;
  btn.innerHTML = ICON.stop;
  btn.classList.add('on');
  btn.title = 'Parar leitura';
  synth.speak(u);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* sem clipboard */ }
    ta.remove();
  }
}

function flashCopied(btn) {
  btn.innerHTML = ICON.check;
  setTimeout(() => { btn.innerHTML = ICON.copy; }, 1400);
}

// ===========================================================================
// Status do servidor / modelos / configurações
// ===========================================================================
async function loadStatus() {
  try {
    const res = await fetch(apiUrl('/api/status'));
    serverStatus = await res.json();
    if (Array.isArray(serverStatus.personas) && serverStatus.personas.length) personas = serverStatus.personas;
  } catch {
    serverStatus = null;
  }
  updateStatusUi();
  fillModels();
  renderAll();
  initAccount();
}

// ===========================================================================
// Conta opcional (Supabase + Google). Sem config, nada muda: modo local.
// ===========================================================================
let accountWired = false;
async function initAccount() {
  if (!window.Auth || !serverStatus?.auth?.enabled) return;
  // O botão aparece mesmo se o SDK falhar (ex.: offline): o clique tenta de novo e explica o motivo
  el.accountBox.hidden = false;
  if (!accountWired) {
    accountWired = true;
    window.Auth.onAuthStateChange(renderAccount);
  }
  await window.Auth.init(serverStatus.auth);
  const pending = window.Auth.takeRedirectError?.();
  if (pending) toast(pending.message, { tone: 'warn', duration: 8000 });
}

// Login Google: nunca trava a interface nem mexe nos dados locais
let loginGuard = null;
function setLoginBusy(busyNow) {
  el.loginBtn.disabled = busyNow;
  el.loginBtn.classList.toggle('busy', busyNow);
  el.loginBtn.querySelector('span').textContent = busyNow ? 'Abrindo o Google…' : 'Entrar com Google';
}
async function startGoogleLogin() {
  if (!window.Auth || el.loginBtn.disabled) return;
  setLoginBusy(true);
  clearTimeout(loginGuard);
  // Se o navegador não sair da página (bloqueio, aba presa), devolve o botão
  loginGuard = setTimeout(() => setLoginBusy(false), 20000);
  try {
    await window.Auth.loginWithGoogle();
  } catch (err) {
    clearTimeout(loginGuard);
    setLoginBusy(false);
    toast(err?.message || 'Não foi possível entrar agora. Você continua no modo local.', { tone: 'warn' });
  }
}
// Voltou para a página pelo botão "voltar" do navegador sem concluir o login
window.addEventListener('pageshow', (e) => { if (e.persisted) { clearTimeout(loginGuard); setLoginBusy(false); } });

// ===========================================================================
// Painel do admin (métricas agregadas). O botão é só conveniência visual:
// quem decide é o banco (is_admin() + admin_usage_totals() com security definer).
// ===========================================================================
let adminCheck = 0;
async function refreshAdminAccess() {
  const ticket = ++adminCheck;
  const user = window.Auth?.currentUser();
  const admin = user ? await window.Auth.isAdmin() : false;
  if (ticket !== adminCheck) return; // resposta atrasada de outra sessão
  el.adminBtn.hidden = !admin;
  if (!admin) closeAdmin();
}

const fmtInt = new Intl.NumberFormat('pt-BR');
const fmtCompact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
function setMetric(key, value, sub) {
  const v = el.adminModal.querySelector(`[data-metric="${key}"]`);
  if (v) { v.textContent = value; v.title = value; }
  const s = el.adminModal.querySelector(`[data-metric-sub="${key}"]`);
  if (s && sub !== undefined) s.textContent = sub;
}

function openAdmin() {
  if (el.adminBtn.hidden) return;
  closeSettings();
  closeDrawer();
  el.adminModal.hidden = false;
  loadAdminMetrics();
}
function closeAdmin() { el.adminModal.hidden = true; }

let adminLoading = false;
async function loadAdminMetrics() {
  if (adminLoading || !window.Auth) return;
  adminLoading = true;
  el.adminModal.classList.add('loading');
  el.refreshAdmin.disabled = true;
  el.adminFeedback.textContent = '';
  el.adminFeedback.className = 'admin-feedback';
  try {
    const m = await window.Auth.adminUsageTotals();
    setMetric('totalUsers', fmtInt.format(m.totalUsers), `${fmtInt.format(m.activeLast7d)} ativos em 7 dias · ${fmtInt.format(m.activeLast30d)} em 30`);
    setMetric('totalChats', fmtInt.format(m.totalChats), m.totalUsers ? `≈ ${fmtInt.format(Math.round(m.totalChats / m.totalUsers))} por profissional` : ' ');
    setMetric('clinicalNotes', fmtInt.format(m.clinicalNotes));
    setMetric('tokensEstimated', m.tokensEstimated >= 10000 ? fmtCompact.format(m.tokensEstimated) : fmtInt.format(m.tokensEstimated));
    el.adminModal.querySelector('[data-metric="tokensEstimated"]').title = `${fmtInt.format(m.tokensEstimated)} tokens`;
    el.adminFeedback.textContent = `${fmtInt.format(m.backedUpSessions)} sessões com backup cifrado na nuvem.`;
    el.adminUpdated.textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (err) {
    el.adminFeedback.className = 'admin-feedback warn';
    el.adminFeedback.textContent = err?.message || 'Não foi possível carregar as métricas.';
    if (err?.code === 'forbidden') { el.adminBtn.hidden = true; setTimeout(closeAdmin, 2500); }
  } finally {
    adminLoading = false;
    el.adminModal.classList.remove('loading');
    el.refreshAdmin.disabled = false;
  }
}


function renderAccount() {
  const user = window.Auth?.currentUser();
  el.loginBtn.hidden = Boolean(user);
  el.accountProfile.hidden = !user;
  refreshAdminAccess();
  if (!user) return;
  const initials = String(user.name || user.email || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  el.accountAvatar.textContent = initials || '?';
  el.accountName.textContent = user.name || 'Conta Google';
  el.accountEmail.textContent = user.email || '';
  el.accountProfile.title = user.email || '';
}

function updateStatusUi() {
  const demo = !serverStatus ? false : serverStatus.demoMode && !hasClientKey();
  el.dot.className = 'status-dot ' + (!serverStatus ? '' : demo ? 'demo' : 'online');
  el.statusText.textContent = !serverStatus ? 'Servidor offline' : demo ? 'Modo demo' : 'Online';
  el.dot.title = el.statusText.textContent;
  el.banner.hidden = !demo;
}

function fillModels() {
  el.model.textContent = '';
  el.model.appendChild(new Option('Auto (Cascata Inteligente)', ''));
  for (const p of serverStatus?.providers || []) {
    const group = document.createElement('optgroup');
    group.label = p.name;
    for (const m of p.models) {
      const wide = m.window === 'wide' ? ' · janela ampla' : '';
      group.appendChild(new Option(`${m.name} · ${m.badge}${wide}`, m.id));
    }
    el.model.appendChild(group);
  }
  el.model.value = settings.model || '';
  if (el.model.value !== (settings.model || '')) el.model.value = '';
  updateContextMeter();
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
}

function openSettings(tab = 'appearance') {
  el.groqKey.value = settings.keys.groq || '';
  el.orKey.value = settings.keys.openrouter || '';
  el.geminiKey.value = settings.keys.gemini || '';
  el.sysPrompt.value = settings.systemPrompt || '';
  el.backendUrl.value = settings.backendUrl || '';
  el.pii.checked = settings.pii;
  el.freshChat.value = String(settings.freshChatAfter ?? '30');
  el.feedback.textContent = '';
  syncAppearanceControls();
  showTab(tab);
  el.modal.hidden = false;
  closeDrawer();
}

function closeSettings() { el.modal.hidden = true; }

function saveSettings() {
  const url = el.backendUrl.value.trim();
  if (url && !/^https?:\/\/[^\s]+$/i.test(url)) {
    showTab('api');
    el.feedback.textContent = 'URL do backend inválida. Use http:// ou https://';
    return;
  }
  settings.keys = { groq: el.groqKey.value.trim(), openrouter: el.orKey.value.trim(), gemini: el.geminiKey.value.trim() };
  settings.systemPrompt = el.sysPrompt.value.trim();
  settings.backendUrl = url;
  settings.pii = el.pii.checked;
  settings.freshChatAfter = el.freshChat.value;
  saveSettingsStore();
  renderModeControls();
  closeSettings();
  toast('Configurações salvas');
  loadStatus();
}

// ===========================================================================
// Barra lateral: recolhe no desktop, vira gaveta no celular
// ===========================================================================
function openSidebar() {
  if (isMobile()) {
    el.layout.classList.add('drawer-open');
  } else {
    el.layout.classList.remove('sidebar-closed');
    settings.sidebarClosed = false;
    saveSettingsStore();
  }
}

function collapseSidebar() {
  el.layout.classList.add('sidebar-closed');
  settings.sidebarClosed = true;
  saveSettingsStore();
}

function closeDrawer() { el.layout.classList.remove('drawer-open'); }

function autoGrow() {
  el.input.style.height = 'auto';
  el.input.style.height = `${Math.min(el.input.scrollHeight, 200)}px`;
  updateSendState();
}

// ===========================================================================
// Eventos
// ===========================================================================
el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (busy) { stopGeneration(); return; }
  if (dictation) stopDictation();
  const text = el.input.value;
  if (!text.trim()) return;
  el.input.value = '';
  autoGrow();
  sendMessage(text);
});
el.input.addEventListener('keydown', (e) => {
  // Em tela de toque o Enter quebra linha (o envio é pelo botão), como no ChatGPT
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !window.matchMedia('(pointer: coarse)').matches) {
    e.preventDefault();
    if (!busy) el.form.requestSubmit();
  }
});
el.input.addEventListener('input', () => { autoGrow(); updateContextMeter(); });
el.mic.addEventListener('click', toggleDictation);

el.menuBtn.addEventListener('click', openSidebar);
el.collapseBtn.addEventListener('click', collapseSidebar);
el.backdrop.addEventListener('click', closeDrawer);
el.newChat.addEventListener('click', newChat);
el.topNewChat.addEventListener('click', newChat);
el.search.addEventListener('input', renderThreadList);

el.personaBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePersonaMenu(); });
el.model.addEventListener('change', () => {
  settings.model = el.model.value;
  saveSettingsStore();
  updateContextMeter();
  toast(settings.model ? `Modelo: ${el.model.selectedOptions[0].text.split(' · ')[0]}` : 'Auto: cascata inteligente entre os provedores');
});
el.langBtn.addEventListener('click', toggleLang);
el.memoryBtn.addEventListener('click', () => toggleMemoryPanel());
el.caseMemory.addEventListener('input', () => onMemoryInput('caseMemory'));
el.rollingSummary.addEventListener('input', () => onMemoryInput('rollingSummary'));
el.redactTerms.addEventListener('input', () => onMemoryInput('redactTerms'));
el.workspace.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-workspace]');
  if (b) setWorkspace(b.dataset.workspace);
});
el.summarizeBtn.addEventListener('click', () => compactThread(activeThread(), { manual: true }));
document.addEventListener('click', (e) => {
  if (!el.personaBar.hidden && !e.target.closest('.persona-menu')) togglePersonaMenu(false);
});

el.openSettings.addEventListener('click', () => openSettings());
el.bannerBtn.addEventListener('click', () => openSettings('api'));
el.closeSettings.addEventListener('click', closeSettings);
el.modal.addEventListener('click', (e) => { if (e.target === el.modal) closeSettings(); });
el.saveSettings.addEventListener('click', saveSettings);
el.exportBackupBtn.addEventListener('click', exportBackup);
el.loginBtn.addEventListener('click', startGoogleLogin);
el.logoutBtn.addEventListener('click', () => {
  window.Auth?.logout().then(() => toast('Você saiu. Os dados locais continuam neste aparelho.'), () => toast('Não foi possível sair', { tone: 'warn' }));
});
el.adminBtn.addEventListener('click', openAdmin);
el.closeAdmin.addEventListener('click', closeAdmin);
el.refreshAdmin.addEventListener('click', loadAdminMetrics);
el.adminModal.addEventListener('click', (e) => { if (e.target === el.adminModal) closeAdmin(); });
el.importBackupBtn.addEventListener('click', () => el.importBackupInput.click());
el.importBackupInput.addEventListener('change', () => {
  const f = el.importBackupInput.files[0];
  if (f) importBackup(f).finally(() => { el.importBackupInput.value = ''; });
});
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

// Aparência aplica na hora (prévia ao vivo), sem precisar salvar
document.querySelectorAll('[data-setting]').forEach((group) => {
  group.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-value]');
    if (b) setAppearance({ [group.dataset.setting]: b.dataset.value });
  });
});
el.fontSize.addEventListener('input', () => setAppearance({ fontSize: Number(el.fontSize.value) }));
el.motion.addEventListener('change', () => setAppearance({ motion: el.motion.checked }));

// Delegação: copiar código, copiar/ouvir/regenerar resposta
el.list.addEventListener('click', (e) => {
  const copyCode = e.target.closest('.copy-code');
  if (copyCode) {
    const code = copyCode.closest('.code-block').querySelector('code').textContent;
    const label = copyCode.querySelector('span');
    copyText(code).then(() => { label.textContent = 'Copiado'; setTimeout(() => { label.textContent = 'Copiar código'; }, 1500); });
    return;
  }
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const idx = Number(btn.closest('.msg').dataset.index);
  const msg = activeThread()?.messages[idx];
  if (!msg) return;
  if (btn.dataset.action === 'copy') copyText(msg.content).then(() => flashCopied(btn));
  else if (btn.dataset.action === 'speak') speak(msg.content, btn);
  else if (btn.dataset.action === 'regen') regenerate();
  else if (btn.dataset.action === 'clin-copy') {
    copyText(clinicalPlainText(msg.content)).then(() => {
      const label = btn.querySelector('span');
      btn.classList.add('done');
      btn.querySelector('svg').outerHTML = ICON.check;
      label.textContent = 'Copiado!';
      clearTimeout(btn._t);
      btn._t = setTimeout(() => { btn.classList.remove('done'); btn.querySelector('svg').outerHTML = ICON.copy; label.textContent = 'Copiar formatado'; }, 1600);
    });
  } else if (btn.dataset.action === 'clin-txt' || btn.dataset.action === 'clin-md') {
    const fmt = btn.dataset.action === 'clin-md' ? 'md' : 'txt';
    const rec = clinicalRecord(activeThread(), msg, fmt);
    downloadFile(rec.name, rec.content, fmt === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeSettings(); closeAdmin(); closeDrawer(); togglePersonaMenu(false); if (dictation) stopDictation(); }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); newChat(); }
});

if (!Recognition) el.mic.hidden = true;
if (settings.sidebarClosed) el.layout.classList.add('sidebar-closed');
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

maybeStartFresh();
markSeen();
alignEmptyThread();
renderModeControls();
renderAll();
loadStatus();

// Marca a última vez em que o app esteve visível; ao voltar, decide se abre conversa nova
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') return markSeen();
  if (maybeStartFresh({ onResume: true })) {
    closeSettings();
    closeAdmin();
    renderAll();
    toast('Conversa nova. A anterior está no histórico.');
  }
  markSeen();
});
window.addEventListener('pagehide', markSeen);
window.addEventListener('online', () => { if (serverStatus?.auth?.enabled && !window.Auth?.enabled) initAccount(); });
