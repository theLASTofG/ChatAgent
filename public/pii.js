'use strict';

// ===========================================================================
// Filtro de privacidade (LGPD): oculta PII óbvia ANTES de o texto sair do aparelho.
// Arquivo separado para o test-smoke.js validar as mesmas regras do navegador.
// Ordem importa: e-mail e documentos longos antes dos curtos, e todos antes
// dos telefones (CNS, CPF e SSN parecem números de telefone).
// ===========================================================================
(function (root) {
  const PII_RULES = [
    [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[EMAIL_OCULTO]'],
    // CNS (Cartão Nacional de Saúde): 15 dígitos começando por 1, 2, 7, 8 ou 9
    [/\b[12789]\d{2}[\s.-]?\d{4}[\s.-]?\d{4}[\s.-]?\d{4}\b/g, '[CNS_OCULTO]'],
    [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[CPF_OCULTO]'],
    // RG: "12.345.678-9", "12.345.678-X" e "MG-12.345.678"
    [/\b\d{1,2}\.\d{3}\.\d{3}-[\dxX]\b/g, '[RG_OCULTO]'],
    [/\b[A-Z]{2}-?\d{1,2}\.\d{3}\.\d{3}\b/g, '[RG_OCULTO]'],
    [/\b\d{3}-\d{2}-\d{4}\b/g, '[DOC_OCULTO]'], // SSN (EUA)
    [/\b\d{2}\.?\d{3}-\d{3}\b/g, '[CEP_OCULTO]'],
    [/(\+?55[\s-]?)?\(?\b\d{2}\)?[\s-]?9?\d{4}[\s-]\d{4}\b/g, '[TEL_OCULTO]'], // Brasil com separador
    [/(\+?55)?\b\d{2}9\d{8}\b/g, '[TEL_OCULTO]'], // celular Brasil sem separador
    [/(\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, '[TEL_OCULTO]'] // EUA/Canadá
  ];
  const DEFAULT_PSEUDONYM = '[CLIENTE_OCULTO]';

  /**
   * Termos do caso: "João Silva, Maria" ou com pseudônimo próprio "João Silva=M., Maria=[MÃE]".
   * Aceita string (vírgula, ponto e vírgula ou quebra de linha) ou lista.
   */
  function parseTerms(customTerms) {
    const raw = Array.isArray(customTerms) ? customTerms : String(customTerms || '').split(/[,;\n]/);
    return raw
      .map((item) => {
        const [term, alias] = String(item).split('=');
        return { term: (term || '').trim(), alias: (alias || '').trim() || DEFAULT_PSEUDONYM };
      })
      .filter((t) => t.term.length >= 2)
      // Termo mais longo primeiro: "João Silva" antes de "João"
      .sort((a, b) => b.term.length - a.term.length);
  }

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function redactTerms(text, customTerms) {
    let out = text;
    for (const { term, alias } of parseTerms(customTerms)) {
      // Limite de palavra com acentos (\b do JS não reconhece "ã", "é"...)
      const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(term).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}_])`, 'giu');
      out = out.replace(re, alias);
    }
    return out;
  }

  /** customTerms é opcional; os nomes do caso são trocados antes das regras de documentos. */
  function redactPII(text, customTerms) {
    let out = redactTerms(String(text || ''), customTerms);
    for (const [re, label] of PII_RULES) out = out.replace(re, label);
    return out;
  }

  const api = { PII_RULES, DEFAULT_PSEUDONYM, parseTerms, redactTerms, redactPII };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PII = api;
})(typeof window !== 'undefined' ? window : globalThis);
