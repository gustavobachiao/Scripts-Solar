// ==UserScript==
// @name         Solar - Notificador de Atendimentos Liberados (via API)
// @namespace    solar-tampermonkey-utils
// @version      1.1.0
// @description  Alerta PERMANENTE (balão + som + notificação do SO) em QUALQUER aba aberta do Solar quando surge um novo atendimento na fila "Liberados", com nome do assistido e defensoria, filtrável por defensoria (opcional, desativado por padrão). Versão otimizada: consulta a API JSON diretamente (fetch), sem iframe/Angular - mais leve e rápida que a versão original. Script independente, pode rodar ao lado da versão via iframe para comparação.
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
  const MODULO = 'Notificador API';
  const CONFIG = {
    ATENDIMENTO_PAGINA_URL: 'https://solar.defensoria.mg.def.br/atendimento/',
    API_LISTA_URL: 'https://solar.defensoria.mg.def.br/atendimento/index/get/',

    // Defensoria usada exclusivamente para emissão de senha pela recepção.
    // Tem liberado:true mas NÃO deve contar como "liberado de verdade" -
    // confirmado com o usuário: 11 registros bateram exatamente com o
    // número de senhas emitidas no dia.
    DEFENSORIA_TRIAGEM_EXCLUIR: 'TRIAGEM PASSOS',

    POLL_INTERVAL_MS: 30_000,
    LOCK_TTL_MS: 45_000,

    TOAST_DURATION_MS: 18_000,
    MAX_NOMES_NO_TOAST: 3,

    // Prefixo DIFERENTE da versão iframe (solarNotif_) de propósito, para
    // que os dois scripts possam rodar ao mesmo tempo na mesma máquina,
    // com estados independentes, sem um bagunçar o histórico do outro.
    STORAGE_COUNT: 'solarNotifApi_liberadosCount',
    STORAGE_CONHECIDOS: 'solarNotifApi_assistidosConhecidos',
    STORAGE_EVENT: 'solarNotifApi_event',
    STORAGE_LOCK: 'solarNotifApi_lock',
    STORAGE_SOUND_ON: 'solarNotifApi_soundOn',
    STORAGE_FILTRO_ATIVO: 'solarNotifApi_filtroAtivo',
    STORAGE_DEFENSORIAS_CONHECIDAS: 'solarNotifApi_defensoriasConhecidas',
    STORAGE_DEFENSORIAS_FILTRO: 'solarNotifApi_defensoriasFiltro',
  };

  const TAB_ID = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

  /* ============================================================
   * MÓDULO: Log padronizado
   * ============================================================ */
  const log = {
    info: (...args) => console.log(`[Solar Tampermonkey - ${MODULO}]`, ...args),
    warn: (...args) => console.warn(`[Solar Tampermonkey - ${MODULO}]`, ...args),
    error: (...args) => console.error(`[Solar Tampermonkey - ${MODULO}]`, ...args),
  };

  /* ============================================================
   * MÓDULO: Estilos isolados
   * ============================================================ */
  GM_addStyle(`
    .solar-notif-api-toast-container {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    }
    .solar-notif-api-toast {
      pointer-events: auto;
      position: relative;
      background: #0b3d2e;
      color: #fff;
      border-left: 5px solid #2ea3ff;
      border-radius: 6px;
      padding: 14px 30px 14px 16px;
      min-width: 300px;
      max-width: 380px;
      box-shadow: 0 6px 18px rgba(0,0,0,0.28);
      font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      animation: solar-notif-api-in 0.25s ease-out;
    }
    .solar-notif-api-toast strong { display: block; margin-bottom: 6px; font-size: 15px; padding-right: 4px; }
    .solar-notif-api-toast .solar-notif-api-linha { display: block; }
    .solar-notif-api-toast-close {
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
    .solar-notif-api-toast-close:hover { opacity: 1; }
    .solar-notif-api-toast-abrir {
      display: block;
      margin-top: 12px;
      background: #2ea3ff;
      color: #0b1f33;
      border: none;
      border-radius: 5px;
      padding: 7px 14px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }
    .solar-notif-api-toast-abrir:hover { filter: brightness(1.06); }
    @keyframes solar-notif-api-in {
      from { transform: translateX(30px); opacity: 0; }
      to   { transform: translateX(0); opacity: 1; }
    }
    .solar-notif-api-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .solar-notif-api-modal {
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
    .solar-notif-api-modal h3 { margin: 0 0 4px; font-size: 17px; color: #0b3d2e; }
    .solar-notif-api-modal p.solar-notif-api-hint { margin: 0 0 12px; font-size: 12.5px; color: #777; }
    .solar-notif-api-check-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 2px;
      font-size: 14px;
      cursor: pointer;
      border-radius: 4px;
    }
    .solar-notif-api-check-row:hover { background: #f2f2f2; }
    .solar-notif-api-modal hr { border: none; border-top: 1px solid #e5e5e5; margin: 10px 0; }
    .solar-notif-api-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    .solar-notif-api-modal button { border: none; border-radius: 5px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
    .solar-notif-api-btn-primary { background: #0b3d2e; color: #fff; }
    .solar-notif-api-btn-secondary { background: #eee; color: #333; }
  `);

  /* ============================================================
   * MÓDULO: UI - Toast
   * ============================================================ */
  function ensureToastContainer() {
    if (!document.body) return null;
    let container = document.querySelector('.solar-notif-api-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'solar-notif-api-toast-container';
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
    toast.className = 'solar-notif-api-toast';
    toast.innerHTML = `
      <button type="button" class="solar-notif-api-toast-close" aria-label="Fechar">×</button>
      <strong>${title}</strong>
      ${linhasHtml}
      <button type="button" class="solar-notif-api-toast-abrir">Abrir Atendimentos</button>
    `;

    // Permanece na tela até o usuário agir - não some sozinho.
    toast.querySelector('.solar-notif-api-toast-close').addEventListener('click', () => {
      toast.remove();
    });
    toast.querySelector('.solar-notif-api-toast-abrir').addEventListener('click', () => {
      onClick?.();
      toast.remove();
    });

    container.appendChild(toast);
  }

  /* ============================================================
   * MÓDULO: Som
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
      // que a versão anterior, com onda triangular (mais "cheia" que
      // senoidal, sem soar como alarme) e volume mais alto.
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
    if (!filtroAtivo) return true;

    const filtro = GM_getValue(CONFIG.STORAGE_DEFENSORIAS_FILTRO, null);
    if (!filtro || filtro.length === 0) return true;
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
    backdrop.className = 'solar-notif-api-modal-backdrop';

    const listaHtml = conhecidas.length > 0
      ? conhecidas.map((d, i) => `
          <label class="solar-notif-api-check-row">
            <input type="checkbox" data-defensoria-idx="${i}" ${notificandoTodas || filtroAtual.includes(d) ? 'checked' : ''}>
            ${d}
          </label>
        `).join('')
      : '<p class="solar-notif-api-hint">Nenhuma defensoria capturada ainda. Com o filtro ativado, deixe o script rodar por alguns ciclos e abra esta tela de novo.</p>';

    backdrop.innerHTML = `
      <div class="solar-notif-api-modal">
        <h3>🔔 Filtro de defensorias (API)</h3>
        <label class="solar-notif-api-check-row" style="font-weight:700;">
          <input type="checkbox" id="solar-notif-api-filtro-ativo" ${filtroAtivo ? 'checked' : ''}>
          Ativar filtro de defensorias
        </label>
        <p class="solar-notif-api-hint">Desativado (padrão): todas as defensorias notificam, e nada é capturado. Ativado: o script passa a capturar as defensorias que chegam, e você escolhe quais notificam.</p>
        <hr>
        <div id="solar-notif-api-bloco-filtro">
          <label class="solar-notif-api-check-row">
            <input type="checkbox" id="solar-notif-api-todas">
            Notificar todas (inclusive novas que aparecerem)
          </label>
          <hr>
          <div id="solar-notif-api-lista">${listaHtml}</div>
        </div>
        <div class="solar-notif-api-modal-actions">
          <button type="button" class="solar-notif-api-btn-secondary" id="solar-notif-api-cancelar">Cancelar</button>
          <button type="button" class="solar-notif-api-btn-primary" id="solar-notif-api-salvar">Salvar</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const checkFiltroAtivo = backdrop.querySelector('#solar-notif-api-filtro-ativo');
    const blocoFiltro = backdrop.querySelector('#solar-notif-api-bloco-filtro');
    const checkTodas = backdrop.querySelector('#solar-notif-api-todas');
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
    backdrop.querySelector('#solar-notif-api-cancelar').addEventListener('click', fechar);
    backdrop.addEventListener('click', (evento) => { if (evento.target === backdrop) fechar(); });

    backdrop.querySelector('#solar-notif-api-salvar').addEventListener('click', () => {
      const ativo = checkFiltroAtivo.checked;
      GM_setValue(CONFIG.STORAGE_FILTRO_ATIVO, ativo);

      if (!ativo) {
        log.info('Filtro de defensorias desativado: todas as defensorias voltam a notificar (e a captura para).');
        fechar();
        return;
      }

      if (checkTodas.checked) {
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

  GM_registerMenuCommand('⚙️ Configurar defensorias notificadas (API)', abrirConfigDefensorias);

  /* ============================================================
   * MÓDULO: Eleição de líder entre abas
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
   * MÓDULO: Acesso direto à API JSON (sem iframe, sem Angular)
   *
   * O backend (Django, a julgar pelo header X-CSRFToken) exige esse
   * token em todo POST. O Django guarda o mesmo valor num cookie
   * "csrftoken" de propósito, justamente para o frontend conseguir
   * lê-lo via JavaScript e ecoá-lo no header - não é um segredo a
   * descobrir, é o mecanismo de proteção funcionando como projetado.
   * ============================================================ */
  function lerCookie(nome) {
    const match = document.cookie.match(new RegExp('(?:^|; )' + nome + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  async function buscarDadosLiberadosViaAPI() {
    const csrfToken = lerCookie('csrftoken');
    if (!csrfToken) {
      throw new Error('Cookie "csrftoken" não encontrado nesta aba - não é possível montar o header X-CSRFToken exigido pela API. Confirme se está logado no Solar nesta aba/navegador.');
    }

    const resposta = await fetch(CONFIG.API_LISTA_URL, {
      method: 'POST',
      credentials: 'same-origin', // reaproveita cookies de sessão automaticamente
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json;charset=utf-8',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRFToken': csrfToken,
      },
      body: JSON.stringify({ data: new Date().toISOString() }),
    });

    if (!resposta.ok) {
      throw new Error(`Resposta HTTP ${resposta.status} ao consultar a API de atendimentos.`);
    }

    const bruto = await resposta.json();
    if (!Array.isArray(bruto)) {
      throw new Error('Resposta da API não é uma lista (formato pode ter mudado desde a última verificação).');
    }

    // Regra de negócio confirmada: liberado:true sozinho inclui também
    // senhas de TRIAGEM PASSOS emitidas pela recepção, que NÃO devem gerar
    // notificação. O sinal confiável de "realmente pronto para o defensor"
    // é liberado:true + data_atendimento_recepcao preenchido.
    const liberadosDeVerdade = bruto.filter((item) =>
      item?.liberado === true
      && Boolean(item?.data_atendimento_recepcao)
      && item?.defensoria !== CONFIG.DEFENSORIA_TRIAGEM_EXCLUIR
    );

    const atendimentos = liberadosDeVerdade.map((item) => ({
      nome: item.requerente || item.requerente_nome_social || '(sem nome informado)',
      numero: item.numero != null ? String(item.numero) : null,
      defensoria: item.defensoria ?? null,
    }));

    return { total: atendimentos.length, atendimentos };
  }

  /* ============================================================
   * MÓDULO: Diff entre ciclos
   * ============================================================ */
  function construirChavesAtuais(atendimentos) {
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
    if (!tentarAssumirLideranca()) return;
    if (verificacaoEmAndamento) return;
    verificacaoEmAndamento = true;

    try {
      const dados = await buscarDadosLiberadosViaAPI();
      const chavesAtuais = construirChavesAtuais(dados.atendimentos);

      if (GM_getValue(CONFIG.STORAGE_FILTRO_ATIVO, false)) {
        registrarDefensoriasVistas(dados.atendimentos);
      }

      const conhecidosAnteriores = GM_getValue(CONFIG.STORAGE_CONHECIDOS, null);
      GM_setValue(CONFIG.STORAGE_COUNT, dados.total);

      if (conhecidosAnteriores === null) {
        GM_setValue(CONFIG.STORAGE_CONHECIDOS, chavesAtuais.map((c) => c.chave));
        log.info(`Baseline inicial registrado: ${dados.total} atendimento(s) em Liberados.`);
        return;
      }

      const setAnterior = new Set(conhecidosAnteriores);
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
   * MÓDULO: Reação ao evento (todas as abas)
   * ============================================================ */
  function tratarEventoNovoAtendimento(evento) {
    if (!evento?.novos?.length) return;

    const { novos, total } = evento;
    const titulo = novos.length === 1
      ? 'Novo atendimento liberado! (via API)'
      : `${novos.length} novos atendimentos liberados! (via API)`;

    const visiveis = novos.slice(0, CONFIG.MAX_NOMES_NO_TOAST);
    const restantes = novos.length - visiveis.length;

    const linhasHtml = visiveis
      .map((n) => `<span class="solar-notif-api-linha">• ${n.nome}${n.defensoria ? ` — ${n.defensoria}` : ''}</span>`)
      .join('') + (restantes > 0 ? `<span class="solar-notif-api-linha">e mais ${restantes}...</span>` : '');

    showToast({
      title: titulo,
      linhasHtml,
      onClick: () => window.open(CONFIG.ATENDIMENTO_PAGINA_URL, '_blank'),
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
        onclick: () => window.open(CONFIG.ATENDIMENTO_PAGINA_URL, '_blank'),
      });
    }
  }

  GM_addValueChangeListener(CONFIG.STORAGE_EVENT, (_nome, _valorAntigo, valorNovo) => {
    tratarEventoNovoAtendimento(valorNovo);
  });

  /* ============================================================
   * MÓDULO: Comandos do menu do Tampermonkey
   * ============================================================ */
  GM_registerMenuCommand('🔔 Testar notificação agora (API)', () => {
    tratarEventoNovoAtendimento({
      novos: [
        { nome: 'FULANO DE TAL DA SILVA (teste)', defensoria: 'DEFENSORIA DE TESTE (GERAL)' },
      ],
      total: (GM_getValue(CONFIG.STORAGE_COUNT, 0) ?? 0) + 1,
    });
  });

  GM_registerMenuCommand(
    isSoundEnabled() ? '🔇 Desativar som (API)' : '🔊 Ativar som (API)',
    () => {
      GM_setValue(CONFIG.STORAGE_SOUND_ON, !isSoundEnabled());
      log.info('Preferência de som alterada. Recarregue a página para o menu refletir o novo estado.');
    }
  );

  GM_registerMenuCommand('♻️ Resetar baseline de contagem (API)', () => {
    GM_setValue(CONFIG.STORAGE_COUNT, null);
    GM_setValue(CONFIG.STORAGE_CONHECIDOS, null);
    log.info('Baseline resetado. A próxima checagem apenas registrará o estado atual, sem notificar.');
  });

  /* ============================================================
   * INICIALIZAÇÃO
   * ============================================================ */
  verificarNovosAtendimentos();
  setInterval(verificarNovosAtendimentos, CONFIG.POLL_INTERVAL_MS);

  log.info(`Monitoramento ativo (checagem a cada ${CONFIG.POLL_INTERVAL_MS / 1000}s, via fetch direto à API - sem iframe/Angular).`);
})();
