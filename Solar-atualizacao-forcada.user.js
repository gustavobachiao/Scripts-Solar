// ==UserScript==
// @name         Solar - Atualizacao Forcada de Processos
// @namespace    https://solar.defensoria.mg.def.br/
// @version      2.0.0
// @description  Forca a atualizacao do processo interceptando proativamente chamadas de rede da API nativa, garantindo sincronia independente da rota de navegacao.
// @author       Defensoria Publica de Minas Gerais - Unidade de Passos
// @match        https://solar.defensoria.mg.def.br/atendimento/*
// @grant        unsafeWindow
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/gustavobachiao/Scripts-Solar/main/Solar-atualizacao-forcada.user.js
// @downloadURL  https://raw.githubusercontent.com/gustavobachiao/Scripts-Solar/main/Solar-atualizacao-forcada.user.js
// @homepageURL  https://github.com/gustavobachiao/Scripts-Solar
// @supportURL   https://github.com/gustavobachiao/Scripts-Solar/issues
// ==/UserScript==

(() => {
    'use strict';

    // ==========================================
    // 0. AMBIENTE E PROTEÇÃO
    // ==========================================
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    if (pageWindow.__solarFastSyncInstalled) {
        return;
    }
    pageWindow.__solarFastSyncInstalled = true;

    // ==========================================
    // 1. CONFIGURAÇÕES E ESTADOS
    // ==========================================
    const CONFIG = {
        debug: true,
        enableRaceGuard: true,

        // ATENÇÃO: este prefixo casa com QUALQUER chamada de API relacionada ao processo,
        // não só o carregamento da página de detalhes (ex.: prévias em listas, autocomplete,
        // widgets). Acompanhe os logs "ID de processo detectado via rede" para confirmar que
        // o volume de disparos é o esperado. Se estiver disparando demais, restrinja para um
        // caminho mais específico (ex.: incluir '/consultar' no prefixo).
        processApiPrefix: '/procapi/processo/',

        // gateMaxWaitMs é mantido levemente maior que fetchTimeoutMs de propósito: assim o
        // AbortController do fetch quase sempre vence a corrida primeiro, e o portão nunca
        // libera a página nativa antes da tentativa de atualização terminar (comportamento
        // "acoplado" — sem liberação antecipada, sem risco de disparo duplicado).
        fetchTimeoutMs: 30000,
        gateMaxWaitMs: 32000,

        // Quanto tempo o resultado ("Concluída ✅" / "Falha 🔴") fica visível no toast
        // antes de sumir sozinho.
        resultDisplayMs: 4000,

        ownRequestHeader: 'X-Solar-Fast-Sync'
    };

    const Logger = {
        info:  (msg, ...args) => CONFIG.debug && console.info(`[Solar Fast Sync] 🔵 ${msg}`, ...args),
        warn:  (msg, ...args) => console.warn(`[Solar Fast Sync] 🟡 ${msg}`, ...args),
        error: (msg, error)   => console.error(`[Solar Fast Sync] 🔴 ${msg}`, error ?? '')
    };

    const updatedProcesses = new Set();
    const gates = new Map();

// ==========================================
    // 1.5 INDICADOR VISUAL (UI TOAST)
    // ==========================================
    const UI = {
        toast: null,
        textEl: null,
        spinnerEl: null,
        btnEl: null, // Nova referência para o botão OK
        counterInterval: null,
        hideTimeout: null,
        startedAt: null,

        init() {
            try {
                if (this.toast || !document.documentElement) return;

                this.toast = document.createElement('div');
                this.toast.id = 'solar-fast-sync-toast';
                this.toast.style.cssText = `
                    position: fixed; bottom: 20px; right: 20px;
                    background: #2c3e50; color: #ecf0f1;
                    padding: 12px 18px; border-radius: 6px;
                    font-family: sans-serif; font-size: 13px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
                    z-index: 999999;
                    /* pointer-events alterado para 'auto' para permitir clique no botão */
                    pointer-events: auto;
                    display: none; align-items: center; gap: 12px;
                    transition: opacity 0.3s ease, background-color 0.3s ease; opacity: 0;
                `;

                this.toast.innerHTML = `
                    <style>
                        @keyframes solarSpin { 100% { transform: rotate(360deg); } }
                        .solar-spinner { width: 16px; height: 16px; border: 2px solid #ecf0f1; border-top-color: transparent; border-radius: 50%; animation: solarSpin 1s linear infinite; }
                        /* Estilo isolado do botão para não conflitar com o Bootstrap do Solar */
                        #solar-toast-btn-ok {
                            background: #e74c3c; border: 1px solid #c0392b; color: #fff;
                            padding: 4px 12px; border-radius: 4px; cursor: pointer;
                            font-weight: bold; font-size: 12px; display: none;
                            transition: background 0.2s;
                        }
                        #solar-toast-btn-ok:hover { background: #c0392b; }
                    </style>
                    <div class="solar-spinner" id="solar-toast-spinner"></div>
                    <span id="solar-toast-text">Forçando Atualização Automaticamente</span>
                    <button id="solar-toast-btn-ok">OK</button>
                `;
                document.documentElement.appendChild(this.toast);

                this.textEl = this.toast.querySelector('#solar-toast-text');
                this.spinnerEl = this.toast.querySelector('#solar-toast-spinner');
                this.btnEl = this.toast.querySelector('#solar-toast-btn-ok');

                // Delegação do evento de clique para forçar o fechamento
                this.btnEl.addEventListener('click', () => {
                    this.hide(true); // true = force
                });
            } catch (error) {
                Logger.warn('Falha ao inicializar indicador visual.', error);
            }
        },

        updateCounterText() {
            try {
                if (!this.textEl || this.startedAt === null) return;
                const seconds = Math.floor((Date.now() - this.startedAt) / 1000);
                this.textEl.textContent = `Forçando Atualização Automaticamente (${seconds}s)`;
            } catch (error) {
                Logger.warn('Falha ao atualizar contador do indicador visual.', error);
            }
        },

        startSyncing() {
            try {
                this.init();
                if (!this.toast) return;

                clearTimeout(this.hideTimeout);
                clearInterval(this.counterInterval);

                // Reset visual caso tenha vindo de uma falha anterior
                this.toast.style.background = '#2c3e50';
                if (this.btnEl) this.btnEl.style.display = 'none';

                this.startedAt = Date.now();
                if (this.spinnerEl) this.spinnerEl.style.display = 'block';
                this.updateCounterText();
                this.counterInterval = setInterval(() => this.updateCounterText(), 1000);

                this.toast.style.display = 'flex';
                setTimeout(() => { if (this.toast) this.toast.style.opacity = '1'; }, 10);
            } catch (error) {
                Logger.warn('Falha ao exibir indicador visual.', error);
            }
        },

showResult(success) {
            try {
                if (!this.toast) return;

                clearInterval(this.counterInterval);
                this.startedAt = null;
                clearTimeout(this.hideTimeout); // Cancela o hideTimeout anterior em todos os cenários

                if (this.spinnerEl) this.spinnerEl.style.display = 'none';

                if (success) {
                    if (this.textEl) this.textEl.textContent = 'Atualização Forçada Concluída ✅';
                    if (this.btnEl) this.btnEl.style.display = 'none';

                    // Fundo VERDE semântico indicando sucesso
                    this.toast.style.background = '#27ae60';

                    // Sucesso: Agenda o sumiço automático após CONFIG.resultDisplayMs
                    this.hideTimeout = setTimeout(() => this.hide(), CONFIG.resultDisplayMs);
                } else {
                    if (this.textEl) this.textEl.textContent = 'Falha na Atualização Forçada 🔴';
                    if (this.btnEl) this.btnEl.style.display = 'block';

                    // Fundo VERMELHO semântico indicando falha
                    this.toast.style.background = '#991111';

                    // Falha: NÃO agenda o timeout. O aviso ficará até o usuário clicar no botão "OK".
                }
            } catch (error) {
                Logger.warn('Falha ao exibir resultado no indicador visual.', error);
            }
        },

        hide(force = false) {
            try {
                // Esconde se a fila estiver vazia OU se o usuário forçou o fechamento clicando em OK
                if (this.toast && (gates.size === 0 || force)) {
                    this.toast.style.opacity = '0';

                    setTimeout(() => {
                        if ((gates.size === 0 || force) && this.toast) {
                            this.toast.style.display = 'none';
                            // Reseta o fundo para que o próximo sync comece com a cor correta
                            this.toast.style.background = '#2c3e50';
                        }
                    }, 300);
                }
            } catch (error) {
                Logger.warn('Falha ao ocultar indicador visual.', error);
            }
        }
    };

    // Regex calculada uma única vez (evita reconstruir a cada chamada de rede da página inteira)
    const escapedPrefix = CONFIG.processApiPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const PROCESS_ID_REGEX = new RegExp(`${escapedPrefix}(\\d+)`);

    // ==========================================
    // 2. CONTROLE DE PORTÕES (RACE GUARD)
    // ==========================================
    const openGate = (processoId) => {
        let resolveFn;
        const promise = new Promise((resolve) => { resolveFn = resolve; });

        const timeoutId = setTimeout(() => {
            Logger.warn(`Portão do processo ${processoId} expirou. Liberando requisições nativas por segurança.`);
            resolveFn();
        }, CONFIG.gateMaxWaitMs);

        // IMPORTANTE: gates.set() acontece ANTES de UI.startSyncing(). Como UI.startSyncing()
        // está isolado em try/catch, mesmo que ele falhe, o estado do portão em si já está
        // consistente — uma falha cosmética nunca deixa uma entrada "presa" no Map.
        gates.set(processoId, { promise, resolveFn, timeoutId });

        UI.startSyncing();

        return promise;
    };

    const closeGate = (processoId) => {
        const gate = gates.get(processoId);
        if (!gate) return;
        clearTimeout(gate.timeoutId);
        gate.resolveFn();
        gates.delete(processoId);
        // Não esconde o toast aqui: quem decide isso agora é UI.showResult(), chamado logo
        // em seguida em triggerForcedUpdate, já que o resultado precisa ficar visível por
        // um tempo depois do portão fechar.
    };

    const extractIdFromApiUrl = (url) => {
        if (typeof url !== 'string') return null;
        const match = url.match(PROCESS_ID_REGEX);
        return match ? match[1] : null;
    };

    const getGate = (processoId) => {
        if (!CONFIG.enableRaceGuard || !processoId) return null;
        return gates.get(processoId)?.promise ?? null;
    };

    // ==========================================
    // 3. LÓGICA DE REQUISIÇÃO DIRETA (API)
    // ==========================================
    const forceProcessUpdateAPI = async (processoId) => {
        const apiUrl = `${pageWindow.location.origin}${CONFIG.processApiPrefix}${processoId}/consultar/?forcar_atualizacao=true`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.fetchTimeoutMs);

        try {
            Logger.info(`Iniciando sync silencioso (GET) para o ID: ${processoId}`);

            const response = await pageWindow.fetch(apiUrl, {
                method: 'GET',
                credentials: 'same-origin',
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'X-Requested-With': 'XMLHttpRequest',
                    [CONFIG.ownRequestHeader]: '1'
                }
            });

            if (!response.ok) throw new Error(`Status HTTP ${response.status}`);

            updatedProcesses.add(processoId);
            Logger.info(`✅ Processo ${processoId} atualizado com sucesso no backend!`);
            return true;
        } catch (error) {
            Logger.error(`Falha ao forçar atualização via API para o ID ${processoId}.`, error);
            return false;
        } finally {
            clearTimeout(timeoutId);
        }
    };

    const triggerForcedUpdate = async (processoId) => {
        if (updatedProcesses.has(processoId)) {
            Logger.info(`Processo ${processoId} já sincronizado nesta sessão. Ignorando.`);
            return;
        }
        if (gates.has(processoId)) {
            Logger.info(`Atualização já em andamento para o processo ${processoId}. Ignorando chamada duplicada.`);
            return;
        }

        // IMPORTANTE (invariante de sincronização): openGate precisa ser a ÚLTIMA operação
        // síncrona antes do primeiro `await` desta função. É isso que garante que a MESMA
        // requisição nativa que revelou o processoId (no interceptor, logo abaixo) enxergue
        // o portão já aberto no instante seguinte, ao checar o race guard. Não insira nenhum
        // await antes desta linha, ou o race guard para de funcionar silenciosamente.
        if (CONFIG.enableRaceGuard) openGate(processoId);

        let success = false;
        try {
            success = await forceProcessUpdateAPI(processoId);
        } finally {
            if (CONFIG.enableRaceGuard) {
                closeGate(processoId);
                UI.showResult(success);
            }
        }
    };

    const triggerForcedUpdateSafe = (processoId) => {
        triggerForcedUpdate(processoId).catch((error) =>
            Logger.error(`Erro inesperado ao disparar atualização para o processo ${processoId}.`, error)
        );
    };

    // ==========================================
    // 4. INTERCEPTAÇÃO DE REDE PROATIVA (CORE)
    // ==========================================
    const isOwnFetchRequest = (init) => {
        if (!init?.headers) return false;
        try {
            const headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
            return headers.get(CONFIG.ownRequestHeader) === '1';
        } catch {
            return false;
        }
    };

    const originalFetch = pageWindow.fetch.bind(pageWindow);
    pageWindow.fetch = async function patchedFetch(input, init = {}) {
        const url = typeof input === 'string' ? input : (input?.url ?? String(input));

        // 1. Ignora nossa própria requisição (Bypass)
        if (isOwnFetchRequest(init)) {
            const headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
            headers.delete(CONFIG.ownRequestHeader);
            return originalFetch(input, { ...init, headers });
        }

        // 2. Gatilho Proativo: se o frontend tentar ler um processo, forçamos a atualização antes
        const processoId = extractIdFromApiUrl(url);
        if (processoId) {
            Logger.info(`ID de processo detectado via rede (fetch): ${processoId} — ${url}`);
            triggerForcedUpdateSafe(processoId);
        }

        // 3. Race Guard: segura a requisição nativa no portão se a atualização estiver rolando
        const gate = getGate(processoId);
        if (gate) {
            Logger.info(`Segurando requisição nativa (fetch) até a conclusão: ${url}`);
            await gate;
        }

        return originalFetch(input, init);
    };

    const originalXHROpen = pageWindow.XMLHttpRequest.prototype.open;
    const originalXHRSend = pageWindow.XMLHttpRequest.prototype.send;

    pageWindow.XMLHttpRequest.prototype.open = function (method, url, async = true, ...rest) {
        this.__solarFastSyncUrl = url;
        this.__solarFastSyncAsync = async;
        return originalXHROpen.call(this, method, url, async, ...rest);
    };

    pageWindow.XMLHttpRequest.prototype.send = function (...args) {
        const url = this.__solarFastSyncUrl;
        const processoId = extractIdFromApiUrl(url);

        // Gatilho Proativo XHR
        if (processoId && this.__solarFastSyncAsync !== false) {
            Logger.info(`ID de processo detectado via rede (XHR): ${processoId} — ${url}`);
            triggerForcedUpdateSafe(processoId);
        }

        // Race Guard XHR
        const gate = this.__solarFastSyncAsync === false ? null : getGate(processoId);
        if (gate) {
            Logger.info(`Segurando requisição nativa (XHR) até a conclusão: ${url}`);
            gate.then(() => originalXHRSend.apply(this, args));
            return;
        }

        return originalXHRSend.apply(this, args);
    };

    // ==========================================
    // 5. FALLBACK DE ROTA (CARREGAMENTO INICIAL)
    // ==========================================
    // Garante que, se a página for aberta diretamente pelo link (ou recarregada com F5),
    // a atualização dispare o quanto antes — antes mesmo do primeiro XHR/Fetch nativo
    // acontecer — dando um "head start" na corrida. Se o padrão de hash não bater aqui
    // por algum motivo, o interceptor de rede acima ainda pega a chamada de qualquer forma,
    // só sem a vantagem de tempo.
    const initialRouteCheck = () => {
        const route = pageWindow.location.href;
        const match = route.match(/\/(?:eproc|pje)\/(\d+)/i);
        if (match?.[1]) {
            triggerForcedUpdateSafe(match[1]);
        }
    };

    initialRouteCheck();

})();
