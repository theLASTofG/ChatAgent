// Smoke test: sobe o servidor numa porta livre e testa /api/status, /api/chat e /api/chat/stream.
// Roda SEM gastar cota: força Modo Demo e simula os provedores para testar o fallback.
process.env.GROQ_API_KEY = '';
process.env.OPENROUTER_API_KEY = '';
process.env.GEMINI_API_KEY = '';
process.env.DEMO_DELAY_MS = '0';
process.env.RATE_LIMIT_PER_MIN = '1000'; // o teste de rate limit baixa isso temporariamente
process.env.ALLOWED_ORIGINS = '';

const assert = require('assert');
const app = require('./server');

const realFetch = globalThis.fetch;
let failures = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ❌ ${name}\n     ${err.message}`);
  }
}

function readSse(text) {
  return text.split('\n\n').map((b) => b.replace(/^data:\s*/, '').trim()).filter(Boolean).map((d) => JSON.parse(d));
}

// Provedor falso: o 1º modelo da Groq responde 429, o 2º responde OK.
function mockProviders() {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    if (!String(url).startsWith('https://')) return realFetch(url, opts);
    const body = JSON.parse(opts.body);
    calls.push({ url: String(url), model: body.model, auth: opts.headers.Authorization, maxTokens: body.max_tokens, messages: body.messages });
    if (body.model === 'openai/gpt-oss-120b') {
      return new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), { status: 429 });
    }
    if (body.stream) {
      // Tags <thought> divididas entre chunks devem sumir do texto final
      const sse = 'data: {"choices":[{"delta":{"content":"<tho"}}]}\n\ndata: {"choices":[{"delta":{"content":"ught>pensando...</th"}}]}\n\ndata: {"choices":[{"delta":{"content":"ought>\\n"}}]}\n\ndata: {"choices":[{"delta":{"content":"Olá "}}]}\n\ndata: {"choices":[{"delta":{"content":"mundo"}}]}\n\ndata: [DONE]\n\n';
      return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: '<thought>raciocínio interno</thought>\nresposta real' } }], usage: {} }), { status: 200 });
  };
  return calls;
}

(async () => {
  const server = app.listen(0);
  await new Promise((ok) => server.once('listening', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => realFetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  console.log(`\n🧪 Smoke test em ${base}\n`);

  await test('GET /api/status lista provedores, personas e não vaza chaves', async () => {
    const res = await realFetch(`${base}/api/status`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.demoMode, true);
    assert.deepStrictEqual(data.providers.map((p) => p.id), ['groq', 'openrouter', 'gemini']);
    assert.ok(data.personas.some((p) => p.id === 'dev' && p.temperature === 0.2));
    assert.ok(!/gsk_|sk-or-|AIza/.test(JSON.stringify(data)));
  });

  await test('GET / serve a interface', async () => {
    const res = await realFetch(`${base}/`);
    assert.strictEqual(res.status, 200);
    assert.ok((await res.text()).includes('chatForm'));
  });

  await test('POST /api/chat rejeita mensagem vazia (400)', async () => {
    const res = await post('/api/chat', { message: '   ' });
    assert.strictEqual(res.status, 400);
  });

  await test('POST /api/chat em Modo Demo', async () => {
    const res = await post('/api/chat', { message: 'Oi', persona: 'dev' });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.reply.includes('[Modo Demo'));
    assert.strictEqual(data.providerUsed, 'demo');
    assert.strictEqual(data.fallbackTriggered, false);
  });

  await test('POST /api/chat/stream em Modo Demo (meta → tokens → done)', async () => {
    const res = await post('/api/chat/stream', { message: 'Oi' });
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get('content-type').startsWith('text/event-stream'));
    const events = readSse(await res.text());
    assert.strictEqual(events[0].type, 'meta');
    assert.strictEqual(events.at(-1).type, 'done');
    const text = events.filter((e) => e.type === 'token').map((e) => e.text).join('');
    assert.ok(text.includes('[Modo Demo'));
  });

  await test('Proteção de contexto enxuga histórico > 12.000 caracteres', async () => {
    const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(3000) }));
    const data = await (await post('/api/chat', { message: 'resumo', history })).json();
    assert.ok(data.trimmedCount >= 6, `trimmedCount=${data.trimmedCount}`);
  });

  // ------------------------------------------------------------------ Sprint 2 (sem provedor)
  await test('Segurança: headers nosniff, X-Frame-Options e Referrer-Policy', async () => {
    const res = await realFetch(`${base}/`);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
    assert.strictEqual(res.headers.get('referrer-policy'), 'no-referrer');
    assert.strictEqual(res.headers.get('x-powered-by'), null);
  });

  await test('Novas personas de Counseling no /api/status', async () => {
    const data = await (await realFetch(`${base}/api/status`)).json();
    const byId = Object.fromEntries(data.personas.map((p) => [p.id, p]));
    assert.strictEqual(byId.soap_notes?.temperature, 0.2);
    assert.strictEqual(byId.pre_session?.temperature, 0.3);
    assert.strictEqual(byId.case_organizer?.temperature, 0.4);
    for (const id of ['geral', 'dev', 'professor', 'resumidor', 'tradutor']) assert.ok(byId[id], `persona ${id} sumiu`);
    assert.strictEqual(data.tiers.pro.maxContextChars, 120000);
    assert.strictEqual(data.tiers.standard.maxContextChars, 14000);
  });

  await test('buildMessages: memória do caso e resumo sobrevivem ao corte (> 12.000 chars)', async () => {
    const { buildMessages } = app.locals;
    const system = 'SISTEMA\n\n### Memória fixa do caso\nMEMORIA_FIXA\n\n### Resumo de longo prazo\nRESUMO_LONGO';
    const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${i}`.repeat(3000) }));
    const out = buildMessages({ systemPrompt: system, history, message: 'oi', maxContextChars: 14000 });
    assert.ok(out.trimmedCount > 0);
    assert.strictEqual(out.messages[0].role, 'system');
    assert.ok(out.messages[0].content.includes('MEMORIA_FIXA') && out.messages[0].content.includes('RESUMO_LONGO'));
    const total = out.messages.reduce((s, m) => s + m.content.length, 0);
    assert.ok(total <= 14000, `total=${total}`);
    // No Pro o mesmo histórico cabe inteiro
    assert.strictEqual(buildMessages({ systemPrompt: system, history, message: 'oi', maxContextChars: 120000 }).trimmedCount, 0);
  });

  await test('POST /api/summarize em Modo Demo e validação 400', async () => {
    const res = await post('/api/summarize', { previousSummary: '', messages: [{ role: 'user', content: 'Sessão 1: ansiedade' }], lang: 'pt' });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.summary.includes('Pontos-chave') && data.summary.includes('Pendências'));
    assert.strictEqual((await post('/api/summarize', { messages: [] })).status, 400);
  });

  await test('Rate limiter: 429 amigável com X-RateLimit-* depois do limite', async () => {
    process.env.RATE_LIMIT_PER_MIN = '2';
    app.locals.resetRateLimit();
    try {
      const r1 = await post('/api/chat', { message: 'a' });
      assert.strictEqual(r1.headers.get('x-ratelimit-limit'), '2');
      assert.strictEqual(r1.headers.get('x-ratelimit-remaining'), '1');
      await post('/api/chat', { message: 'b' });
      const r3 = await post('/api/chat/stream', { message: 'c' });
      assert.strictEqual(r3.status, 429);
      assert.strictEqual(r3.headers.get('x-ratelimit-remaining'), '0');
      assert.ok(r3.headers.get('retry-after'));
      assert.ok((await r3.json()).error.includes('Aguarde'));
    } finally {
      process.env.RATE_LIMIT_PER_MIN = '1000';
      app.locals.resetRateLimit();
    }
  });

  const calls = mockProviders();

  await test('Fallback: 429 no modelo principal → próximo modelo (/api/chat)', async () => {
    calls.length = 0;
    const res = await post('/api/chat', { message: 'Oi', apiKeys: { groq: 'gsk_teste_1234567890' } });
    const data = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(data));
    assert.strictEqual(data.reply, 'resposta real');
    assert.strictEqual(data.fallbackTriggered, true);
    assert.strictEqual(data.modelUsed, 'openai/gpt-oss-20b');
    assert.strictEqual(data.providerUsed, 'groq');
    assert.strictEqual(calls.length, 2);
  });

  await test('Fallback no streaming entrega texto real', async () => {
    const res = await post('/api/chat/stream', { message: 'Oi', apiKeys: { groq: 'gsk_teste_1234567890' } });
    const events = readSse(await res.text());
    assert.strictEqual(events[0].fallbackTriggered, true);
    assert.strictEqual(events.filter((e) => e.type === 'token').map((e) => e.text).join(''), 'Olá mundo');
    assert.strictEqual(events.at(-1).type, 'done');
  });

  await test('Chave com quebra de linha é descartada (anti header-injection) → Demo', async () => {
    const data = await (await post('/api/chat', { message: 'Oi', apiKeys: { groq: 'gsk_abc\r\nX-Evil: 1' } })).json();
    assert.strictEqual(data.providerUsed, 'demo');
  });

  // ------------------------------------------------------------------ Sprint 2 (provedor simulado)
  await test('caseMemory e rollingSummary chegam ao provedor mesmo com histórico enorme', async () => {
    calls.length = 0;
    const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'h'.repeat(3000) }));
    const data = await (await post('/api/chat', {
      message: 'Briefing de hoje', persona: 'pre_session', history,
      caseMemory: 'Cliente M., meta: reduzir ansiedade social', rollingSummary: 'Sessão 3: iniciou diário de pensamentos',
      apiKeys: { groq: 'gsk_teste_1234567890' }
    })).json();
    assert.ok(data.trimmedCount > 0, `trimmedCount=${data.trimmedCount}`);
    const system = calls.at(-1).messages[0];
    assert.strictEqual(system.role, 'system');
    assert.ok(system.content.includes('reduzir ansiedade social'));
    assert.ok(system.content.includes('diário de pensamentos'));
    assert.ok(system.content.includes('Briefing') || system.content.includes('Pré') || system.content.includes('30 segundos'));
  });

  await test('tier pro: prioriza Gemini, janela de 120k e max_tokens 2500', async () => {
    calls.length = 0;
    const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'p'.repeat(3000) }));
    const data = await (await post('/api/chat', {
      message: 'Oi', tier: 'pro', history,
      apiKeys: { groq: 'gsk_teste_1234567890', gemini: 'AIza_teste_1234567890' }
    })).json();
    assert.strictEqual(calls[0].model, 'gemini-3-flash-preview');
    assert.ok(calls[0].url.includes('generativelanguage.googleapis.com'));
    assert.strictEqual(calls[0].maxTokens, 2500);
    assert.strictEqual(data.providerUsed, 'gemini');
    assert.strictEqual(data.tier, 'pro');
    assert.strictEqual(data.trimmedCount, 0, 'no Pro o histórico de 30k chars deve caber inteiro');
  });

  await test('tier pro sem chave Gemini cai para Groq gpt-oss-120b (e segue o fallback)', async () => {
    calls.length = 0;
    await post('/api/chat', { message: 'Oi', tier: 'pro', apiKeys: { groq: 'gsk_teste_1234567890' } });
    assert.strictEqual(calls[0].model, 'openai/gpt-oss-120b');
  });

  await test('lang en: sistema pede inglês profissional', async () => {
    calls.length = 0;
    await post('/api/chat', { message: 'Session notes', persona: 'soap_notes', lang: 'en', apiKeys: { groq: 'gsk_teste_1234567890' } });
    const system = calls.at(-1).messages[0].content;
    assert.ok(system.includes('Respond in clear, professional English'));
    assert.ok(system.includes('SOAP'));
  });

  await test('POST /api/summarize com provedor devolve o resumo', async () => {
    calls.length = 0;
    const res = await post('/api/summarize', {
      previousSummary: 'Pontos-chave: sessão 1', messages: [{ role: 'user', content: 'Sessão 2: progresso' }],
      lang: 'pt', apiKeys: { groq: 'gsk_teste_1234567890' }
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(data));
    assert.strictEqual(data.summary, 'resposta real'); // <thought> removido
    assert.ok(data.summary.length <= 1500);
    assert.ok(calls.at(-1).messages[1].content.includes('Sessão 2: progresso'));
  });

  await test('Round-robin: várias chaves no .env alternam entre requisições', async () => {
    process.env.GROQ_API_KEY = 'gsk_chave_AAAAAAAAAA,gsk_chave_BBBBBBBBBB';
    try {
      calls.length = 0;
      await post('/api/chat', { message: 'um' });
      const first = calls[0].auth;
      calls.length = 0;
      await post('/api/chat', { message: 'dois' });
      assert.notStrictEqual(calls[0].auth, first, 'a 2ª requisição deve começar pela outra chave');
      // Com 429 na 1ª chave, o mesmo modelo é tentado na 2ª chave antes de trocar de modelo
      assert.strictEqual(calls[1].model, calls[0].model);
      assert.notStrictEqual(calls[1].auth, calls[0].auth);
      const status = await (await realFetch(`${base}/api/status`)).json();
      assert.strictEqual(status.providers.find((p) => p.id === 'groq').keyCount, 2);
      assert.ok(!JSON.stringify(status).includes('gsk_chave'));
    } finally {
      process.env.GROQ_API_KEY = '';
    }
  });

  globalThis.fetch = realFetch;
  server.close();
  console.log(failures ? `\n💥 ${failures} teste(s) falharam.\n` : '\n🎉 Todos os testes passaram (0 erros).\n');
  process.exit(failures ? 1 : 0);
})();
