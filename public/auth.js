'use strict';
// ===========================================================================
// Conta opcional do Klimbo (Supabase + Google OAuth)
//
// - Só liga se o servidor expuser SUPABASE_URL e SUPABASE_ANON_KEY em /api/status.
// - O SDK vem do CDN sob demanda (versão fixa + SRI): sem configuração, nada é
//   baixado e o app segue 100% local (localStorage), como antes.
// - A anon key é pública por design; a segurança fica nas políticas RLS (schema.sql).
// - Falhas de login viram AuthError com `code` legível: o app mostra um aviso e
//   continua no modo local, sem perder nada.
// ===========================================================================
(function (root) {
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
  const SDK_SRI = 'sha384-0w2KAL2YHP6wKOkUDzkCDGgVvfmHnj02DHeQ6XcHOgTfFsGyonKOpShMH1x6nk9o';
  const SDK_TIMEOUT_MS = 12000;
  const LOGIN_TIMEOUT_MS = 15000;

  let client = null;
  let session = null;
  let sdkPromise = null;
  let redirectError = null; // erro devolvido pelo Google/Supabase na volta do OAuth
  let adminCache = { uid: null, value: false };
  const listeners = new Set();

  // --- Erros legíveis -------------------------------------------------------
  const MESSAGES = {
    cancelled: 'Login cancelado. Você continua no modo local, com tudo salvo neste aparelho.',
    offline: 'Sem conexão para entrar com Google. O Klimbo segue funcionando offline.',
    network: 'Falha de rede ao falar com o login. Tente de novo em instantes; seus dados locais estão intactos.',
    timeout: 'O login demorou demais para responder. Tente de novo; nada foi perdido.',
    sdk: 'Não foi possível carregar o módulo de login. Verifique a conexão ou bloqueadores de conteúdo.',
    config: 'Login indisponível: a conta Google não está configurada neste servidor.',
    provider: 'O Google recusou o login. Confira a conta escolhida e tente de novo.',
    exchange: 'Não foi possível concluir o login. Tente entrar de novo pelo mesmo navegador.',
    unknown: 'Não foi possível entrar agora. Você continua no modo local.'
  };

  class AuthError extends Error {
    constructor(code, detail) {
      super(MESSAGES[code] || MESSAGES.unknown);
      this.name = 'AuthError';
      this.code = MESSAGES[code] ? code : 'unknown';
      if (detail) this.detail = String(detail).slice(0, 300);
    }
  }

  // Converte qualquer falha (SDK, rede, OAuth) num AuthError com mensagem amigável
  function toAuthError(err, fallback = 'unknown') {
    if (err instanceof AuthError) return err;
    const raw = `${err?.code || ''} ${err?.name || ''} ${err?.message || err || ''}`.toLowerCase();
    if (root.navigator && root.navigator.onLine === false) return new AuthError('offline', raw);
    if (/access_denied|cancel|closed|user denied/.test(raw)) return new AuthError('cancelled', raw);
    if (/timeout|timed out|abort/.test(raw)) return new AuthError('timeout', raw);
    if (/failed to fetch|network|load failed|err_internet|fetch/.test(raw)) return new AuthError('network', raw);
    if (/code verifier|flow state|pkce|invalid_grant|exchange/.test(raw)) return new AuthError('exchange', raw);
    if (/provider|oauth|unauthorized_client|server_error|invalid_request/.test(raw)) return new AuthError('provider', raw);
    return new AuthError(fallback, raw);
  }

  function withTimeout(promise, ms, code = 'timeout') {
    let t;
    return Promise.race([
      promise,
      new Promise((_, reject) => { t = setTimeout(() => reject(new AuthError(code)), ms); })
    ]).finally(() => clearTimeout(t));
  }

  // Na volta do Google, erros chegam como ?error=...&error_description=... (PKCE)
  // ou no #hash (fluxo implícito). Lê, guarda e limpa a URL para não repetir.
  function captureRedirectError() {
    try {
      const q = new URLSearchParams(root.location.search);
      const h = new URLSearchParams(root.location.hash.replace(/^#/, ''));
      const code = q.get('error') || h.get('error');
      if (!code) return;
      const desc = q.get('error_description') || h.get('error_description') || '';
      redirectError = toAuthError({ code, message: `${code} ${q.get('error_code') || h.get('error_code') || ''} ${desc}` }, 'provider');
      const url = new URL(root.location.href);
      for (const k of ['error', 'error_code', 'error_description', 'code', 'state']) url.searchParams.delete(k);
      root.history.replaceState(root.history.state, '', url.pathname + url.search);
    } catch { /* URL estranha: ignora */ }
  }

  // --- SDK -------------------------------------------------------------------
  function loadSdk() {
    if (root.supabase?.createClient) return Promise.resolve(root.supabase);
    if (sdkPromise) return sdkPromise;
    const p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SDK_URL;
      s.integrity = SDK_SRI;
      s.crossOrigin = 'anonymous';
      s.referrerPolicy = 'no-referrer';
      s.onload = () => (root.supabase?.createClient ? resolve(root.supabase) : reject(new AuthError('sdk')));
      s.onerror = () => { s.remove(); reject(new AuthError(root.navigator?.onLine === false ? 'offline' : 'sdk')); };
      document.head.appendChild(s);
    });
    sdkPromise = withTimeout(p, SDK_TIMEOUT_MS).catch((err) => { sdkPromise = null; throw err; }); // permite tentar de novo
    return sdkPromise;
  }

  function emit() {
    for (const fn of listeners) { try { fn(session); } catch { /* listener com erro não derruba os outros */ } }
  }

  let lastConfig = null;
  // Chamado pelo app.js depois de ler /api/status. Sem config = no-op silencioso.
  // Retorna true se o login ficou disponível. Pode ser chamado de novo (ex.: voltou a internet).
  async function init(config) {
    const url = config?.supabaseUrl;
    const key = config?.supabaseAnonKey;
    if (!url || !key) return false;
    if (client) return true;
    lastConfig = config;
    if (redirectError === null) captureRedirectError();
    const hadCode = new URLSearchParams(root.location.search).has('code');
    try {
      const sdk = await loadSdk();
      client = sdk.createClient(url, key, {
        auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      client.auth.onAuthStateChange((event, s) => {
        session = s;
        if (!s) adminCache = { uid: null, value: false };
        emit();
        if (s && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
          client.rpc('touch_usage').then(() => {}, () => {}); // registra last_active
        }
      });
      const { data, error } = await withTimeout(client.auth.getSession(), LOGIN_TIMEOUT_MS);
      session = data?.session || null;
      // Voltou do Google com ?code= mas a troca pelo token falhou
      if (!session && hadCode && !redirectError) redirectError = toAuthError(error || 'exchange', 'exchange');
      emit();
      return true;
    } catch (err) {
      console.warn('[auth] modo local mantido:', err?.message || err);
      client = null;
      return false;
    }
  }

  // Erro pendente da volta do OAuth (uma vez só). O app mostra como aviso.
  function takeRedirectError() {
    const e = redirectError;
    redirectError = undefined; // undefined = já consumido; não reler a URL
    return e || null;
  }

  async function loginWithGoogle() {
    if (root.navigator && root.navigator.onLine === false) throw new AuthError('offline');
    if (!client && lastConfig && !(await init(lastConfig))) throw new AuthError(root.navigator?.onLine === false ? 'offline' : 'sdk');
    if (!client) throw new AuthError('config');
    try {
      const redirectTo = root.location.origin + root.location.pathname;
      const { error } = await withTimeout(
        client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } }),
        LOGIN_TIMEOUT_MS
      );
      if (error) throw error;
      // Sucesso = o navegador vai para o Google. Se nada acontecer, o app reabilita o botão.
    } catch (err) {
      throw toAuthError(err);
    }
  }

  async function logout() {
    if (!client) return;
    try {
      await withTimeout(client.auth.signOut(), LOGIN_TIMEOUT_MS);
    } catch {
      // Sem rede: encerra ao menos a sessão deste aparelho
      try { await client.auth.signOut({ scope: 'local' }); } catch { /* segue */ }
    }
    session = null;
    adminCache = { uid: null, value: false };
    emit();
  }

  // Assina mudanças de sessão. Retorna a função para cancelar.
  function onAuthStateChange(fn) {
    listeners.add(fn);
    fn(session);
    return () => listeners.delete(fn);
  }

  function currentUser() {
    const u = session?.user;
    if (!u) return null;
    const meta = u.user_metadata || {};
    return { id: u.id, email: u.email, name: meta.full_name || meta.name || u.email, avatar: meta.avatar_url || meta.picture || null };
  }

  // Papel admin vem do banco (is_admin() lê profiles.role com RLS). Só decide
  // se o botão aparece: a RPC de métricas confere de novo no servidor.
  async function isAdmin() {
    const uid = session?.user?.id;
    if (!client || !uid) return false;
    if (adminCache.uid === uid) return adminCache.value;
    try {
      const { data, error } = await withTimeout(client.rpc('is_admin'), LOGIN_TIMEOUT_MS);
      if (error) throw error;
      adminCache = { uid, value: data === true };
    } catch {
      return false; // sem cache: tenta de novo na próxima
    }
    return adminCache.value;
  }

  // Totais agregados da plataforma. Nenhuma linha individual ou conteúdo clínico.
  async function adminUsageTotals() {
    if (!client || !session) throw new AuthError('config');
    const { data, error } = await withTimeout(client.rpc('admin_usage_totals'), LOGIN_TIMEOUT_MS);
    if (error) {
      if (/restrito|admin|permission|42501/i.test(`${error.message} ${error.code}`)) {
        adminCache = { uid: session.user.id, value: false };
        const e = new Error('Acesso restrito ao administrador do Klimbo.');
        e.code = 'forbidden';
        throw e;
      }
      throw toAuthError(error, 'network');
    }
    const row = Array.isArray(data) ? data[0] : data;
    const n = (v) => Math.max(0, Number(v) || 0);
    return {
      totalUsers: n(row?.total_users),
      activeLast7d: n(row?.active_last_7d),
      activeLast30d: n(row?.active_last_30d),
      totalChats: n(row?.total_chats),
      clinicalNotes: n(row?.clinical_notes),
      tokensEstimated: n(row?.tokens_estimated),
      backedUpSessions: n(row?.backed_up_sessions)
    };
  }

  // Contadores agregados (sem conteúdo clínico). Falha silenciosa: nunca atrapalha o chat.
  function trackUsage({ chats = 0, clinicalNotes = 0, tokens = 0 } = {}) {
    if (!client || !session) return;
    client.rpc('bump_usage', { p_chats: chats, p_clinical_notes: clinicalNotes, p_tokens: Math.max(0, Math.round(tokens)) })
      .then(() => {}, () => {});
  }

  root.Auth = {
    init, loginWithGoogle, logout, onAuthStateChange, currentUser, trackUsage,
    isAdmin, adminUsageTotals, takeRedirectError, toAuthError, AuthError,
    get enabled() { return Boolean(client); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
