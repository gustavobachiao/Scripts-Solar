// ==UserScript==
// @name         Solar - Notificador de Atendimentos Liberados (via API)
// @namespace    solar-tampermonkey-utils
// @version      1.2.0
// @description  Alerta PERMANENTE (balão + som + notificação do SO) em QUALQUER aba aberta do Solar quando surge um novo atendimento na fila "Liberados", com nome do assistido e defensoria, filtrável por defensoria (opcional, desativado por padrão). Versão otimizada: consulta a API JSON diretamente (fetch), sem iframe/Angular - mais leve e rápida que a versão original. Script independente, pode rodar ao lado da versão via iframe para comparação.
// @author       Defensoria Publica de Minas Gerais - Unidade de Passos
// @match        https://solar.defensoria.mg.def.br/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_notification
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/gustavobachiao/Scripts-Solar/main/Solar-notificador-atendimentos-api.user.js
// @downloadURL  https://raw.githubusercontent.com/gustavobachiao/Scripts-Solar/main/Solar-notificador-atendimentos-api.user.js
// @homepageURL  https://github.com/gustavobachiao/Scripts-Solar
// @supportURL   https://github.com/gustavobachiao/Scripts-Solar/issues
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
    // Tem liberado:true mas NÃO deve contar como "liberado de verdade".
    DEFENSORIA_TRIAGEM_EXCLUIR: 'TRIAGEM PASSOS',

    POLL_INTERVAL_MS: 30_000,
    LOCK_TTL_MS: 45_000,
    // Após "vencer" a corrida pela liderança, espera um pouco e reconfirma
    // que ninguém mais escreveu por cima - reduz drasticamente a chance de
    // duas abas se declararem líderes na mesma rodada (ex.: ao abrir duas
    // abas do Solar quase ao mesmo tempo).
    LOCK_CONFIRMACAO_MIN_MS: 250,
    LOCK_CONFIRMACAO_JITTER_MS: 250,

    MAX_NOMES_NO_TOAST: 3,

    ALERTA_DEMORA_MINUTOS_PADRAO: 30,   // liberado, ninguém clicou em "Atender" ainda
    ALERTA_ESQUECEU_MINUTOS_PADRAO: 60, // clicou em "Atender", mas não finalizou (realizado ainda false)

    // O backend do Solar emite os timestamps já em horário local de Brasília
    // (UTC-3), mas com o sufixo "Z" do ISO 8601 (que tecnicamente indica
    // UTC). O JavaScript confia no "Z" e interpreta a hora como 3h
    // adiantada do que realmente é. Corrigimos somando de volta essas 3h.
    // Só é válido enquanto o Solar for usado com horário de Brasília
    // (UTC-3, sem horário de verão, que o Brasil não usa desde 2019).
    CORRECAO_FUSO_BACKEND_MS: 3 * 60 * 60 * 1000,

    // Espalha a primeira checagem de cada aba num atraso aleatório, para
    // reduzir a chance de duas abas abertas quase ao mesmo tempo colidirem
    // na eleição de líder logo na largada.
    PRIMEIRA_CHECAGEM_JITTER_MAX_MS: 3_000,

    STORAGE_COUNT: 'solarNotifApi_liberadosCount',
    STORAGE_CONHECIDOS: 'solarNotifApi_assistidosConhecidos',
    STORAGE_EVENT: 'solarNotifApi_event',

    STORAGE_EVENT_DEMORA: 'solarNotifApi_eventDemora',
    STORAGE_ALERTA_DEMORA_ENVIADOS: 'solarNotifApi_alertaDemoraEnviados',
    STORAGE_ALERTA_DEMORA_ATIVO: 'solarNotifApi_alertaDemoraAtivo',     // true = ligado por padrão
    STORAGE_ALERTA_DEMORA_MINUTOS: 'solarNotifApi_alertaDemoraMinutos', // configurável, padrão 30

    STORAGE_EVENT_ESQUECEU: 'solarNotifApi_eventEsqueceu',
    STORAGE_ALERTA_ESQUECEU_ENVIADOS: 'solarNotifApi_alertaEsqueceuEnviados',
    STORAGE_ALERTA_ESQUECEU_ATIVO: 'solarNotifApi_alertaEsqueceuAtivo',     // true = ligado por padrão
    STORAGE_ALERTA_ESQUECEU_MINUTOS: 'solarNotifApi_alertaEsqueceuMinutos', // configurável, padrão 60

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
    .solar-notif-api-toast-urgente {
      background: #4a0e0e;
      border-left-color: #e03131;
    }
    .solar-notif-api-toast strong { display: block; margin-bottom: 6px; font-size: 15px; padding-right: 4px; }
    .solar-notif-api-toast .solar-notif-api-linha { display: block; }
    .solar-notif-api-toast .solar-notif-api-linha-total { display: block; margin-top: 8px; opacity: 0.85; font-size: 13px; }
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
    .solar-notif-api-toast-urgente .solar-notif-api-toast-abrir { background: #e03131; color: #fff; }
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
      width: 460px;
      max-width: 90vw;
      max-height: 82vh;
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
      border-radius: 4px;
    }
    .solar-notif-api-check-row label { cursor: pointer; }
    .solar-notif-api-check-row:hover { background: #f2f2f2; }
    .solar-notif-api-modal hr { border: none; border-top: 1px solid #e5e5e5; margin: 10px 0; }
    .solar-notif-api-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    .solar-notif-api-modal button { border: none; border-radius: 5px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
    .solar-notif-api-btn-primary { background: #0b3d2e; color: #fff; }
    .solar-notif-api-btn-secondary { background: #eee; color: #333; }
    .solar-notif-api-input-nome {
      flex: 1;
      padding: 7px 9px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 13px;
    }
    .solar-notif-api-btn-remover {
      background: transparent;
      border: none;
      color: #c00;
      cursor: pointer;
      font-size: 17px;
      line-height: 1;
      padding: 0 6px;
    }
    .solar-notif-api-btn-remover:hover { color: #900; }
  `);

  /* ============================================================
   * MÓDULO: UI - Toast (permanente até o usuário fechar ou abrir)
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

  function showToast({ title, linhasHtml, onClick, urgente = false }) {
    const container = ensureToastContainer();
    if (!container) {
      log.warn('Container de toast indisponível; notificação visual pulada nesta aba.');
      return;
    }

    const toast = document.createElement('div');
    toast.className = urgente ? 'solar-notif-api-toast solar-notif-api-toast-urgente' : 'solar-notif-api-toast';
    toast.innerHTML = `
      <button type="button" class="solar-notif-api-toast-close" aria-label="Fechar">×</button>
      <strong>${title}</strong>
      ${linhasHtml}
      <button type="button" class="solar-notif-api-toast-abrir">Abrir Atendimentos</button>
    `;

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
      const notas = [523.25, 659.25, 783.99]; // C5-E5-G5, onda triangular
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
   * MÓDULO: Utilitário - formatação de duração
   * ============================================================ */
  function formatarDuracao(minutos) {
    if (minutos < 60) return `${minutos} minuto${minutos === 1 ? '' : 's'}`;
    const horas = Math.floor(minutos / 60);
    const min = minutos % 60;
    return `${horas}h${min > 0 ? String(min).padStart(2, '0') + 'min' : ''}`;
  }

  /* ============================================================
   * MÓDULO: Filtro de defensorias notificadas
   * ============================================================ */
  function defensoriaInteressa(defensoria) {
    const filtroAtivo = GM_getValue(CONFIG.STORAGE_FILTRO_ATIVO, false);
    if (!filtroAtivo) return true; // padrão de fábrica: notifica tudo

    const filtro = GM_getValue(CONFIG.STORAGE_DEFENSORIAS_FILTRO, null);
    if (!filtro || filtro.length === 0) return true; // filtro ativo, sem seleção ainda: notifica tudo
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
    // Cópia local mutável - só é persistida definitivamente ao clicar em Salvar
    // (exceto a lista de "conhecidas", que já persiste a cada adição/remoção,
    // para não perder o que foi digitado se o usuário fechar sem salvar).
    let conhecidas = GM_getValue(CONFIG.STORAGE_DEFENSORIAS_CONHECIDAS, []).slice();
    const filtroSalvo = GM_getValue(CONFIG.STORAGE_DEFENSORIAS_FILTRO, null);
    const notificandoTodasInicial = !filtroSalvo || filtroSalvo.length === 0;
    const selecionadas = new Set(notificandoTodasInicial ? conhecidas : filtroSalvo);

    const backdrop = document.createElement('div');
    backdrop.className = 'solar-notif-api-modal-backdrop';

    backdrop.innerHTML = `
      <div class="solar-notif-api-modal">
        <h3>🔔 Filtro de defensorias (API)</h3>
        <label class="solar-notif-api-check-row" style="font-weight:700;">
          <input type="checkbox" id="solar-notif-api-filtro-ativo" ${filtroAtivo ? 'checked' : ''}>
          Ativar filtro de defensorias
        </label>
        <p class="solar-notif-api-hint">Desativado (padrão): todas as defensorias notificam. Ativado: você escolhe quais - digite o nome manualmente ou espere o script capturar automaticamente.</p>
        <hr>
        <div id="solar-notif-api-bloco-filtro">
          <label class="solar-notif-api-check-row">
            <input type="checkbox" id="solar-notif-api-todas">
            Notificar todas (inclusive novas que aparecerem)
          </label>
          <hr>
          <div style="display:flex; gap:6px; margin-bottom:10px;">
            <input type="text" id="solar-notif-api-input-nome" class="solar-notif-api-input-nome"
                   placeholder="Nome exato da defensoria (ex.: DEFENSORIA DAS FAMILIAS DE PASSOS)">
            <button type="button" id="solar-notif-api-btn-adicionar" class="solar-notif-api-btn-secondary">Adicionar</button>
          </div>
          <div id="solar-notif-api-lista"></div>
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
    const listaEl = backdrop.querySelector('#solar-notif-api-lista');
    const inputNome = backdrop.querySelector('#solar-notif-api-input-nome');
    const btnAdicionar = backdrop.querySelector('#solar-notif-api-btn-adicionar');
    checkTodas.checked = notificandoTodasInicial;

    function renderizarLista() {
      if (conhecidas.length === 0) {
        listaEl.innerHTML = '<p class="solar-notif-api-hint">Nenhuma defensoria ainda. Adicione manualmente acima, ou deixe o script capturar automaticamente enquanto roda (a cada 30s, com o filtro ativado).</p>';
        return;
      }

      listaEl.innerHTML = conhecidas.map((d, i) => `
        <div class="solar-notif-api-check-row" style="justify-content:space-between;">
          <label style="display:flex; align-items:center; gap:8px; flex:1;">
            <input type="checkbox" data-defensoria-idx="${i}"
              ${checkTodas.checked ? 'disabled' : ''}
              ${checkTodas.checked || selecionadas.has(d) ? 'checked' : ''}>
            <span>${d}</span>
          </label>
          <button type="button" class="solar-notif-api-btn-remover" data-remover-idx="${i}" title="Remover">×</button>
        </div>
      `).join('');

      listaEl.querySelectorAll('[data-defensoria-idx]').forEach((chk) => {
        chk.addEventListener('change', () => {
          const nome = conhecidas[Number(chk.dataset.defensoriaIdx)];
          if (chk.checked) selecionadas.add(nome);
          else selecionadas.delete(nome);
        });
      });

      listaEl.querySelectorAll('[data-remover-idx]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.removerIdx);
          const removida = conhecidas[idx];
          conhecidas.splice(idx, 1);
          selecionadas.delete(removida);
          GM_setValue(CONFIG.STORAGE_DEFENSORIAS_CONHECIDAS, conhecidas.slice());
          renderizarLista();
        });
      });
    }

    renderizarLista();

    function adicionarDefensoria() {
      const nome = inputNome.value.trim().toUpperCase();
      inputNome.value = '';
      if (!nome || conhecidas.includes(nome)) return;
      conhecidas.push(nome);
      conhecidas.sort((a, b) => a.localeCompare(b, 'pt-BR'));
      selecionadas.add(nome);
      GM_setValue(CONFIG.STORAGE_DEFENSORIAS_CONHECIDAS, conhecidas.slice());
      renderizarLista();
      inputNome.focus();
    }

    btnAdicionar.addEventListener('click', adicionarDefensoria);
    inputNome.addEventListener('keydown', (evento) => {
      if (evento.key === 'Enter') {
        evento.preventDefault();
        adicionarDefensoria();
      }
    });

    const atualizarEstadoGeral = () => {
      const ativo = checkFiltroAtivo.checked;
      blocoFiltro.style.opacity = ativo ? '1' : '0.45';
      checkTodas.disabled = !ativo;
      inputNome.disabled = !ativo;
      btnAdicionar.disabled = !ativo;
      renderizarLista();
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
        log.info('Filtro de defensorias desativado: todas as defensorias voltam a notificar.');
        fechar();
        return;
      }

      if (checkTodas.checked) {
        GM_setValue(CONFIG.STORAGE_DEFENSORIAS_FILTRO, null);
        log.info('Filtro ativado: notificando todas as defensorias (até você desmarcar alguma individualmente).');
      } else {
        const selecionadasFinal = [...selecionadas].filter((d) => conhecidas.includes(d));
        GM_setValue(CONFIG.STORAGE_DEFENSORIAS_FILTRO, selecionadasFinal);
        log.info('Filtro de defensorias salvo:', selecionadasFinal);
      }
      fechar();
    });
  }

  GM_registerMenuCommand('⚙️ Configurar Defensorias a serem notificadas', abrirConfigDefensorias);

  /* ============================================================
   * MÓDULO: Eleição de líder entre abas (com reconfirmação)
   * ============================================================ */
  function esperar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function tentarAssumirLideranca() {
    const lock = GM_getValue(CONFIG.STORAGE_LOCK, null);
    const agora = Date.now();
    const semLiderAtivo = !lock || (agora - lock.ts) > CONFIG.LOCK_TTL_MS;
    const jaSouLider = lock?.id === TAB_ID;

    if (!semLiderAtivo && !jaSouLider) return false;

    GM_setValue(CONFIG.STORAGE_LOCK, { id: TAB_ID, ts: agora });

    // Reconfirmação: espera um pouco e relê o lock. Se outra aba também
    // tentou assumir neste meio-tempo, ela terá sobrescrito com o próprio
    // id, e desistimos deste ciclo - evita duas abas processando o mesmo
    // ciclo e gerando notificação duplicada.
    await esperar(CONFIG.LOCK_CONFIRMACAO_MIN_MS + Math.random() * CONFIG.LOCK_CONFIRMACAO_JITTER_MS);

    const lockAposEspera = GM_getValue(CONFIG.STORAGE_LOCK, null);
    return lockAposEspera?.id === TAB_ID;
  }

  /* ============================================================
   * MÓDULO: Acesso direto à API JSON (sem iframe, sem Angular)
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
      credentials: 'same-origin',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json;charset=utf-8',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRFToken': csrfToken,
      },
      body: JSON.stringify({ data: new Date().toISOString() }),
    });

    if (resposta.redirected) {
      const erro = new Error(`A requisição foi redirecionada para "${resposta.url}" - a sessão provavelmente expirou.`);
      erro.sessaoExpirada = true;
      throw erro;
    }

    if (!resposta.ok) {
      throw new Error(`Resposta HTTP ${resposta.status} ao consultar a API de atendimentos.`);
    }

    const contentType = resposta.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      const erro = new Error(`Resposta com Content-Type inesperado ("${contentType || '(vazio)'}") em vez de JSON - a sessão provavelmente expirou, ou a API mudou de formato.`);
      erro.sessaoExpirada = true;
      throw erro;
    }

    let bruto;
    try {
      bruto = await resposta.json();
    } catch (error) {
      const erro = new Error(`Falha ao interpretar a resposta como JSON (${error.message}) - a sessão provavelmente expirou.`);
      erro.sessaoExpirada = true;
      throw erro;
    }

    if (!Array.isArray(bruto)) {
      throw new Error('Resposta da API não é uma lista (formato pode ter mudado desde a última verificação).');
    }

    // Regra de negócio confirmada com o usuário:
    // - liberado:true sozinho inclui senhas de TRIAGEM PASSOS (emissão de
    //   senha pela recepção) - não deve notificar.
    // - liberado:true + data_atendimento_recepcao preenchido inclui também
    //   atendimentos de CADASTRO no ACOLHIMENTO INICIAL que são liberados e
    //   imediatamente concluídos pela própria recepção (realizado:true) -
    //   também não deve notificar, é só uma etapa de cadastro rápida.
    // - O sinal confiável de "realmente aguardando o defensor" é:
    //   liberado:true E data_atendimento_recepcao preenchido E
    //   defensoria != TRIAGEM PASSOS E realizado:false.
    const liberadosDeVerdade = bruto.filter((item) =>
      item?.liberado === true
      && Boolean(item?.data_atendimento_recepcao)
      && item?.defensoria !== CONFIG.DEFENSORIA_TRIAGEM_EXCLUIR
      && item?.realizado === false
    );

    const atendimentos = liberadosDeVerdade.map((item) => ({
      nome: item.requerente || item.requerente_nome_social || '(sem nome informado)',
      numero: item.numero != null ? String(item.numero) : null,
      defensoria: item.defensoria ?? null,
      dataLiberacao: item.data_atendimento_recepcao ?? null,
      emAtendimento: item.em_atendimento ?? null,
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
   * MÓDULO: Aviso de sessão expirada
   * ============================================================ */
  let avisoSessaoExpiradaAtivo = false;

  function avisarSessaoExpirada() {
    if (avisoSessaoExpiradaAtivo) return;
    avisoSessaoExpiradaAtivo = true;

    showToast({
      title: '⚠️ Sessão expirada',
      linhasHtml: '<span class="solar-notif-api-linha">O notificador parou de funcionar. Faça login novamente no Solar nesta aba.</span>',
      onClick: () => window.open(CONFIG.ATENDIMENTO_PAGINA_URL, '_blank'),
    });

    if (typeof GM_notification === 'function') {
      try {
        GM_notification({
          title: '⚠️ Solar - Sessão expirada',
          text: 'O notificador de atendimentos parou de funcionar porque a sessão expirou. Faça login novamente no Solar.',
          timeout: 20000,
          onclick: () => window.open(CONFIG.ATENDIMENTO_PAGINA_URL, '_blank'),
        });
      } catch (error) {
        log.warn('Falha ao disparar notificação do SO para aviso de sessão expirada', error);
      }
    }
  }

  /* ============================================================
   * MÓDULO: Alertas de atendimento parado (dois tipos)
   *
   * Tipo 1 "demora": liberado, mas ninguém clicou em "Atender" ainda
   *   (em_atendimento === null). Referência de tempo: data_atendimento_recepcao
   *   (precisa da correção de fuso - ver CORRECAO_FUSO_BACKEND_MS).
   *
   * Tipo 2 "esqueceu": alguém clicou em "Atender" (em_atendimento
   *   preenchido) mas nunca finalizou (realizado continua false).
   *   Referência de tempo: em_atendimento.data_inicio.
   *   IMPORTANTE: esse campo NÃO vem com sufixo "Z" (diferente de
   *   data_atendimento_recepcao), o que sugere que já é serializado em
   *   hora local corretamente - por isso NÃO aplicamos a correção de fuso
   *   aqui. Se os minutos aparecerem errados na prática, avise para ajustar.
   * ============================================================ */
  // Ver comentário de CORRECAO_FUSO_BACKEND_MS na configuração: o backend
  // marca hora local de Brasília como se fosse UTC nesse campo específico.
  function corrigirTimestampBackend(isoString) {
    const ms = new Date(isoString).getTime();
    if (Number.isNaN(ms)) return NaN;
    return ms + CONFIG.CORRECAO_FUSO_BACKEND_MS;
  }

  function calcularNovosAlertas({ itens, minutosLimite, registroAnterior, agora, obterInstanteReferencia }) {
    const registroAtual = {};
    const novosAlertas = [];

    itens.forEach((a) => {
      if (!a.numero) return;

      const instanteRef = obterInstanteReferencia(a);
      if (Number.isNaN(instanteRef)) return;

      const minutosDecorridos = Math.floor((agora - instanteRef) / 60000);
      if (minutosDecorridos < minutosLimite) return;

      const ultimoAlerta = registroAnterior[a.numero];
      const deveAlertar = !ultimoAlerta || (agora - ultimoAlerta) >= minutosLimite * 60_000;

      if (deveAlertar) {
        registroAtual[a.numero] = agora;
        novosAlertas.push({
          numero: a.numero,
          nome: a.nome,
          defensoria: a.defensoria,
          minutos: minutosDecorridos,
          servidor: a.emAtendimento?.servidor ?? null,
        });
      } else {
        registroAtual[a.numero] = ultimoAlerta; // preserva até completar a próxima janela
      }
    });

    return { registroAtual, novosAlertas };
  }

  function verificarAtendimentosDemorados(atendimentos) {
    const agora = Date.now();
    const naoIniciados = atendimentos.filter((a) => !a.emAtendimento);
    const iniciadosNaoFechados = atendimentos.filter((a) => a.emAtendimento);

    // --- Tipo 1: ninguém clicou em "Atender" ainda ---
    if (GM_getValue(CONFIG.STORAGE_ALERTA_DEMORA_ATIVO, true)) {
      const minutosLimite = GM_getValue(CONFIG.STORAGE_ALERTA_DEMORA_MINUTOS, CONFIG.ALERTA_DEMORA_MINUTOS_PADRAO);
      const registroAnterior = GM_getValue(CONFIG.STORAGE_ALERTA_DEMORA_ENVIADOS, {});
      const { registroAtual, novosAlertas } = calcularNovosAlertas({
        itens: naoIniciados,
        minutosLimite,
        registroAnterior,
        agora,
        obterInstanteReferencia: (a) => (a.dataLiberacao ? corrigirTimestampBackend(a.dataLiberacao) : NaN),
      });

      // Sobrescreve (não acumula) - só mantém quem ainda está pendente agora.
      GM_setValue(CONFIG.STORAGE_ALERTA_DEMORA_ENVIADOS, registroAtual);

      if (novosAlertas.length > 0) {
        GM_setValue(CONFIG.STORAGE_EVENT_DEMORA, { ts: agora, atendimentos: novosAlertas });
        dispararAlertasGlobaisDemora(novosAlertas);
      }
    }

    // --- Tipo 2: clicou em "Atender", mas não finalizou ---
    if (GM_getValue(CONFIG.STORAGE_ALERTA_ESQUECEU_ATIVO, true)) {
      const minutosLimite = GM_getValue(CONFIG.STORAGE_ALERTA_ESQUECEU_MINUTOS, CONFIG.ALERTA_ESQUECEU_MINUTOS_PADRAO);
      const registroAnterior = GM_getValue(CONFIG.STORAGE_ALERTA_ESQUECEU_ENVIADOS, {});
      const { registroAtual, novosAlertas } = calcularNovosAlertas({
        itens: iniciadosNaoFechados,
        minutosLimite,
        registroAnterior,
        agora,
        obterInstanteReferencia: (a) => new Date(a.emAtendimento?.data_inicio).getTime(),
      });

      GM_setValue(CONFIG.STORAGE_ALERTA_ESQUECEU_ENVIADOS, registroAtual);

      if (novosAlertas.length > 0) {
        GM_setValue(CONFIG.STORAGE_EVENT_ESQUECEU, { ts: agora, atendimentos: novosAlertas });
        dispararAlertasGlobaisEsqueceu(novosAlertas);
      }
    }
  }

  function dispararAlertasGlobaisDemora(atendimentosDemorados) {
    if (typeof GM_notification !== 'function') return;

    atendimentosDemorados.forEach((a) => {
      try {
        GM_notification({
          title: '⏰ Atendimento aguardando há muito tempo',
          text: `${a.nome}${a.defensoria ? ` — ${a.defensoria}` : ''}\nLiberado há ${formatarDuracao(a.minutos)} e ainda não foi atendido.`,
          timeout: 20000,
          onclick: () => window.open(CONFIG.ATENDIMENTO_PAGINA_URL, '_blank'),
        });
      } catch (error) {
        log.warn('Falha ao disparar notificação do SO para alerta de demora', error);
      }
    });
  }

  function dispararAlertasGlobaisEsqueceu(atendimentosEsquecidos) {
    if (typeof GM_notification !== 'function') return;

    atendimentosEsquecidos.forEach((a) => {
      try {
        GM_notification({
          title: '⏰ Atendimento iniciado mas não finalizado',
          text: `${a.nome}${a.defensoria ? ` — ${a.defensoria}` : ''}\nEm atendimento${a.servidor ? ` por ${a.servidor}` : ''} há ${formatarDuracao(a.minutos)}, mas ainda não foi finalizado no sistema.`,
          timeout: 20000,
          onclick: () => window.open(CONFIG.ATENDIMENTO_PAGINA_URL, '_blank'),
        });
      } catch (error) {
        log.warn('Falha ao disparar notificação do SO para alerta de atendimento não finalizado', error);
      }
    });
  }

  let ultimoTsDemoraProcessadoNestaAba = null;

  function tratarEventoDemora(evento) {
    if (!evento?.atendimentos?.length) return;
    // Dedup pelo timestamp do evento inteiro: permite que o MESMO
    // atendimento apareça de novo em eventos futuros e distintos
    // (repetição periódica é esperada), só bloqueia o mesmo evento sendo
    // processado duas vezes nesta aba.
    if (evento.ts === ultimoTsDemoraProcessadoNestaAba) return;
    ultimoTsDemoraProcessadoNestaAba = evento.ts;

    // Notificação do SO NÃO dispara aqui - já foi disparada uma única vez
    // pela aba líder. Este handler roda em toda aba aberta e cuida só do
    // toast visual.
    evento.atendimentos.forEach((a) => {
      const titulo = '⏰ Atendimento aguardando há muito tempo';
      const duracao = formatarDuracao(a.minutos);
      const linhasHtml = `
        <span class="solar-notif-api-linha">${a.nome}${a.defensoria ? ` — ${a.defensoria}` : ''}</span>
        <span class="solar-notif-api-linha">Liberado há ${duracao} e ainda não foi atendido.</span>
      `;

      showToast({
        title: titulo,
        linhasHtml,
        urgente: true,
        onClick: () => window.open(CONFIG.ATENDIMENTO_PAGINA_URL, '_blank'),
      });
    });
  }

  let ultimoTsEsqueceuProcessadoNestaAba = null;

  function tratarEventoEsqueceu(evento) {
    if (!evento?.atendimentos?.length) return;
    if (evento.ts === ultimoTsEsqueceuProcessadoNestaAba) return;
    ultimoTsEsqueceuProcessadoNestaAba = evento.ts;

    evento.atendimentos.forEach((a) => {
      const titulo = '⏰ Atendimento iniciado mas não finalizado';
      const duracao = formatarDuracao(a.minutos);
      const linhasHtml = `
        <span class="solar-notif-api-linha">${a.nome}${a.defensoria ? ` — ${a.defensoria}` : ''}</span>
        <span class="solar-notif-api-linha">Em atendimento${a.servidor ? ` por ${a.servidor}` : ''} há ${duracao}, mas ainda não foi finalizado no sistema.</span>
      `;

      showToast({
        title: titulo,
        linhasHtml,
        urgente: true,
        onClick: () => window.open(CONFIG.ATENDIMENTO_PAGINA_URL, '_blank'),
      });
    });
  }

  GM_addValueChangeListener(CONFIG.STORAGE_EVENT_DEMORA, (_n, _o, valorNovo) => {
    tratarEventoDemora(valorNovo);
  });

  GM_addValueChangeListener(CONFIG.STORAGE_EVENT_ESQUECEU, (_n, _o, valorNovo) => {
    tratarEventoEsqueceu(valorNovo);
  });

  function abrirConfigAlertasAtraso() {
    if (!document.body) {
      log.warn('Não foi possível abrir a tela de configuração: <body> indisponível nesta aba.');
      return;
    }

    const demoraAtivo = GM_getValue(CONFIG.STORAGE_ALERTA_DEMORA_ATIVO, true);
    const demoraMinutos = GM_getValue(CONFIG.STORAGE_ALERTA_DEMORA_MINUTOS, CONFIG.ALERTA_DEMORA_MINUTOS_PADRAO);
    const esqueceuAtivo = GM_getValue(CONFIG.STORAGE_ALERTA_ESQUECEU_ATIVO, true);
    const esqueceuMinutos = GM_getValue(CONFIG.STORAGE_ALERTA_ESQUECEU_MINUTOS, CONFIG.ALERTA_ESQUECEU_MINUTOS_PADRAO);

    const backdrop = document.createElement('div');
    backdrop.className = 'solar-notif-api-modal-backdrop';

    backdrop.innerHTML = `
      <div class="solar-notif-api-modal">
        <h3>⏰ Alertas de atraso</h3>
        <p class="solar-notif-api-hint">Avisos vermelhos para atendimentos parados. Cada um pode ser ligado/desligado e ter seu próprio intervalo.</p>

        <label class="solar-notif-api-check-row" style="font-weight:700;">
          <input type="checkbox" id="solar-notif-api-demora-ativo" ${demoraAtivo ? 'checked' : ''}>
          Atendimento aguardando (ninguém clicou em "Atender")
        </label>
        <div style="display:flex; align-items:center; gap:8px; margin: 2px 0 14px 26px;">
          <span style="font-size:13px;">Avisar a cada</span>
          <input type="number" id="solar-notif-api-demora-minutos" min="1" step="1" value="${demoraMinutos}"
                 style="width:64px; padding:5px 7px; border:1px solid #ccc; border-radius:4px; font-size:13px;">
          <span style="font-size:13px;">minutos</span>
        </div>

        <hr>

        <label class="solar-notif-api-check-row" style="font-weight:700;">
          <input type="checkbox" id="solar-notif-api-esqueceu-ativo" ${esqueceuAtivo ? 'checked' : ''}>
          Atendimento iniciado, mas não finalizado no sistema
        </label>
        <div style="display:flex; align-items:center; gap:8px; margin: 2px 0 14px 26px;">
          <span style="font-size:13px;">Avisar a cada</span>
          <input type="number" id="solar-notif-api-esqueceu-minutos" min="1" step="1" value="${esqueceuMinutos}"
                 style="width:64px; padding:5px 7px; border:1px solid #ccc; border-radius:4px; font-size:13px;">
          <span style="font-size:13px;">minutos</span>
        </div>

        <div class="solar-notif-api-modal-actions">
          <button type="button" class="solar-notif-api-btn-secondary" id="solar-notif-api-alertas-cancelar">Cancelar</button>
          <button type="button" class="solar-notif-api-btn-primary" id="solar-notif-api-alertas-salvar">Salvar</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const checkDemora = backdrop.querySelector('#solar-notif-api-demora-ativo');
    const inputDemora = backdrop.querySelector('#solar-notif-api-demora-minutos');
    const checkEsqueceu = backdrop.querySelector('#solar-notif-api-esqueceu-ativo');
    const inputEsqueceu = backdrop.querySelector('#solar-notif-api-esqueceu-minutos');

    const atualizarEstado = () => {
      inputDemora.disabled = !checkDemora.checked;
      inputEsqueceu.disabled = !checkEsqueceu.checked;
    };
    atualizarEstado();
    checkDemora.addEventListener('change', atualizarEstado);
    checkEsqueceu.addEventListener('change', atualizarEstado);

    const fechar = () => backdrop.remove();
    backdrop.querySelector('#solar-notif-api-alertas-cancelar').addEventListener('click', fechar);
    backdrop.addEventListener('click', (evento) => { if (evento.target === backdrop) fechar(); });

    backdrop.querySelector('#solar-notif-api-alertas-salvar').addEventListener('click', () => {
      GM_setValue(CONFIG.STORAGE_ALERTA_DEMORA_ATIVO, checkDemora.checked);
      GM_setValue(CONFIG.STORAGE_ALERTA_DEMORA_MINUTOS, Math.max(1, Number(inputDemora.value) || CONFIG.ALERTA_DEMORA_MINUTOS_PADRAO));

      GM_setValue(CONFIG.STORAGE_ALERTA_ESQUECEU_ATIVO, checkEsqueceu.checked);
      GM_setValue(CONFIG.STORAGE_ALERTA_ESQUECEU_MINUTOS, Math.max(1, Number(inputEsqueceu.value) || CONFIG.ALERTA_ESQUECEU_MINUTOS_PADRAO));

      log.info('Configuração de alertas de atraso salva.');
      fechar();
    });
  }

  /* ============================================================
   * MÓDULO: Ciclo de verificação
   * ============================================================ */
  let verificacaoEmAndamento = false;

  async function verificarNovosAtendimentos() {
    if (!(await tentarAssumirLideranca())) return;
    if (verificacaoEmAndamento) return;
    verificacaoEmAndamento = true;

    try {
      const dados = await buscarDadosLiberadosViaAPI();
      avisoSessaoExpiradaAtivo = false; // sucesso: reabilita aviso para uma futura falha

      const chavesAtuais = construirChavesAtuais(dados.atendimentos);

      if (GM_getValue(CONFIG.STORAGE_FILTRO_ATIVO, false)) {
        registrarDefensoriasVistas(dados.atendimentos);
      }

      verificarAtendimentosDemorados(dados.atendimentos);

      const conhecidosAnteriores = GM_getValue(CONFIG.STORAGE_CONHECIDOS, null);
      GM_setValue(CONFIG.STORAGE_COUNT, dados.total);

      // Antes, a primeiríssima checagem (conhecidosAnteriores === null,
      // seja por instalação nova ou por "Resetar baseline") ficava em
      // silêncio, só registrando o estado atual sem notificar - para não
      // "inundar" de avisos retroativos. Isso foi mudado a pedido: quando
      // o usuário loga pela manhã (ou reabre o Solar depois de fechado),
      // ele PRECISA ser avisado sobre quem já está esperando. Por isso,
      // tratamos "sem histórico anterior" como um conjunto vazio, e tudo
      // que estiver na fila agora entra como "novo" normalmente.
      const eraPrimeiraChecagem = conhecidosAnteriores === null;
      const setAnterior = new Set(conhecidosAnteriores ?? []);
      const novosTodos = chavesAtuais.filter((c) => !setAnterior.has(c.chave));
      const novosNotificaveis = novosTodos.filter((c) => defensoriaInteressa(c.defensoria));

      GM_setValue(CONFIG.STORAGE_CONHECIDOS, chavesAtuais.map((c) => c.chave));

      if (eraPrimeiraChecagem) {
        log.info(`Primeira checagem: ${dados.total} atendimento(s) em Liberados encontrados - serão notificados normalmente, se aplicável.`);
      }

      if (novosTodos.length > 0 && novosNotificaveis.length === 0) {
        log.info(`${novosTodos.length} novo(s) atendimento(s) detectado(s), mas fora do filtro de defensorias configurado - notificação não disparada.`);
      }

      if (novosNotificaveis.length > 0) {
        GM_setValue(CONFIG.STORAGE_EVENT, {
          ts: Date.now(),
          novos: novosNotificaveis.map(({ nome, defensoria, chave }) => ({ nome, defensoria, numero: chave })),
          total: dados.total,
        });

        // Som e notificação do SO são eventos "globais" (o usuário só
        // precisa ouvir/ver uma vez, não importa quantas abas do Solar
        // estão abertas) - diferente do toast, que é visual e deve aparecer
        // em CADA aba. Por isso disparamos aqui, uma única vez, direto na
        // aba líder que detectou a novidade - não pelo mecanismo de evento
        // entre-abas (esse é usado só para replicar o toast).
        dispararAlertasGlobaisNovoAtendimento(novosNotificaveis, dados.total);
      }
    } catch (error) {
      log.warn('Falha ao verificar novos atendimentos', error);
      if (error?.sessaoExpirada) {
        avisarSessaoExpirada();
      }
    } finally {
      verificacaoEmAndamento = false;
    }
  }

  /* ============================================================
   * MÓDULO: Alertas "globais" (som + notificação do SO) - disparados uma
   * única vez pela aba líder, nunca replicados por aba
   * ============================================================ */
  function dispararAlertasGlobaisNovoAtendimento(novos, total) {
    playChime();

    if (typeof GM_notification !== 'function') return;

    const titulo = novos.length === 1
      ? 'Novo atendimento liberado!'
      : `${novos.length} novos atendimentos liberados!`;

    const visiveis = novos.slice(0, CONFIG.MAX_NOMES_NO_TOAST);
    const restantes = novos.length - visiveis.length;
    const textoPlano = visiveis
      .map((n) => `${n.nome}${n.defensoria ? ` — ${n.defensoria}` : ''}`)
      .join('\n') + (restantes > 0 ? `\ne mais ${restantes}...` : '') + `\n\nTotal na fila: ${total}`;

    try {
      GM_notification({
        title: titulo,
        text: textoPlano,
        timeout: 14000,
        onclick: () => window.open(CONFIG.ATENDIMENTO_PAGINA_URL, '_blank'),
      });
    } catch (error) {
      log.warn('Falha ao disparar notificação do SO para novo atendimento', error);
    }
  }

  /* ============================================================
   * MÓDULO: Reação ao evento de novo atendimento (toast - todas as abas)
   * ============================================================ */
  const chavesNovoJaMostradasNestaAba = new Set();

  function tratarEventoNovoAtendimento(evento) {
    if (!evento?.novos?.length) return;

    // Camada extra de proteção contra duplicidade dentro da MESMA aba: se
    // o mesmo atendimento chegar em dois eventos distintos, esta aba nunca
    // mostra o mesmo toast duas vezes.
    const novosFiltrados = evento.novos.filter((n) => {
      const chave = n.numero || `${n.defensoria ?? ''}::${n.nome}`;
      if (chavesNovoJaMostradasNestaAba.has(chave)) return false;
      chavesNovoJaMostradasNestaAba.add(chave);
      return true;
    });

    if (novosFiltrados.length === 0) return;

    const { total } = evento;
    const titulo = novosFiltrados.length === 1
      ? 'Novo atendimento liberado!'
      : `${novosFiltrados.length} novos atendimentos liberados!`;

    const visiveis = novosFiltrados.slice(0, CONFIG.MAX_NOMES_NO_TOAST);
    const restantes = novosFiltrados.length - visiveis.length;

    const linhasHtml = visiveis
      .map((n) => `<span class="solar-notif-api-linha">• ${n.nome}${n.defensoria ? ` — ${n.defensoria}` : ''}</span>`)
      .join('')
      + (restantes > 0 ? `<span class="solar-notif-api-linha">e mais ${restantes}...</span>` : '')
      + `<span class="solar-notif-api-linha-total">Total na fila: ${total}</span>`;

    // Som e notificação do SO NÃO disparam aqui - já foram disparados uma
    // única vez pela aba líder em dispararAlertasGlobaisNovoAtendimento.
    // Este handler roda em toda aba aberta e cuida só do toast visual.
    showToast({
      title: titulo,
      linhasHtml,
      onClick: () => window.open(CONFIG.ATENDIMENTO_PAGINA_URL, '_blank'),
    });
  }

  GM_addValueChangeListener(CONFIG.STORAGE_EVENT, (_nome, _valorAntigo, valorNovo) => {
    tratarEventoNovoAtendimento(valorNovo);
  });

  /* ============================================================
   * MÓDULO: Comandos do menu do Tampermonkey
   * ============================================================ */
  GM_registerMenuCommand('🔔 Testar notificação agora', () => {
    tratarEventoNovoAtendimento({
      novos: [
        { nome: 'FULANO DE TAL DA SILVA (teste)', defensoria: 'DEFENSORIA DE TESTE (GERAL)', numero: `teste-${Date.now()}` },
      ],
      total: (GM_getValue(CONFIG.STORAGE_COUNT, 0) ?? 0) + 1,
    });
  });

  GM_registerMenuCommand('🖥️ Testar SOMENTE notificação do Windows', () => {
    if (typeof GM_notification !== 'function') {
      log.warn('GM_notification não está disponível nesta instalação do Tampermonkey/navegador.');
      return;
    }
    try {
      GM_notification({
        title: '🖥️ Teste de notificação do Windows',
        text: 'Se você está vendo isso, as notificações do sistema operacional estão funcionando nesta máquina.',
        timeout: 10000,
      });
      log.info('GM_notification foi chamado sem lançar erro. Se ainda assim nada apareceu na tela, o bloqueio é no Windows/navegador (não no script) - veja Configurações do Windows > Sistema > Notificações (o navegador precisa estar permitido ali), e confira se o Foco Assistido/Não Perturbe não está ativo.');
    } catch (error) {
      log.error('GM_notification lançou um erro ao tentar notificar', error);
    }
  });

  GM_registerMenuCommand(
    isSoundEnabled() ? '🔇 Desativar som' : '🔊 Ativar som',
    () => {
      GM_setValue(CONFIG.STORAGE_SOUND_ON, !isSoundEnabled());
      log.info('Preferência de som alterada. Recarregue a página para o menu refletir o novo estado.');
    }
  );

  GM_registerMenuCommand('⏰ Configurar alertas de atraso', abrirConfigAlertasAtraso);

  GM_registerMenuCommand('♻️ Resetar baseline de contagem', () => {
    GM_setValue(CONFIG.STORAGE_COUNT, null);
    GM_setValue(CONFIG.STORAGE_CONHECIDOS, null);
    GM_setValue(CONFIG.STORAGE_ALERTA_DEMORA_ENVIADOS, {});
    GM_setValue(CONFIG.STORAGE_ALERTA_ESQUECEU_ENVIADOS, {});
    log.info('Baseline resetado. A próxima checagem já vai notificar normalmente sobre quem estiver na fila agora (não fica mais em silêncio).');
  });

  /* ============================================================
   * INICIALIZAÇÃO
   * ============================================================ */
  // A primeira checagem é espalhada num atraso aleatório (em vez de disparar
  // instantaneamente) - reduz a chance de duas abas abertas quase ao mesmo
  // tempo (ex.: no início do expediente) colidirem exatamente na eleição de
  // líder logo na largada.
  setTimeout(verificarNovosAtendimentos, Math.random() * CONFIG.PRIMEIRA_CHECAGEM_JITTER_MAX_MS);
  setInterval(verificarNovosAtendimentos, CONFIG.POLL_INTERVAL_MS);

  log.info(`Monitoramento ativo (checagem a cada ${CONFIG.POLL_INTERVAL_MS / 1000}s, via fetch direto à API).`);
})();
