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
  case_organizer: 'Metas, cronograma e evolução do caso'
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
  { id: 'case_organizer', name: 'Organizador de Caso e Metas', group: 'counseling' }
];
const LIMITS = { caseMemory: 4000, rollingSummary: 3000 };
const VOICE_LANG = { pt: 'pt-BR', en: 'en-US' };

const settings = Object.assign(
  {
    keys: { groq: '', openrouter: '', gemini: '' }, systemPrompt: '', backendUrl: '', model: '', sidebarClosed: false,
    tier: 'standard', lang: 'pt', pii: true
  },
  store.get('ia.settings', {})
);
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
  groqKey: $('groqKeyInput'), orKey: $('openrouterKeyInput'), geminiKey: $('geminiKeyInput'),
  sysPrompt: $('systemPromptInput'), backendUrl: $('backendUrlInput'),
  fontSize: $('fontSizeInput'), fontSizeValue: $('fontSizeValue'), motion: $('motionInput'),
  proBtn: $('proBtn'), langBtn: $('langBtn'), memoryBtn: $('memoryBtn'), memoryDot: $('memoryDot'),
  memoryPanel: $('memoryPanel'), caseMemory: $('caseMemoryInput'), rollingSummary: $('rollingSummaryInput'),
  caseMemoryCount: $('caseMemoryCount'), rollingSummaryCount: $('rollingSummaryCount'),
  summarizeBtn: $('summarizeBtn'), memoryHint: $('memoryHint'), pii: $('piiInput'), piiBadge: $('piiBadge')
};

