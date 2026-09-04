// ==UserScript==
// @name         Solar - Destacar Prazos
// @namespace    https://solar.defensoria.mg.def.br/
// @version      2.1.0
// @description  Destaca prazos criticos, proximos e expirados nas listas do Solar, com painel de resumo no topo da tabela.
// @author       Defensoria Publica de Minas Gerais
// @match        https://solar.defensoria.mg.def.br/*
// @grant        GM_addStyle
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/gustavobachiao/Scripts-Solar/main/Solar-destacar-prazos.user.js
// @downloadURL  https://raw.githubusercontent.com/gustavobachiao/Scripts-Solar/main/Solar-destacar-prazos.user.js
// @homepageURL  https://github.com/gustavobachiao/Scripts-Solar
// @supportURL   https://github.com/gustavobachiao/Scripts-Solar/issues
// ==/UserScript==

(() => {
    'use strict';

    // ─── CONFIGURAÇÕES DE REGRAS ────────────────────────────────────────────────
    const CONFIG = {
        dias: { amarelo: 4, vermelho: 3, ciencia: 2 },
        seletorTabela: 'table.table-striped.table-hover'
    };

    const urlParams = new URLSearchParams(window.location.search);
    const tipoSituacaoURL = urlParams.get('situacao');

    // Compila a Regex APENAS UMA VEZ na inicialização (Ganho de CPU)
    const REGEX_DATA = /(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/g;

    // ─── INJEÇÃO DE CSS ISOLADO ─────────────────────────────────────────────────
    GM_addStyle(`
        /* Ribbons laterais na primeira coluna para manter o requinte visual */
        tr.solar-critico td:first-child { box-shadow: inset 4px 0 0 0 #c62828 !important; }
        tr.solar-atencao td:first-child { box-shadow: inset 4px 0 0 0 #f9a825 !important; }
        tr.solar-verde td:first-child { box-shadow: inset 4px 0 0 0 #2e7d32 !important; }
        tr.solar-expirado td:first-child { box-shadow: inset 4px 0 0 0 #0073b7 !important; }

        /* Fundo aplicado à LINHA INTEIRA (todos os td's da tr) */
        tr.solar-critico > td { background-color: #ffebee !important; border-bottom: 1px solid #ffcdd2 !important; }
        tr.solar-atencao > td { background-color: #fffde7 !important; border-bottom: 1px solid #fff59d !important; }
        tr.solar-verde > td { background-color: #e8f5e9 !important; border-bottom: 1px solid #c8e6c9 !important; }
        tr.solar-expirado > td { background-color: #F5F9FF !important; border-bottom: 1px solid #0073b7 !important; }

        /* Badges informativos */
        .solar-prazo-badge {
            color: #fff; font-size: 10px; font-weight: bold; padding: 3px 8px;
            border-radius: 4px; margin-top: 6px; display: inline-block;
            white-space: nowrap; text-transform: uppercase; letter-spacing: 0.5px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.15);
        }
        .solar-badge-vermelho { background-color: #d32f2f; }
        .solar-badge-amarelo { background-color: #fbc02d; color: #424242; }
        .solar-badge-amarelo-branco { background-color: #fbc02d; color: #ffffff; }
        .solar-badge-verde { background-color: #2e7d32; }
        .solar-badge-preto { background-color: #0073b7; color: #ffffff; }

        /* Painel Superior de Resumo */
        .solar-resumo-container { display: flex; gap: 12px; margin: 10px 0; flex-wrap: wrap; }
        .solar-resumo-item {
            padding: 6px 16px; border-radius: 6px; font-weight: 600; font-size: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid rgba(0,0,0,0.05);
        }
    `);

    // ─── PARSING DE DATAS (Otimizado) ───────────────────────────────────────────
    const parseDateBR = (str) => {
        if (!str) return null;
        const matches = [...str.matchAll(REGEX_DATA)];
        if (matches.length === 0) return null;
        const m = matches[matches.length - 1];
        return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 23), +(m[5] || 59), 59);
    };

    const diasRestantes = (dataAlvo) => (dataAlvo - new Date()) / 86400000;

    const debounce = (func, wait) => {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    };

    // Variáveis globais para os contadores e o observador
    let observer = null;
    let containerAlvo = null;
    const contadoresGlobais = {
        qtdCienciaProxima: 0, qtdAmarelo: 0, qtdVermelho: 0,
        qtdCienciaSistema: 0, qtdExpirado: 0, qtdFechado: 0
    };

    // ─── MOTOR DE PROCESSAMENTO ─────────────────────────────────────────────────
    function processarTabela() {
        try {
            const tabela = document.querySelector(CONFIG.seletorTabela);
            if (!tabela) return;

            // Delega o filtro de linhas já processadas para o motor nativo (Muito mais rápido)
            const linhasNaoProcessadas = tabela.querySelectorAll('tbody tr:not([data-prazo-processado="1"])');
            if (linhasNaoProcessadas.length === 0) return;

            // Pausa o observador ANTES de mexer no DOM para evitar loop infinito
            if (observer) observer.disconnect();

            let alterouAlguma = false;

            linhasNaoProcessadas.forEach(tr => {
                tr.dataset.prazoProcessado = '1';

                const tdPrazo = tr.querySelector('td.reg_prazo');
                if (!tdPrazo) return;

                if (tipoSituacaoURL === '30') {
                    tr.classList.add('solar-verde');
                    anexarBadge(tdPrazo, 'FECHADO', 'solar-badge-verde', 'fa-check-double');
                    contadoresGlobais.qtdFechado++;
                    alterouAlguma = true;
                    return;
                }

                const textoPrazo = tdPrazo.textContent || '';
                const isHtmlExpirado = textoPrazo.toLowerCase().includes('expirado!');

                const dataVenc = parseDateBR(textoPrazo);
                if (!dataVenc && !isHtmlExpirado) return;

                const dias = dataVenc ? diasRestantes(dataVenc) : -1;
                const isPendenteAbertura = tipoSituacaoURL === '10' || (tr.textContent || '').includes('Aguardando Abertura');
                const isExpiradoContext = tipoSituacaoURL === '40';

                if (isHtmlExpirado || dias < 0) {
                    if (isPendenteAbertura) {
                        tr.classList.add('solar-atencao');
                        anexarBadge(tdPrazo, 'CIÊNCIA REGISTRADA PELO SISTEMA', 'solar-badge-amarelo', 'fa-exclamation-triangle');
                        contadoresGlobais.qtdCienciaSistema++;
                    } else if (isExpiradoContext) {
                        tr.classList.add('solar-expirado');
                        anexarBadge(tdPrazo, 'EXPIRADO O PRAZO FATAL', 'solar-badge-preto', 'fa-times-circle');
                        contadoresGlobais.qtdExpirado++;
                    } else {
                        tr.classList.add('solar-critico');
                        anexarBadge(tdPrazo, 'PRAZO CRÍTICO', 'solar-badge-vermelho', 'fa-exclamation-triangle');
                        contadoresGlobais.qtdVermelho++;
                    }
                    alterouAlguma = true;
                    return;
                }

                if (isPendenteAbertura) {
                    if (dias <= CONFIG.dias.ciencia) {
                        tr.classList.add('solar-atencao');
                        anexarBadge(tdPrazo, 'CIÊNCIA PRÓXIMA', 'solar-badge-amarelo', 'fa-bell');
                        contadoresGlobais.qtdCienciaProxima++;
                        alterouAlguma = true;
                    }
                    return;
                }

                if (dias <= CONFIG.dias.vermelho) {
                    tr.classList.add('solar-critico');
                    anexarBadge(tdPrazo, 'PRAZO CRÍTICO', 'solar-badge-vermelho', 'fa-exclamation-triangle');
                    contadoresGlobais.qtdVermelho++;
                    alterouAlguma = true;
                } else if (dias <= CONFIG.dias.amarelo) {
                    tr.classList.add('solar-atencao');
                    anexarBadge(tdPrazo, 'PRAZO PRÓXIMO', 'solar-badge-amarelo-branco', 'fa-clock');
                    contadoresGlobais.qtdAmarelo++;
                    alterouAlguma = true;
                }
            });

            // Atualiza o resumo de uma vez só se houve mudança
            if (alterouAlguma) {
                atualizarResumo(tabela);
            }

            // Religa o observador APÓS todas as manipulações do DOM
            if (observer && containerAlvo) {
                observer.observe(containerAlvo, { childList: true, subtree: true });
            }

        } catch (error) {
            console.warn('[Solar Tampermonkey - Destacar Prazos]', error);
        }
    }

    function anexarBadge(container, texto, classeCor, icone) {
        const badge = document.createElement('div');
        badge.className = `solar-prazo-badge ${classeCor}`;
        badge.innerHTML = `<i class="fas ${icone}"></i> ${texto}`;
        container.appendChild(badge);
    }

    // ─── CRIAÇÃO DO RESUMO EM LOTE (Evita Layout Thrashing) ─────────────────────
    function atualizarResumo(tabela) {
        try {
            let div = document.getElementById('solar-prazo-resumo');
            if (!div) {
                div = document.createElement('div');
                div.id = 'solar-prazo-resumo';
                div.className = 'solar-resumo-container';
                tabela.parentNode?.insertBefore(div, tabela);
            }

            // Usando array e join para montar a string HTML de uma vez na memória
            const fragmentos = [];

            if (contadoresGlobais.qtdExpirado > 0) fragmentos.push(`<span class="solar-resumo-item" style="background:#0073b7; color:#ffffff;">❌ ${contadoresGlobais.qtdExpirado} expirado(s)</span>`);
            if (contadoresGlobais.qtdFechado > 0) fragmentos.push(`<span class="solar-resumo-item" style="background:#e8f5e9; color:#2e7d32; border-color:#c8e6c9;">✔ ${contadoresGlobais.qtdFechado} fechado(s)</span>`);
            if (contadoresGlobais.qtdCienciaSistema > 0) fragmentos.push(`<span class="solar-resumo-item" style="background:#fffde7; color:#f57f17; border-color:#fff59d;">⚠️ ${contadoresGlobais.qtdCienciaSistema} ciência(s) pelo sistema</span>`);
            if (contadoresGlobais.qtdVermelho > 0) fragmentos.push(`<span class="solar-resumo-item" style="background:#ffebee; color:#c62828; border-color:#ffcdd2;">⚠ ${contadoresGlobais.qtdVermelho} prazo(s) crítico(s)</span>`);
            if (contadoresGlobais.qtdAmarelo > 0) fragmentos.push(`<span class="solar-resumo-item" style="background:#fffde7; color:#f57f17; border-color:#fff59d;">⏰ ${contadoresGlobais.qtdAmarelo} atenção</span>`);
            if (contadoresGlobais.qtdCienciaProxima > 0) fragmentos.push(`<span class="solar-resumo-item" style="background:#fffde7; color:#f57f17; border-color:#fff59d;">🔔 ${contadoresGlobais.qtdCienciaProxima} ciência(s) próxima(s)</span>`);

            // Uma única injeção no DOM
            div.innerHTML = fragmentos.join('');

        } catch (error) {
            console.warn('[Solar Tampermonkey - Resumo]', error);
        }
    }

    // ─── INICIALIZAÇÃO E REATIVIDADE SEGURA ─────────────────────────────────────
    const iniciarObserver = () => {
        containerAlvo = document.querySelector('.table-responsive') ?? document.body;
        const processarDebounced = debounce(processarTabela, 300);

        observer = new MutationObserver((mutations) => {
            // Verificação super leve
            const hasNewNodes = mutations.some(m => m.addedNodes.length > 0);
            if (hasNewNodes) processarDebounced();
        });

        // Inicializa o primeiro processamento
        processarTabela();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciarObserver);
    } else {
        iniciarObserver();
    }

})();
