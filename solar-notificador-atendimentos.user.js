// ==UserScript==
// @name         Solar - Notificador de Atendimentos Liberados
// @namespace    solar-tampermonkey-utils
// @version      2.3.0
// @description  Alerta PERMANENTE (balão + som + notificação do SO) em QUALQUER aba aberta do Solar quando surge um novo atendimento na fila "Liberados", com nome do assistido e defensoria, filtrável por defensoria (opcional, desativado por padrão), mesmo sem manter a página de Atendimentos aberta.
// @author       você
// @match        https://solar.defensoria.mg.def.br/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_notification
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  /* ============================================================
   * MÓDULO: Configuração
   * ============================================================ */
  const MODULO = 'Notificador';
  const CONFIG = {
    ATENDIMENTO_URL: 'https://solar.defensoria.mg.def.br/atendimento/',

    POLL_INTERVAL_MS: 30_000,       // frequência da checagem em segundo plano
    LOCK_TTL_MS: 45_000,            // tempo até uma aba "líder" travada ser considerada morta

    IFRAME_LOAD_TIMEOUT_MS: 20_000, // tempo máximo esperando o iframe carregar
    ANGULAR_SETTLE_TIMEOUT_MS: 8_000,  // tempo máximo esperando o Angular terminar de renderizar
    ANGULAR_SETTLE_DEBOUNCE_MS: 800,   // considera "estável" após esse tempo sem mutações no DOM

    MAX_NOMES_NO_TOAST: 3,

    STORAGE_COUNT: 'solarNotif_liberadosCount',
    STORAGE_CONHECIDOS: 'solarNotif_assistidosConhecidos', // snapshot do último ciclo (para diff)
    STORAGE_EVENT: 'solarNotif_event',
    STORAGE_LOCK: 'solarNotif_lock',
    STORAGE_SOUND_ON: 'solarNotif_soundOn',
    STORAGE_FILTRO_ATIVO: 'solarNotif_filtroAtivo',                     // false = notifica tudo, ignorando a lista abaixo
    STORAGE_DEFENSORIAS_CONHECIDAS: 'solarNotif_defensoriasConhecidas', // todas já observadas (para popular a tela de config)
    STORAGE_DEFENSORIAS_FILTRO: 'solarNotif_defensoriasFiltro',         // null/[] = notificar todas (só usado se o filtro estiver ativo)
  };

  const TAB_ID = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

  /* ============================================================
   * MÓDULO: Log padronizado (nunca engolir erros silenciosamente)
   * ============================================================ */
  const log = {
    info: (...args) => console.log(`[Solar Tampermonkey - ${MODULO}]`, ...args),
    warn: (...args) => console.warn(`[Solar Tampermonkey - ${MODULO}]`, ...args),
    error: (...args) => console.error(`[Solar Tampermonkey - ${MODULO}]`, ...args),
  };

  /* ============================================================
   * MÓDULO: Estilos isolados (prefixo próprio, não colide com Bootstrap do Solar)
   * ============================================================ */
  GM_addStyle(`
    .solar-notif-toast-container {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    }
    .solar-notif-toast {
      pointer-events: auto;
      position: relative;
      background: #0b3d2e;
      color: #fff;
      border-left: 5px solid #ffb100;
      border-radius: 6px;
      padding: 14px 30px 14px 16px;
      min-width: 300px;
      max-width: 380px;
      box-shadow: 0 6px 18px rgba(0,0,0,0.28);
      font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      animation: solar-notif-in 0.25s ease-out;
    }
    .solar-notif-toast strong { display: block; margin-bottom: 6px; font-size: 15px; padding-right: 4px; }
    .solar-notif-toast .solar-notif-linha { display: block; }
    .solar-notif-toast-close {
      position: absolute;
      top: 6px;
      right: 8px;
      background: transparent;
      border: none;
      color: #fff;
      opacity: 0.7;
      font-size: 20px;
      line-height: 1;
      cursor: pointer;
      padding: 2px 6px;
    }
    .solar-notif-toast-close:hover { opacity: 1; }
    .solar-notif-toast-abrir {
      display: block;
      margin-top: 12px;
      background: #ffb100;
      color: #0b3d2e;
      border: none;
      border-radius: 5px;
      padding: 7px 14px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }
    .solar-notif-toast-abrir:hover { filter: brightness(1.06); }
    @keyframes solar-notif-in {
      from { transform: translateX(30px); opacity: 0; }
      to   { transform: translateX(0); opacity: 1; }
    }
    .solar-notif-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .solar-notif-modal {
      background: #fff;
      color: #222;
      border-radius: 8px;
      padding: 20px 24px;
      width: 440px;
      max-width: 90vw;
      max-height: 80vh;
      overflow-y: auto;
      font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
    }
    .solar-notif-modal h3 { margin: 0 0 4px; font-size: 17px; color: #0b3d2e; }
    .solar-notif-modal p.solar-notif-hint { margin: 0 0 12px; font-size: 12.5px; color: #777; }
    .solar-notif-check-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 2px;
      font-size: 14px;
      cursor: pointer;
      border-radius: 4px;
    }
    .solar-notif-check-row:hover { background: #f2f2f2; }
    .solar-notif-modal hr { border: none; border-top: 1px solid #e5e5e5; margin: 10px 0; }
    .solar-notif-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    .solar-notif-modal button {
      border: none;
      border-radius: 5px;
      padding: 8px 14px;
      font-size: 13px;
      cursor: pointer;
    }
    .solar-notif-btn-primary { background: #0b3d2e; color: #fff; }
    .solar-notif-btn-secondary { background: #eee; color: #333; }
  `);

  /* ============================================================
   * MÓDULO: UI - Toast (balão de aviso)
   * ============================================================ */
  function ensureToastContainer() {
    if (!document.body) return null; // early return: nada a fazer sem <body>

    let container = document.querySelector('.solar-notif-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'solar-notif-toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  function showToast({ title, linhasHtml, onClick }) {
    const container = ensureToastContainer();
    if (!container) {
      log.warn('Container de toast indisponível; notificação visual pulada nesta aba.');
      return;
    }

    const toast = document.createElement('div');
    toast.className = 'solar-notif-toast';
    toast.innerHTML = `
      <button type="button" class="solar-notif-toast-close" aria-label="Fechar">×</button>
      <strong>${title}</strong>
      ${linhasHtml}
      <button type="button" class="solar-notif-toast-abrir">Abrir Atendimentos</button>
    `;

    // Permanece na tela até o usuário agir - não some sozinho.
    toast.querySelector('.solar-notif-toast-close').addEventListener('click', () => {
      toast.remove();
    });
    toast.querySelector('.solar-notif-toast-abrir').addEventListener('click', () => {
      onClick?.();
      toast.remove();
    });

    container.appendChild(toast);
  }

  /* ============================================================
   * MÓDULO: Som (Web Audio API - não depende de arquivo/rede externa)
   * ============================================================ */
  function isSoundEnabled() {
    return GM_getValue(CONFIG.STORAGE_SOUND_ON, true);
  }

  function playChime() {
    if (!isSoundEnabled()) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      // Acorde ascendente de 3 notas (dó-mi-sol, C5-E5-G5): mais perceptível
      // que a versão anterior de 2 tons, com onda triangular (mais "cheia"
      // que senoidal, mas ainda suave - evita timbre de alarme tipo
      // quadrada/serra) e volume mais alto.
      const notas = [523.25, 659.25, 783.99];

      notas.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.value = 0.0001;
        osc.connect(gain).connect(ctx.destination);

        const start = ctx.currentTime + i * 0.14;
        gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);
        osc.start(start);
        osc.stop(start + 0.6);
      });

      setTimeout(() => ctx.close().catch((error) => log.warn('Falha ao fechar AudioContext', error)), 1400);
    } catch (error) {
      log.warn('Falha ao tocar som de notificação (possível bloqueio de autoplay do navegador)', error);
    }
  }

  /* ============================================================
   * MÓDULO: Filtro de defensorias notificadas
   * ============================================================ */
  function defensoriaInteressa(defensoria) {
    const filtroAtivo = GM_getValue(CONFIG.STORAGE_FILTRO_ATIVO, false);

    // Filtro desativado (padrão de fábrica): notifica tudo, sem exceção.
    if (!filtroAtivo) return true;

    const filtro = GM_getValue(CONFIG.STORAGE_DEFENSORIAS_FILTRO, null);

    // Filtro ativo mas sem seleção ainda (estado inicial ao ativar): notifica tudo.
    if (!filtro || filtro.length === 0) return true;

    // Com filtro ativo e seleção definida, um atendimento sem defensoria
    // legível não é notificado (mais seguro do que arriscar notificar algo
    // fora do que foi pedido).
    if (!defensoria) return false;

    return filtro.includes(defensoria);
  }

  function registrarDefensoriasVistas(atendimentos) {
    const conhecidas = new Set(GM_getValue(CONFIG.STORAGE_DEFENSORIAS_CONHECIDAS, []));
    let houveNovidade = false;

    atendimentos.forEach((a) => {
      if (a.defensoria && !conhecidas.has(a.defensoria)) {
        conhecidas.add(a.defensoria);
        houveNovidade = true;
      }
    });

    if (houveNovidade) {
      GM_setValue(CONFIG.STORAGE_DEFENSORIAS_CONHECIDAS, [...conhecidas].sort((a, b) => a.localeCompare(b, 'pt-BR')));
    }
  }

  function abrirConfigDefensorias() {
    if (!document.body) {
      log.warn('Não foi possível abrir a tela de configuração: <body> indisponível nesta aba.');
      return;
    }

    const filtroAtivo = GM_getValue(CONFIG.STORAGE_FILTRO_ATIVO, false);
    const conhecidas = GM_getValue(CONFIG.STORAGE_DEFENSORIAS_CONHECIDAS, []);
    const filtroAtual = GM_getValue(CONFIG.STORAGE_DEFENSORIAS_FILTRO, null);
    const notificandoTodas = !filtroAtual || filtroAtual.length === 0;

    const backdrop = document.createElement('div');
    backdrop.className = 'solar-notif-modal-backdrop';

    const listaHtml = conhecidas.length > 0
      ? conhecidas.map((d, i) => `
          <label class="solar-notif-check-row">
            <input type="checkbox" data-defensoria-idx="${i}" ${notificandoTodas || filtroAtual.includes(d) ? 'checked' : ''}>
            ${d}
          </label>
        `).join('')
      : '<p class="solar-notif-hint">Nenhuma defensoria capturada ainda. Com o filtro ativado, deixe o script rodar por alguns ciclos (a cada 30s, enquanto houver itens em "Liberados") e abra esta tela de novo.</p>';

    backdrop.innerHTML = `
      <div class="solar-notif-modal">
        <h3>🔔 Filtro de defensorias</h3>
        <label class="solar-notif-check-row" style="font-weight:700;">
          <input type="checkbox" id="solar-notif-filtro-ativo" ${filtroAtivo ? 'checked' : ''}>
          Ativar filtro de defensorias
        </label>
        <p class="solar-notif-hint">Desativado (padrão): todas as defensorias notificam, e nada é capturado. Ativado: o script passa a capturar as defensorias que chegam, e você escolhe quais notificam.</p>
        <hr>
        <div id="solar-notif-bloco-filtro">
          <label class="solar-notif-check-row">
            <input type="checkbox" id="solar-notif-todas">
            Notificar todas (inclusive novas que aparecerem)
          </label>
          <hr>
          <div id="solar-notif-lista">${listaHtml}</div>
        </div>
        <div class="solar-notif-modal-actions">
          <button type="button" class="solar-notif-btn-secondary" id="solar-notif-cancelar">Cancelar</button>
          <button type="button" class="solar-notif-btn-primary" id="solar-notif-salvar">Salvar</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const checkFiltroAtivo = backdrop.querySelector('#solar-notif-filtro-ativo');
    const blocoFiltro = backdrop.querySelector('#solar-notif-bloco-filtro');
    const checkTodas = backdrop.querySelector('#solar-notif-todas');
    checkTodas.checked = notificandoTodas;

    const checksIndividuais = () => Array.from(backdrop.querySelectorAll('[data-defensoria-idx]'));

    const atualizarEstadoGeral = () => {
      const ativo = checkFiltroAtivo.checked;
      blocoFiltro.style.opacity = ativo ? '1' : '0.45';
      checkTodas.disabled = !ativo;
      checksIndividuais().forEach((chk) => { chk.disabled = !ativo || checkTodas.checked; });
    };
    atualizarEstadoGeral();
    checkFiltroAtivo.addEventListener('change', atualizarEstadoGeral);
    checkTodas.addEventListener('change', atualizarEstadoGeral);

    const fechar = () => backdrop.remove();
    backdrop.querySelector('#solar-notif-cancelar').addEventListener('click', fechar);
    backdrop.addEventListener('click', (evento) => { if (evento.target === backdrop) fechar(); });

    backdrop.querySelector('#solar-notif-salvar').addEventListener('click', () => {
      const ativo = checkFiltroAtivo.checked;
      GM_setValue(CONFIG.STORAGE_FILTRO_ATIVO, ativo);

      if (!ativo) {
        log.info('Filtro de defensorias desativado: todas as defensorias voltam a notificar (e a captura para).');
        fechar();
        return;
      }

      if (checkTodas.checked) {
        // Padrão ao ativar: notifica tudo até o usuário desmarcar algo específico.
        GM_setValue(CONFIG.STORAGE_DEFENSORIAS_FILTRO, null);
        log.info('Filtro ativado: notificando todas as defensorias (até você desmarcar alguma individualmente).');
      } else {
        const selecionadas = checksIndividuais()
          .filter((chk) => chk.checked)
          .map((chk) => conhecidas[Number(chk.dataset.defensoriaIdx)]);
        GM_setValue(CONFIG.STORAGE_DEFENSORIAS_FILTRO, selecionadas);
        log.info('Filtro de defensorias salvo:', selecionadas);
      }
      fechar();
    });
  }

  GM_registerMenuCommand('⚙️ Configurar defensorias notificadas', abrirConfigDefensorias);

  /* ============================================================
   * MÓDULO: Eleição de líder entre abas
   * (evita que N abas abertas criem N iframes ocultos ao mesmo tempo)
   * ============================================================ */
  function tentarAssumirLideranca() {
    const lock = GM_getValue(CONFIG.STORAGE_LOCK, null);
    const agora = Date.now();

    const semLiderAtivo = !lock || (agora - lock.ts) > CONFIG.LOCK_TTL_MS;
    const jaSouLider = lock?.id === TAB_ID;

    if (semLiderAtivo || jaSouLider) {
      GM_setValue(CONFIG.STORAGE_LOCK, { id: TAB_ID, ts: agora });
      return true;
    }
    return false;
  }

  /* ============================================================
   * MÓDULO: Iframe oculto (executa o Angular real da aplicação)
   *
   * Por quê: o Solar é uma SPA AngularJS. Os números e listas visíveis
   * (ex.: "Liberados (1)") só existem depois que o Angular roda no
   * navegador e busca os dados via chamada interna - um fetch() simples
   * do HTML não contém esses valores. Este iframe carrega a página de
   * verdade (mesma origem, então cookies de sessão funcionam normalmente),
   * deixa o Angular processar, e só então lemos o DOM resultante.
   * ============================================================ */
  function aguardarRenderizacaoAngular(doc) {
    return new Promise((resolve) => {
      const alvo = doc.body;
      if (!alvo) { resolve(); return; }

      let debounceTimer = null;
      let finalizado = false;

      const finalizar = () => {
        if (finalizado) return;
        finalizado = true;
        observer.disconnect();
        clearTimeout(debounceTimer);
        clearTimeout(timeoutTimer);
        resolve();
      };

      // MutationObserver escopado ao <body> do iframe (não ao document inteiro),
      // com debounce: só consideramos a página "estável" quando param de
      // acontecer mutações por ANGULAR_SETTLE_DEBOUNCE_MS seguidos.
      const observer = new MutationObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(finalizar, CONFIG.ANGULAR_SETTLE_DEBOUNCE_MS);
      });
      observer.observe(alvo, { childList: true, subtree: true, characterData: true });

      // Rede de segurança: nunca ficar esperando indefinidamente caso algo
      // trave ou a página realmente não pare de mudar.
      const timeoutTimer = setTimeout(finalizar, CONFIG.ANGULAR_SETTLE_TIMEOUT_MS);

      // Caso a página já esteja 100% pronta e nenhuma mutação ocorra depois
      // do load, o debounce nunca dispararia sozinho - então também iniciamos
      // um debounce inicial.
      debounceTimer = setTimeout(finalizar, CONFIG.ANGULAR_SETTLE_DEBOUNCE_MS);
    });
  }

  function criarIframeOculto() {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('tabindex', '-1');
    // allow-same-origin + allow-scripts: necessário para o Angular rodar e
    // acessar cookies/sessão. Deixamos de fora allow-forms/allow-popups/
    // allow-top-navigation como camada extra de segurança, já que este
    // iframe é só para leitura em segundo plano.
    iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts');
    iframe.style.cssText = 'position:fixed; top:-9999px; left:-9999px; width:1200px; height:900px; border:0; visibility:hidden;';
    document.body.appendChild(iframe);
    return iframe;
  }

  function buscarDadosLiberadosViaIframe() {
    return new Promise((resolve, reject) => {
      const iframe = criarIframeOculto();
      let finalizado = false;

      const limpar = () => {
        if (finalizado) return;
        finalizado = true;
        iframe.remove();
      };

      const timeoutCarregamento = setTimeout(() => {
        limpar();
        reject(new Error('Timeout ao carregar iframe oculto de Atendimentos (verifique se o Solar bloqueia iframes via X-Frame-Options).'));
      }, CONFIG.IFRAME_LOAD_TIMEOUT_MS);

      iframe.addEventListener('load', async () => {
        try {
          log.info('[diagnóstico] Iframe carregado (evento load disparado). Aguardando Angular estabilizar...');

          const doc = iframe.contentDocument;
          if (!doc) {
            throw new Error('contentDocument inacessível (possível bloqueio de mesma origem).');
          }

          await aguardarRenderizacaoAngular(doc);
          log.info('[diagnóstico] Angular considerado estável (1ª renderização).');

          const linkLiberados = localizarLinkAbaLiberados(doc);
          if (!linkLiberados) {
            throw new Error('Não foi possível localizar a aba "Liberados" no HTML renderizado. O layout do Solar pode ter mudado.');
          }

          // Esta contagem vem de uma expressão Angular auto-contida no próprio
          // link da aba (filtra "liberado:true" direto sobre o array completo),
          // então é confiável independentemente de qual aba estiver ativa.
          const total = extrairContagemDoTexto(linkLiberados.textContent);
          if (total === null) {
            throw new Error('Aba "Liberados" encontrada, mas não foi possível ler a contagem "(N)".');
          }

          // IMPORTANTE: o painel de conteúdo (href da aba) pode ser compartilhado
          // entre as abas Liberados/Agendados/Realizados/Apoios, filtrado
          // dinamicamente por "filtro_atendimento" - variável que só é definida
          // quando a aba é clicada. Como carregamos a página sem nenhum clique
          // real do usuário, NÃO podemos assumir que "Liberados" já é a aba
          // ativa por padrão. Por isso, simulamos o clique aqui antes de ler
          // os cartões individuais.
          linkLiberados.click();
          await aguardarRenderizacaoAngular(doc);
          log.info('[diagnóstico] Aba "Liberados" ativada e re-estabilizada. Extraindo cartões...');

          const idPainel = linkLiberados.getAttribute('href'); // ex.: "#atendimento-marcado"
          const atendimentos = extrairAtendimentosDoPainel(doc, idPainel);

          if (total !== atendimentos.length) {
            log.warn(`Contagem da aba (${total}) difere do número de cartões extraídos (${atendimentos.length}). Pode indicar problema na extração ou no filtro da aba - resultado usado mesmo assim.`);
          }

          const dados = { total, atendimentos };
          log.info('[diagnóstico] Extração concluída:', dados);
          clearTimeout(timeoutCarregamento);
          limpar();
          resolve(dados);
        } catch (error) {
          clearTimeout(timeoutCarregamento);
          limpar();
          reject(error);
        }
      }, { once: true });

      iframe.addEventListener('error', () => {
        clearTimeout(timeoutCarregamento);
        limpar();
        reject(new Error('Falha ao carregar iframe da página de Atendimentos.'));
      }, { once: true });

      log.info('[diagnóstico] Criando iframe oculto e navegando para', CONFIG.ATENDIMENTO_URL);
      iframe.src = CONFIG.ATENDIMENTO_URL;
    });
  }

  /* ============================================================
   * MÓDULO: Extração resiliente de dados do DOM já renderizado
   *
   * Preferimos atributos semânticos (ng-click, href) a classes de
   * apresentação, e usamos regex sobre textContent como fallback -
   * exatamente porque o Solar pode alterar classes/estrutura a qualquer
   * momento (DOM volátil).
   * ============================================================ */
  function localizarLinkAbaLiberados(doc) {
    // Seletor primário: atributo semântico ng-click que expressa a intenção
    // "liberado:true" - mais estável que classes/estilos visuais.
    let link = doc.querySelector('a[data-toggle="tab"][ng-click*="liberado:true"]');

    // Fallback: procura pelo texto visível "Liberados" caso o ng-click mude.
    if (!link) {
      link = Array.from(doc.querySelectorAll('a[data-toggle="tab"]'))
        .find((a) => /Liberados/i.test(a.textContent));
    }
    return link ?? null;
  }

  function extrairContagemDoTexto(texto) {
    const match = texto?.match(/\(\s*(\d+)\s*\)/);
    return match ? Number(match[1]) : null;
  }

  function extrairAtendimentosDoPainel(doc, idPainel) {
    const painel = doc.querySelector(idPainel);
    if (!painel) return [];

    // Cada cartão de atendimento é identificado de forma confiável pelo
    // binding "ng-bind=atendimento.defensoria" - um atributo semântico do
    // Angular, não uma classe de apresentação que pode mudar (ex.: ".media"
    // poderia, em tese, ser reaproveitada em outro componente da tela).
    const nodosDefensoria = painel.querySelectorAll('[ng-bind="atendimento.defensoria"]');

    return Array.from(nodosDefensoria).map((nodoDefensoria) => {
      const cartao = nodoDefensoria.closest('.media');
      if (!cartao) {
        log.warn('Nó de defensoria encontrado fora de um cartão ".media" reconhecível; item ignorado para evitar dado incorreto.');
        return null;
      }

      const nome = cartao.querySelector('h4.media-heading')?.textContent?.trim() || null;
      const numero = cartao.querySelector('[ng-bind*="atendimento.numero"]')?.textContent?.trim() || null;
      const defensoria = nodoDefensoria.textContent?.trim() || null;

      if (!nome) {
        log.warn('Cartão de atendimento sem nome legível (h4.media-heading); item ignorado para evitar notificação incorreta.');
        return null;
      }

      return { nome, numero, defensoria };
    }).filter(Boolean);
  }

  /* ============================================================
   * MÓDULO: Diff entre ciclos (quem é novo desde a última checagem)
   * ============================================================ */
  function construirChavesAtuais(atendimentos) {
    // O número do atendimento (ex.: "260908.010.395") é o identificador mais
    // estável que temos - evita colisão entre assistidos de nomes iguais e
    // corretamente trata "a mesma pessoa, novo atendimento" como um evento novo.
    // Só cai para nome+defensoria se o número não puder ser lido.
    return atendimentos.map((a) => ({
      chave: a.numero || `${a.defensoria ?? ''}::${a.nome}`,
      nome: a.nome,
      defensoria: a.defensoria,
    }));
  }

  /* ============================================================
   * MÓDULO: Ciclo de verificação
   * ============================================================ */
  let verificacaoEmAndamento = false;

  async function verificarNovosAtendimentos() {
    if (!tentarAssumirLideranca()) return; // outra aba já está cuidando desta checagem
    if (verificacaoEmAndamento) return;    // proteção extra contra sobreposição de ciclos lentos
    verificacaoEmAndamento = true;

    try {
      const dados = await buscarDadosLiberadosViaIframe();
      const chavesAtuais = construirChavesAtuais(dados.atendimentos);

      // Alimenta a lista de defensorias conhecidas, usada para popular a
      // tela de configuração - só quando o filtro está ativado (evita
      // acumular dados que não vão ser usados).
      if (GM_getValue(CONFIG.STORAGE_FILTRO_ATIVO, false)) {
        registrarDefensoriasVistas(dados.atendimentos);
      }

      const conhecidosAnteriores = GM_getValue(CONFIG.STORAGE_CONHECIDOS, null);
      GM_setValue(CONFIG.STORAGE_COUNT, dados.total);

      if (conhecidosAnteriores === null) {
        // Primeira execução após instalar: registra baseline sem notificar
        // retroativamente sobre quem já estava esperando.
        GM_setValue(CONFIG.STORAGE_CONHECIDOS, chavesAtuais.map((c) => c.chave));
        log.info(`Baseline inicial registrado: ${dados.total} atendimento(s) em Liberados.`);
        return;
      }

      const setAnterior = new Set(conhecidosAnteriores);
      // Todo mundo novo entra no "conhecidos" (rastreamento), independentemente
      // do filtro - o filtro só decide se GERA notificação, não se é rastreado.
      const novosTodos = chavesAtuais.filter((c) => !setAnterior.has(c.chave));
      const novosNotificaveis = novosTodos.filter((c) => defensoriaInteressa(c.defensoria));

      GM_setValue(CONFIG.STORAGE_CONHECIDOS, chavesAtuais.map((c) => c.chave));

      if (novosTodos.length > 0 && novosNotificaveis.length === 0) {
        log.info(`${novosTodos.length} novo(s) atendimento(s) detectado(s), mas fora do filtro de defensorias configurado - notificação não disparada.`);
      }

      if (novosNotificaveis.length > 0) {
        GM_setValue(CONFIG.STORAGE_EVENT, {
          ts: Date.now(),
          novos: novosNotificaveis.map(({ nome, defensoria }) => ({ nome, defensoria })),
          total: dados.total,
        });
      }
    } catch (error) {
      log.warn('Falha ao verificar novos atendimentos', error);
    } finally {
      verificacaoEmAndamento = false;
    }
  }

  /* ============================================================
   * MÓDULO: Reação ao evento (roda em TODAS as abas simultaneamente)
   * ============================================================ */
  function tratarEventoNovoAtendimento(evento) {
    if (!evento?.novos?.length) return;

    const { novos, total } = evento;
    const titulo = novos.length === 1
      ? 'Novo atendimento liberado!'
      : `${novos.length} novos atendimentos liberados!`;

    const visiveis = novos.slice(0, CONFIG.MAX_NOMES_NO_TOAST);
    const restantes = novos.length - visiveis.length;

    const linhasHtml = visiveis
      .map((n) => `<span class="solar-notif-linha">• ${n.nome}${n.defensoria ? ` — ${n.defensoria}` : ''}</span>`)
      .join('') + (restantes > 0 ? `<span class="solar-notif-linha">e mais ${restantes}...</span>` : '');

    showToast({
      title: titulo,
      linhasHtml,
      onClick: () => window.open(CONFIG.ATENDIMENTO_URL, '_blank'),
    });

    playChime();

    if (typeof GM_notification === 'function') {
      const textoPlano = visiveis
        .map((n) => `${n.nome}${n.defensoria ? ` — ${n.defensoria}` : ''}`)
        .join('\n') + (restantes > 0 ? `\ne mais ${restantes}...` : '') + `\n\nTotal na fila: ${total}`;

      GM_notification({
        title: titulo,
        text: textoPlano,
        timeout: 14000,
        onclick: () => window.open(CONFIG.ATENDIMENTO_URL, '_blank'),
      });
    }
  }

  GM_addValueChangeListener(CONFIG.STORAGE_EVENT, (_nome, _valorAntigo, valorNovo) => {
    tratarEventoNovoAtendimento(valorNovo);
  });

  /* ============================================================
   * MÓDULO: Comandos do menu do Tampermonkey (utilidade/depuração)
   * ============================================================ */
  GM_registerMenuCommand('🔔 Testar notificação agora', () => {
    tratarEventoNovoAtendimento({
      novos: [
        { nome: 'FULANO DE TAL DA SILVA (teste)', defensoria: 'DEFENSORIA DE TESTE (GERAL)' },
      ],
      total: (GM_getValue(CONFIG.STORAGE_COUNT, 0) ?? 0) + 1,
    });
  });

  GM_registerMenuCommand(
    isSoundEnabled() ? '🔇 Desativar som das notificações' : '🔊 Ativar som das notificações',
    () => {
      GM_setValue(CONFIG.STORAGE_SOUND_ON, !isSoundEnabled());
      log.info('Preferência de som alterada. Recarregue a página para o menu refletir o novo estado.');
    }
  );

  GM_registerMenuCommand('♻️ Resetar baseline de contagem', () => {
    // Limpa tanto a contagem total quanto a lista de assistidos conhecidos.
    // Efeito: a PRÓXIMA checagem vira um novo "ponto de partida" silencioso -
    // ela registra quem está na fila agora, mas NÃO dispara notificação para
    // eles (mesmo que já estivessem esperando). Só a partir da checagem
    // seguinte a essa é que novos assistidos voltam a gerar alerta normalmente.
    // Útil se o estado salvo ficou inconsistente (ex.: por um bug de extração)
    // ou durante testes, para "zerar" o histórico sem reinstalar o script.
    GM_setValue(CONFIG.STORAGE_COUNT, null);
    GM_setValue(CONFIG.STORAGE_CONHECIDOS, null);
    log.info('Baseline resetado. A próxima checagem apenas registrará o estado atual, sem notificar.');
  });

  /* ============================================================
   * INICIALIZAÇÃO
   * ============================================================ */
  verificarNovosAtendimentos();
  setInterval(verificarNovosAtendimentos, CONFIG.POLL_INTERVAL_MS);

  log.info(`Monitoramento ativo (checagem a cada ${CONFIG.POLL_INTERVAL_MS / 1000}s, via iframe oculto).`);
})();