// Ícones de traço (constantes confiáveis, nunca vêm do usuário)
const ICON = {
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5L20 7"/></svg>',
  speak: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  regen: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>'
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
// Filtro de privacidade: oculta PII óbvia ANTES de o texto sair do aparelho.
// Ordem importa: documentos antes de telefones (um SSN parece um telefone curto).
// ===========================================================================
const PII_RULES = [
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[EMAIL_OCULTO]'],
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[DOC_OCULTO]'], // CPF
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[DOC_OCULTO]'], // SSN (EUA)
  [/(\+?55[\s-]?)?\(?\b\d{2}\)?[\s-]?9?\d{4}[\s-]\d{4}\b/g, '[TEL_OCULTO]'], // Brasil
  [/(\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, '[TEL_OCULTO]'] // EUA/Canadá
];

function redactPII(text) {
  let out = String(text || '');
  for (const [re, label] of PII_RULES) out = out.replace(re, label);
  return out;
}

function privacy(text) {
  return settings.pii ? redactPII(text) : text;
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

function renderMarkdown(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l || '');

  while (i < lines.length) {
    const line = lines[i];

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
    id: uid(), title: 'Nova conversa', persona: persona || activeThread()?.persona || 'geral', messages: [], updatedAt: Date.now(),
    caseMemory: '', rollingSummary: '', summarizedUpTo: 0, needsSummary: false
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
  threads = threads.filter((t) => t.messages.length || t.caseMemory || t.rollingSummary || t.id === activeId);
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
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${t.title.replace(/[^\wÀ-ſ -]+/g, '').trim().slice(0, 40) || 'conversa'}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

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

function renderThreadList() {
  const q = el.search.value.trim().toLowerCase();
  el.threadList.textContent = '';
  const items = threads
    .filter((t) => t.messages.length || t.caseMemory || t.rollingSummary)
    .filter((t) => !q || t.title.toLowerCase().includes(q) || t.messages.some((m) => m.content.toLowerCase().includes(q)))
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
    open.textContent = t.title;
    open.title = t.title;
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
  if (meta.tier === 'pro') parts.push('Pro');
  if (meta.fallbackTriggered) parts.push('fallback');
  if (meta.trimmedCount) parts.push(`${meta.trimmedCount} msgs antigas resumidas`);
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
    wrap.appendChild(bar);
  }
  return wrap;
}

function renderMessages() {
  const t = activeThread();
  const msgs = t ? t.messages : [];
  el.list.textContent = '';
  el.layout.classList.toggle('is-empty', msgs.length === 0);
  msgs.forEach((m, i) => el.list.appendChild(messageNode(m, i, i === msgs.length - 1)));
  scrollToBottom(true);
}

function renderAll() {
  const t = activeThread();
  document.title = t && t.messages.length ? `${t.title} · IA de Respostas` : 'IA de Respostas';
  renderPersonas();
  renderThreadList();
  renderMessages();
  renderMemory();
}

// ===========================================================================
// Memória do caso (camada 1: ficha fixa · camada 2: resumo de longo prazo)
// ===========================================================================
function renderMemory() {
  const t = activeThread();
  el.caseMemory.value = t?.caseMemory || '';
  el.rollingSummary.value = t?.rollingSummary || '';
  updateMemoryCounts();
  const pending = Boolean(t?.needsSummary);
  el.memoryDot.hidden = !pending;
  el.memoryHint.textContent = pending
    ? 'Mensagens antigas saíram do contexto. Atualize o resumo para a IA não esquecer.'
    : t?.summarizedUpTo ? `Resumo cobre ${t.summarizedUpTo} mensagens.` : '';
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
  t[field] = (field === 'caseMemory' ? el.caseMemory : el.rollingSummary).value.slice(0, LIMITS[field]);
  t.updatedAt = Date.now();
  updateMemoryCounts();
  clearTimeout(memorySaveTimer);
  memorySaveTimer = setTimeout(() => { saveThreads(); renderThreadList(); }, 400);
}

let summarizing = false;
async function updateSummary() {
  const thread = activeThread();
  if (summarizing || !thread) return;
  const fresh = thread.messages.slice(thread.summarizedUpTo || 0).filter((m) => !m.pending && !m.meta?.error && m.content);
  if (!fresh.length) return toast('Nenhuma mensagem nova para resumir');
  const upTo = thread.messages.length;
  summarizing = true;
  el.summarizeBtn.classList.add('loading');
  try {
    const res = await fetch(apiUrl('/api/summarize'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        previousSummary: privacy(thread.rollingSummary || ''),
        messages: fresh.map((m) => ({ role: m.role, content: privacy(m.content) })),
        lang: settings.lang,
        apiKeys: clientKeys()
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.summary) throw new Error(data.error || `Erro HTTP ${res.status}`);
    // Grava na conversa que pediu o resumo, mesmo se o usuário já trocou de conversa
    thread.rollingSummary = data.summary.slice(0, LIMITS.rollingSummary);
    thread.summarizedUpTo = upTo;
    thread.needsSummary = false;
    thread.updatedAt = Date.now();
    saveThreads();
    if (thread.id === activeId) renderMemory();
    toast('Resumo de longo prazo atualizado');
  } catch (err) {
    toast(err.message || 'Não foi possível resumir agora');
  } finally {
    summarizing = false;
    el.summarizeBtn.classList.remove('loading');
  }
}

// ===========================================================================
// Plano (Standard/Pro), idioma e privacidade
// ===========================================================================
function renderModeControls() {
  const pro = settings.tier === 'pro';
  el.proBtn.setAttribute('aria-pressed', String(pro));
  el.proBtn.title = pro
    ? 'Modo Pro ativo: contexto de ~30 mil tokens, prioriza Gemini. Clique para voltar ao Standard.'
    : 'Ativar Modo Pro: contexto longo (~30 mil tokens), prioriza Gemini';
  el.langBtn.textContent = settings.lang === 'en' ? 'EN' : 'PT';
  el.langBtn.title = settings.lang === 'en' ? 'Respostas e voz em inglês (clique para português)' : 'Respostas e voz em português (clique para inglês)';
  el.input.placeholder = settings.lang === 'en' ? 'Ask anything' : 'Pergunte alguma coisa';
  el.piiBadge.hidden = !settings.pii;
}

function toggleTier() {
  settings.tier = settings.tier === 'pro' ? 'standard' : 'pro';
  saveSettingsStore();
  renderModeControls();
  toast(settings.tier === 'pro' ? 'Modo Pro: contexto longo ativado' : 'Modo Standard: respostas mais rápidas');
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

function toast(text) {
  document.querySelectorAll('.toast').forEach((n) => n.remove());
  const n = document.createElement('div');
  n.className = 'toast';
  n.textContent = text;
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 2000);
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
    message: privacy(message),
    history: history.filter((m) => !m.meta?.error && m.content).map((m) => ({ role: m.role, content: privacy(m.content) })),
    persona: thread.persona,
    model: settings.model || undefined,
    systemPrompt: settings.systemPrompt ? privacy(settings.systemPrompt) : undefined,
    tier: settings.tier,
    lang: settings.lang,
    caseMemory: thread.caseMemory ? privacy(thread.caseMemory) : undefined,
    rollingSummary: thread.rollingSummary ? privacy(thread.rollingSummary) : undefined,
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
    const safe = privacy(text);
    if (safe !== text) toast('Dados sensíveis ocultados antes do envio');
    text = safe;
    if (!thread.messages.length) thread.title = makeTitle(text);
    thread.messages.push({ role: 'user', content: text });
  }
  const history = thread.messages.slice(0, -1);
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
    // Histórico antigo saiu do contexto: sugere atualizar o resumo de longo prazo
    if (reply.meta.trimmedCount > 0 && !thread.needsSummary) {
      thread.needsSummary = true;
      if (thread.id === activeId) toast('Conversa longa: atualize o resumo na Memória do caso');
    }
    saveThreads();
    if (thread.id === activeId) { renderMessages(); renderMemory(); }
    renderThreadList();
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

function toggleDictation() {
  if (!Recognition) return toast('Ditado por voz não suportado neste navegador');
  if (recognizer) { recognizer.stop(); return; }
  recognizer = new Recognition();
  recognizer.lang = VOICE_LANG[settings.lang] || 'pt-BR';
  recognizer.interimResults = true;
  recognizer.continuous = false;
  const base = el.input.value ? `${el.input.value.trimEnd()} ` : '';
  recognizer.onresult = (e) => {
    let text = '';
    for (const r of e.results) text += r[0].transcript;
    el.input.value = base + text;
    autoGrow();
  };
  recognizer.onerror = (e) => { if (e.error !== 'aborted') toast(`Microfone: ${e.error}`); };
  recognizer.onend = () => { recognizer = null; el.mic.classList.remove('recording'); };
  el.mic.classList.add('recording');
  try { recognizer.start(); } catch { recognizer = null; el.mic.classList.remove('recording'); }
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
  el.model.appendChild(new Option('Automático (melhor disponível)', ''));
  for (const p of serverStatus?.providers || []) {
    const group = document.createElement('optgroup');
    group.label = p.name;
    for (const m of p.models) group.appendChild(new Option(`${m.name} · ${m.badge}`, m.id));
    el.model.appendChild(group);
  }
  el.model.value = settings.model || '';
  if (el.model.value !== (settings.model || '')) el.model.value = '';
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
  el.model.value = settings.model || '';
  el.pii.checked = settings.pii;
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
  settings.model = el.model.value;
  settings.pii = el.pii.checked;
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
el.input.addEventListener('input', autoGrow);
el.mic.addEventListener('click', toggleDictation);

el.menuBtn.addEventListener('click', openSidebar);
el.collapseBtn.addEventListener('click', collapseSidebar);
el.backdrop.addEventListener('click', closeDrawer);
el.newChat.addEventListener('click', newChat);
el.topNewChat.addEventListener('click', newChat);
el.search.addEventListener('input', renderThreadList);

el.personaBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePersonaMenu(); });
el.proBtn.addEventListener('click', toggleTier);
el.langBtn.addEventListener('click', toggleLang);
el.memoryBtn.addEventListener('click', () => toggleMemoryPanel());
el.caseMemory.addEventListener('input', () => onMemoryInput('caseMemory'));
el.rollingSummary.addEventListener('input', () => onMemoryInput('rollingSummary'));
el.summarizeBtn.addEventListener('click', updateSummary);
document.addEventListener('click', (e) => {
  if (!el.personaBar.hidden && !e.target.closest('.persona-menu')) togglePersonaMenu(false);
});

el.openSettings.addEventListener('click', () => openSettings());
el.bannerBtn.addEventListener('click', () => openSettings('api'));
el.closeSettings.addEventListener('click', closeSettings);
el.modal.addEventListener('click', (e) => { if (e.target === el.modal) closeSettings(); });
el.saveSettings.addEventListener('click', saveSettings);
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

document.querySelectorAll('.suggestion').forEach((card) => {
  card.addEventListener('click', () => {
    if (card.dataset.persona) setPersona(card.dataset.persona);
    sendMessage(card.dataset.prompt);
  });
});

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
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeSettings(); closeDrawer(); togglePersonaMenu(false); }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); newChat(); }
});

if (!Recognition) el.mic.hidden = true;
if (settings.sidebarClosed) el.layout.classList.add('sidebar-closed');
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

renderModeControls();
renderAll();
loadStatus();
