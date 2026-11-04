'use strict';
// ===========================================================================
// Conta opcional (Supabase + Google OAuth)
//
// - Só liga se o servidor expuser SUPABASE_URL e SUPABASE_ANON_KEY em /api/status.
// - O SDK vem do CDN sob demanda (versão fixa + SRI): sem configuração, nada é
//   baixado e o app segue 100% local (localStorage), como antes.
// - A anon key é pública por design; a segurança fica nas políticas RLS (schema.sql).
// ===========================================================================
(function (root) {
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
  const SDK_SRI = 'sha384-0w2KAL2YHP6wKOkUDzkCDGgVvfmHnj02DHeQ6XcHOgTfFsGyonKOpShMH1x6nk9o';

  let client = null;
  let session = null;
  const listeners = new Set();

  function loadSdk() {
    if (root.supabase?.createClient) return Promise.resolve(root.supabase);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SDK_URL;
      s.integrity = SDK_SRI;
      s.crossOrigin = 'anonymous';
      s.referrerPolicy = 'no-referrer';
      s.onload = () => (root.supabase?.createClient ? resolve(root.supabase) : reject(new Error('SDK do Supabase indisponível')));
      s.onerror = () => reject(new Error('Falha ao carregar o SDK do Supabase'));
      document.head.appendChild(s);
    });
  }

  function emit() {
    for (const fn of listeners) { try { fn(session); } catch { /* listener com erro não derruba os outros */ } }
  }

  // Chamado pelo app.js depois de ler /api/status. Sem config = no-op silencioso.
  async function init(config) {
    const url = config?.supabaseUrl;
    const key = config?.supabaseAnonKey;
    if (!url || !key || client) return Boolean(client);
    try {
      const sdk = await loadSdk();
      client = sdk.createClient(url, key, {
        auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      client.auth.onAuthStateChange((_event, s) => {
        session = s;
        emit();
        if (s && (_event === 'SIGNED_IN' || _event === 'INITIAL_SESSION')) {
          client.rpc('touch_usage').then(() => {}, () => {}); // registra last_active
        }
      });
      const { data } = await client.auth.getSession();
      session = data.session;
      emit();
      return true;
    } catch (err) {
      console.warn('[auth] modo local mantido:', err.message);
      client = null;
      return false;
    }
  }

  async function loginWithGoogle() {
    if (!client) throw new Error('Login indisponível: Supabase não configurado');
    const redirectTo = location.origin + location.pathname;
    const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) throw error;
  }

  async function logout() {
    if (!client) return;
    await client.auth.signOut();
    session = null;
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

  // Contadores agregados (sem conteúdo clínico). Falha silenciosa: nunca atrapalha o chat.
  function trackUsage({ chats = 0, clinicalNotes = 0, tokens = 0 } = {}) {
    if (!client || !session) return;
    client.rpc('bump_usage', { p_chats: chats, p_clinical_notes: clinicalNotes, p_tokens: Math.max(0, Math.round(tokens)) })
      .then(() => {}, () => {});
  }

  root.Auth = {
    init, loginWithGoogle, logout, onAuthStateChange, currentUser, trackUsage,
    get enabled() { return Boolean(client); }
  };
})(window);
