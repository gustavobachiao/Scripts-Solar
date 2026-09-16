// ==UserScript==
// @name         Solar - Scripts
// @namespace    https://solar.defensoria.mg.def.br/
// @version      1.0.0
// @description  Pacote unico com todas as melhorias de produtividade para o Solar (DPMG): identificacao e impressao rapida de documentos, marcador de processos visitados, materializacao por data, notificador de atendimentos liberados (via API), paginacao avancada, atualizacao forcada de processos, busca na linha do tempo, copia rapida de nome/numero de processo e destaque de prazos. Inclui painel de configuracoes (engrenagem), ativacao/desativacao individual de cada script e historico de atualizacoes puxado do GitHub.
// @author       Defensoria Publica de Minas Gerais - Unidade Passos
// @match        https://*.defensoria.mg.def.br/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_notification
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/gustavobachiao/Scripts-Solar/main/Solar-Scripts.user.js
// @downloadURL  https://raw.githubusercontent.com/gustavobachiao/Scripts-Solar/main/Solar-Scripts.user.js
// @homepageURL  https://github.com/gustavobachiao/Scripts-Solar
// @supportURL   https://github.com/gustavobachiao/Scripts-Solar/issues
// ==/UserScript==

/* ================================================================================================
 * SOLAR - SCRIPTS
 * ------------------------------------------------------------------------------------------------
 * Compilado unico de todos os scripts de produtividade usados no Solar (DPMG - Unidade Passos).
 *
 * COMO ESTE ARQUIVO ESTA ORGANIZADO
 * ------------------------------------------------------------------------------------------------
 * O arquivo segue uma estrutura de topicos e subtopicos (como um sumario academico), para
 * facilitar auditoria, manutencao e localizacao de bugs. Cada script original vira um TOPICO
 * numerado, e as partes internas de cada script viram "Modulo X.Y". Todo topico/modulo esta
 * isolado em sua propria funcao (IIFE), entao nomes de funcoes internas (ex.: "injetarEstilos")
 * podem se repetir entre modulos sem conflito - cada um vive no seu proprio escopo fechado.
 *
 * SUMARIO (INDICE DE TOPICOS)
 * ------------------------------------------------------------------------------------------------
 *  1. NUCLEO COMPARTILHADO (infraestrutura comum a todos os scripts)
 *     1.1. Modulo de Configuracao Global
 *     1.2. Modulo de Log Padronizado
 *     1.3. Modulo de Utilitarios Compartilhados
 *     1.4. Modulo de Estilos Globais
 *     1.5. Modulo de Observacao Central do DOM (MutationObserver compartilhado)
 *     1.6. Modulo de Interface Compartilhada (Modal e Toast genericos)
 *     1.7. Modulo de Gerenciamento de Scripts (ativar/desativar por modulo)
 *     1.8. Modulo do Painel de Configuracoes (icone de engrenagem)
 *     1.9. Modulo de Boas-vindas, Atualizacoes e Changelog remoto (GitHub)
 *  2. SOLAR - IDENTIFICADOR, NAVEGACAO E IMPRESSAO RAPIDA
 *  3. SOLAR - MARCADOR DE PROCESSOS VISITADOS
 *  4. SOLAR - MATERIALIZACAO POR DATA
 *  5. SOLAR - NOTIFICADOR DE ATENDIMENTOS LIBERADOS (VIA API)
 *  6. SOLAR - PAGINACAO AVANCADA
 *  7. SOLAR - ATUALIZACAO FORCADA DE PROCESSOS
 *  8. SOLAR - BUSCA NA LINHA DO TEMPO
 *  9. SOLAR - COPIAR NOME DAS PARTES
 * 10. SOLAR - COPIAR NUMERO DE PROCESSO
 * 11. SOLAR - DESTACAR PRAZOS
 * 12. INICIALIZACAO GERAL (BOOTSTRAP)
 *
 * NOTA SOBRE SANDBOX DO TAMPERMONKEY
 * ------------------------------------------------------------------------------------------------
 * Como este script usa @grant (varios), ele roda em modo "sandbox": o identificador global
 * "window" dentro do script NAO e o mesmo "window" da pagina. Variaveis que a propria pagina
 * define (ex.: "angular", criado pelo AngularJS do Solar) so sao visiveis via "unsafeWindow".
 * Isso e diferente do comportamento de alguns dos scripts originais (@grant none), que rodavam
 * sem sandbox e acessavam "angular" diretamente - por isso, ao migrar, essas referencias foram
 * trocadas para "unsafeWindow.angular". O mesmo vale para qualquer funcao que a pagina precise
 * chamar via HTML inline (ex.: atributo onclick="..."): ela precisa ser exposta em
 * "unsafeWindow", nao em "window".
 * ================================================================================================
 */

(() => {
    'use strict';

    /* ============================================================================================
     * 1. NUCLEO COMPARTILHADO
     * ============================================================================================ */

    /* --------------------------------------------------------------------------------------------
     * 1.1. Modulo de Configuracao Global
     * --------------------------------------------------------------------------------------------
     * Centraliza constantes usadas por varios modulos: identidade do script, dados do repositorio
     * no GitHub (usado pelo modulo de changelog) e as chaves de armazenamento (GM_setValue/
     * GM_getValue) para evitar valores "magicos" espalhados pelo codigo.
     * ------------------------------------------------------------------------------------------ */
    const SolarConfig = {
        NOME_SCRIPT: 'Solar - Scripts',
        VERSAO: (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '1.0.0',

        REPOSITORIO: {
            usuario: 'gustavobachiao',
            nome: 'Scripts-Solar',
            branch: 'main',
        },

        get CHANGELOG_URL() {
            const { usuario, nome, branch } = this.REPOSITORIO;
            return `https://raw.githubusercontent.com/${usuario}/${nome}/${branch}/CHANGELOG.json`;
        },
        get HOMEPAGE_URL() {
            const { usuario, nome } = this.REPOSITORIO;
            return `https://github.com/${usuario}/${nome}`;
        },

        ATENDIMENTO_PAGINA_URL: 'https://solar.defensoria.mg.def.br/atendimento/',

        CHAVES: {
            VERSAO_INSTALADA: 'solarScripts_versaoInstalada',
            MODULO_ATIVO_PREFIXO: 'solarScripts_moduloAtivo_',
            CHANGELOG_CACHE: 'solarScripts_changelogCache',
            MODO_DEBUG: 'solarScripts_modoDebug',
        },
    };

    /* --------------------------------------------------------------------------------------------
     * 1.2. Modulo de Log Padronizado
     * --------------------------------------------------------------------------------------------
     * Fabrica de loggers com prefixo por modulo, no formato "[Solar Scripts - <modulo>]". Assim,
     * ao abrir o console do navegador, da para saber exatamente qual dos 10 scripts originais
     * gerou cada mensagem. Mensagens "info" so aparecem com o modo debug ativado (ver 1.1); avisos
     * e erros sempre aparecem, pois indicam problemas reais.
     * ------------------------------------------------------------------------------------------ */
    function criarLogger(nomeModulo) {
        const prefixo = `[Solar Scripts - ${nomeModulo}]`;
        return {
            info: (...args) => {
                if (GM_getValue(SolarConfig.CHAVES.MODO_DEBUG, false)) {
                    console.log(prefixo, ...args);
                }
            },
            warn: (...args) => console.warn(prefixo, ...args),
            error: (...args) => console.error(prefixo, ...args),
        };
    }

    const logNucleo = criarLogger('Nucleo');

    /* --------------------------------------------------------------------------------------------
     * 1.3. Modulo de Utilitarios Compartilhados
     * --------------------------------------------------------------------------------------------
     * Funcoes puras/genericas usadas por 2 ou mais dos scripts originais. Ficam aqui em vez de
     * duplicadas em cada modulo. Cada funcao indica, no comentario, quais topicos a utilizam.
     * ------------------------------------------------------------------------------------------ */
    const SolarUtils = {
        /**
         * Expressao regular do padrao CNJ de numero de processo (ex.: 0000000-00.0000.0.00.0000).
         * Usada pelos topicos 2 (Identificador), 4 (Materializacao) e 10 (Copiar Numero).
         */
        REGEX_PROCESSO_CNJ: /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/,

        /**
         * Copia texto para a area de transferencia, com fallback via <textarea> + execCommand
         * para navegadores/contextos onde a API moderna (navigator.clipboard) falhe ou esteja
         * bloqueada. Usada pelos topicos 2, 9 e 10 - cada um cuida do proprio feedback visual
         * (cor, icone) apos a copia, pois isso varia de script para script.
         */
        copiarTexto(texto) {
            return navigator.clipboard.writeText(texto).catch(() => {
                const areaTemporaria = document.createElement('textarea');
                areaTemporaria.value = texto;
                areaTemporaria.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
                document.body.appendChild(areaTemporaria);
                areaTemporaria.select();
                try {
                    document.execCommand('copy');
                } finally {
                    document.body.removeChild(areaTemporaria);
                }
            });
        },

        /**
         * Cria um botaozinho de "copiar" (icone Font Awesome) com feedback visual embutido
         * (fica verde com um "check" por 1.5s apos o clique). Usado pelos topicos 9 (Copiar Nome
         * das Partes) e 10 (Copiar Numero de Processo), que so diferem na classe CSS usada para
         * estilizacao - cada um injeta a propria classe no seu modulo de estilos.
         * @param {string} texto - Texto a copiar quando o botao for clicado.
         * @param {string} classeCss - Classe CSS do <span> (controla cor/tamanho/hover).
         * @returns {HTMLSpanElement}
         */
        criarBotaoDeCopia(texto, classeCss) {
            const botao = document.createElement('span');
            botao.className = classeCss;
            botao.title = `Copiar: ${texto}`;
            botao.innerHTML = '<i class="fas fa-copy"></i>';

            botao.addEventListener('click', (evento) => {
                evento.preventDefault();
                evento.stopPropagation();

                SolarUtils.copiarTexto(texto);

                const icone = botao.querySelector('i');
                if (icone) {
                    icone.className = 'fas fa-check';
                    botao.classList.add('copiado');
                    setTimeout(() => {
                        icone.className = 'fas fa-copy';
                        botao.classList.remove('copiado');
                    }, 1500);
                }
            });

            return botao;
        },

        /**
         * Escapa caracteres HTML especiais antes de inserir texto dinamico via innerHTML.
         * Endurecimento de seguranca aplicado a varios modulos (ver topico 7 do sumario de
         * decisoes no changelog): nomes de assistidos e descricoes de eventos vem de dados do
         * sistema (API/Angular) e sao inseridos em innerHTML, entao merecem ser escapados.
         */
        escapeHtml(valor) {
            return String(valor)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        },

        /**
         * Debounce classico: atrasa a execucao de "funcao" ate que "esperaMs" passe sem novas
         * chamadas. Usado por modulos que reagem a mutacoes de DOM em telas com muitas
         * atualizacoes (ex.: topico 11 - Destacar Prazos).
         */
        debounce(funcao, esperaMs) {
            let temporizador;
            return function (...args) {
                clearTimeout(temporizador);
                temporizador = setTimeout(() => funcao.apply(this, args), esperaMs);
            };
        },

        /** Le o valor de um cookie pelo nome. Usado pelos topicos 4 e 5 para obter o csrftoken. */
        lerCookie(nome) {
            const encontrado = document.cookie.match(new RegExp('(?:^|; )' + nome + '=([^;]*)'));
            return encontrado ? decodeURIComponent(encontrado[1]) : null;
        },

        /**
         * Monta os headers padrao exigidos pelo backend do Solar para requisicoes "AJAX
         * oficiais" (X-Requested-With + X-CSRFToken lido do cookie csrftoken). Usado pelos
         * topicos 4 (Materializacao) e 5 (Notificador).
         */
        headersComCsrf(extras = {}) {
            const headers = {
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json, text/plain, */*',
                ...extras,
            };
            const csrfToken = SolarUtils.lerCookie('csrftoken');
            if (csrfToken) headers['X-CSRFToken'] = csrfToken;
            return headers;
        },

        /** Formata minutos em texto legivel ("45 minutos", "1h30min"). Usado pelo topico 5. */
        formatarDuracao(minutos) {
            if (minutos < 60) return `${minutos} minuto${minutos === 1 ? '' : 's'}`;
            const horas = Math.floor(minutos / 60);
            const restoMinutos = minutos % 60;
            return `${horas}h${restoMinutos > 0 ? String(restoMinutos).padStart(2, '0') + 'min' : ''}`;
        },

        /**
         * Compara duas versoes no formato "X.Y.Z". Retorna -1 se a < b, 1 se a > b, 0 se iguais.
         * Usado pelo modulo de changelog (1.9) para decidir quais entradas mostrar apos uma
         * atualizacao.
         */
        compararVersoes(a, b) {
            const partesA = String(a).split('.').map(Number);
            const partesB = String(b).split('.').map(Number);
            const tamanho = Math.max(partesA.length, partesB.length);
            for (let i = 0; i < tamanho; i++) {
                const numeroA = partesA[i] || 0;
                const numeroB = partesB[i] || 0;
                if (numeroA !== numeroB) return numeroA < numeroB ? -1 : 1;
            }
            return 0;
        },

        /**
         * Agenda "callback" para rodar quando o DOM estiver pronto (equivalente a document-end).
         * Necessario porque o script inteiro roda com @run-at document-start (exigido pelo topico
         * 7 - Atualizacao Forcada, que precisa interceptar fetch/XHR antes de qualquer chamada da
         * pagina). Os demais modulos, que antes rodavam em document-end/document-idle, usam esta
         * funcao para so tocar no DOM quando ele already existir.
         */
        aoDomPronto(callback) {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', callback, { once: true });
            } else {
                callback();
            }
        },

        /** Pausa a execucao por "ms" milissegundos. Usado pelo topico 5 (eleicao de lider). */
        esperar(ms) {
            return new Promise((resolve) => setTimeout(resolve, ms));
        },
    };

    /* --------------------------------------------------------------------------------------------
     * 1.4. Modulo de Estilos Globais
     * --------------------------------------------------------------------------------------------
     * CSS compartilhado pelo botao/menu de engrenagem (1.8) e pelos componentes genericos de
     * modal e toast (1.6). Estilos especificos de cada script (topicos 2-11) continuam isolados
     * dentro do proprio modulo, injetados sob demanda - so o que e realmente comum fica aqui.
     * ------------------------------------------------------------------------------------------ */
    function injetarEstilosGlobais() {
        if (document.getElementById('solar-scripts-estilos-globais')) return;

        GM_addStyle(`
            @keyframes solarScriptsGirar { 100% { transform: rotate(360deg); } }
            @keyframes solarScriptsEntrarDireita { from { transform: translateX(30px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
            @keyframes solarScriptsAparecer { from { opacity: 0; } to { opacity: 1; } }

            /* Botao flutuante de engrenagem */
            #solar-scripts-gear-btn {
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 46px;
                height: 46px;
                border-radius: 50%;
                background: #1a4a7a;
                color: #ffffff;
                border: 2px solid rgba(255,255,255,0.5);
                box-shadow: 0 3px 10px rgba(0,0,0,0.35);
                font-size: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                z-index: 2147483000;
                transition: transform 0.2s ease, background 0.2s ease;
            }
            #solar-scripts-gear-btn:hover { background: #2a6099; transform: rotate(25deg) scale(1.05); }

            #solar-scripts-gear-menu {
                position: fixed;
                bottom: 74px;
                right: 20px;
                background: #ffffff;
                color: #222;
                border-radius: 8px;
                box-shadow: 0 6px 24px rgba(0,0,0,0.3);
                min-width: 260px;
                padding: 6px;
                z-index: 2147483000;
                font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
                display: none;
                animation: solarScriptsAparecer 0.15s ease-out;
            }
            #solar-scripts-gear-menu.solar-scripts-aberto { display: block; }
            .solar-scripts-gear-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 10px 12px;
                border-radius: 5px;
                cursor: pointer;
                font-size: 13.5px;
                font-weight: 600;
                color: #222;
            }
            .solar-scripts-gear-item:hover { background: #f0f4f9; }
            .solar-scripts-gear-separador { height: 1px; background: #eaeaea; margin: 4px 6px; }
            .solar-scripts-gear-rodape { padding: 6px 12px 4px; font-size: 11px; color: #999; text-align: center; }

            /* Modal generico (1.6) */
            .solar-scripts-modal-backdrop {
                position: fixed;
                inset: 0;
                background: rgba(0,0,0,0.5);
                z-index: 2147483100;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: solarScriptsAparecer 0.15s ease-out;
            }
            .solar-scripts-modal {
                background: #fff;
                color: #222;
                border-radius: 8px;
                padding: 20px 24px;
                width: 480px;
                max-width: 92vw;
                max-height: 84vh;
                overflow-y: auto;
                font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
                box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            }
            .solar-scripts-modal h3 { margin: 0 0 4px; font-size: 17px; color: #0b3d2e; }
            .solar-scripts-modal p.solar-scripts-hint { margin: 0 0 12px; font-size: 12.5px; color: #777; }
            .solar-scripts-modal hr { border: none; border-top: 1px solid #e5e5e5; margin: 12px 0; }
            .solar-scripts-modal-acoes { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
            .solar-scripts-modal button { border: none; border-radius: 5px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
            .solar-scripts-btn-primario { background: #0b3d2e; color: #fff; }
            .solar-scripts-btn-secundario { background: #eee; color: #333; }
            .solar-scripts-check-linha {
                display: flex;
                align-items: flex-start;
                gap: 8px;
                padding: 8px 4px;
                font-size: 13.5px;
                border-radius: 4px;
            }
            .solar-scripts-check-linha:hover { background: #f4f6f8; }
            .solar-scripts-check-linha label { cursor: pointer; }
            .solar-scripts-check-descricao { font-size: 11.5px; color: #888; display: block; margin-top: 1px; }

            /* Toast generico (1.6) */
            .solar-scripts-toast-container {
                position: fixed;
                top: 16px;
                right: 16px;
                z-index: 2147483200;
                display: flex;
                flex-direction: column;
                gap: 8px;
                pointer-events: none;
            }
            .solar-scripts-toast {
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
                animation: solarScriptsEntrarDireita 0.25s ease-out;
            }
            .solar-scripts-toast-urgente { background: #4a0e0e; border-left-color: #e03131; }
            .solar-scripts-toast strong { display: block; margin-bottom: 6px; font-size: 15px; padding-right: 4px; }
            .solar-scripts-toast-linha { display: block; }
            .solar-scripts-toast-linha-total { display: block; margin-top: 8px; opacity: 0.85; font-size: 13px; }
            .solar-scripts-toast-fechar {
                position: absolute; top: 6px; right: 8px; background: transparent; border: none;
                color: #fff; opacity: 0.7; font-size: 20px; line-height: 1; cursor: pointer; padding: 2px 6px;
            }
            .solar-scripts-toast-fechar:hover { opacity: 1; }
            .solar-scripts-toast-abrir {
                display: block; margin-top: 12px; background: #2ea3ff; color: #0b1f33; border: none;
                border-radius: 5px; padding: 7px 14px; font-size: 13px; font-weight: 700; cursor: pointer;
            }
            .solar-scripts-toast-abrir:hover { filter: brightness(1.06); }
            .solar-scripts-toast-urgente .solar-scripts-toast-abrir { background: #e03131; color: #fff; }
        `);

        const marcador = document.createElement('meta');
        marcador.id = 'solar-scripts-estilos-globais';
        marcador.style.display = 'none';
        (document.head || document.documentElement).appendChild(marcador);
    }

    /* --------------------------------------------------------------------------------------------
     * 1.5. Modulo de Observacao Central do DOM
     * --------------------------------------------------------------------------------------------
     * Nos scripts originais, praticamente cada um criava o seu proprio "new MutationObserver(...)"
     * escutando document.body inteiro - ou seja, varias telas do Solar chegavam a rodar 6-7
     * observers independentes reagindo as mesmas mutacoes (o Solar e uma SPA em AngularJS que
     * redesenha a tela com frequencia). Este modulo cria UM UNICO observer compartilhado; cada
     * modulo que precisar reagir a mudancas no DOM apenas "assina" um callback. Isso reduz o
     * overhead de CPU sem mudar o comportamento de nenhum script.
     *
     * Tambem expoe pausar()/retomar(), usado pelo topico 11 (Destacar Prazos) para evitar que
     * as proprias mutacoes que ele gera (insercao de badges) disparem uma nova rodada de
     * callbacks - inclusive os de outros modulos - enquanto ele escreve no DOM.
     * ------------------------------------------------------------------------------------------ */
    const SolarObservadorDOM = (() => {
        const logObs = criarLogger('Observador DOM');
        const assinantes = new Set();
        let observer = null;
        let pausado = false;

        function garantirObserverAtivo() {
            if (observer) return;
            observer = new MutationObserver((mutations) => {
                if (pausado) return;
                assinantes.forEach((callback) => {
                    try {
                        callback(mutations);
                    } catch (erro) {
                        logObs.error('Um assinante do observador central lancou um erro.', erro);
                    }
                });
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }

        /** Registra um callback(mutations) chamado a cada leva de mutacoes no <body>. */
        function assinar(callback) {
            assinantes.add(callback);
            garantirObserverAtivo();
            return () => assinantes.delete(callback);
        }

        /** Pausa temporariamente o disparo de TODOS os assinantes (ver nota acima). */
        function pausar() { pausado = true; }

        /** Retoma o disparo normal dos assinantes. */
        function retomar() { pausado = false; }

        return { assinar, pausar, retomar };
    })();

    /* --------------------------------------------------------------------------------------------
     * 1.6. Modulo de Interface Compartilhada (Modal e Toast genericos)
     * --------------------------------------------------------------------------------------------
     * Componentes visuais reutilizaveis. Antes, o topico 5 (Notificador) tinha seu proprio
     * sistema de modal/toast, todo duplicado internamente para cada uma das suas duas telas de
     * configuracao. Agora existe UM construtor de modal e UM de toast, usados tanto pelas novas
     * telas (Configurar Notificador, Ativar/Desativar Scripts, Historico de Atualizacoes, Boas-
     * vindas) quanto pelo proprio topico 5 - o CSS fica no modulo 1.4 e nao se repete mais.
     * ------------------------------------------------------------------------------------------ */
    const SolarUI = (() => {
        /**
         * Abre um modal generico centralizado na tela.
         * @param {object} opcoes
         * @param {string} opcoes.titulo - HTML do cabecalho (pode incluir emoji).
         * @param {string} [opcoes.dica] - Texto pequeno e cinza logo abaixo do titulo.
         * @param {string|HTMLElement} opcoes.corpo - Conteudo principal do modal.
         * @param {Array<{texto:string, classe?:'primario'|'secundario', aoClicar:Function}>} [opcoes.acoes]
         * @param {(modal: HTMLElement) => void} [opcoes.aoAbrir] - Chamado apos o modal ser inserido no DOM.
         * @param {boolean} [opcoes.fecharAoClicarFora=true]
         * @returns {{ backdrop: HTMLElement, modal: HTMLElement, fechar: Function }}
         */
        function abrirModal({ titulo, dica, corpo, acoes = [], aoAbrir, fecharAoClicarFora = true, largura }) {
            const backdrop = document.createElement('div');
            backdrop.className = 'solar-scripts-modal-backdrop';

            const modal = document.createElement('div');
            modal.className = 'solar-scripts-modal';
            if (largura) modal.style.width = largura;

            const cabecalho = document.createElement('h3');
            cabecalho.innerHTML = titulo;
            modal.appendChild(cabecalho);

            if (dica) {
                const dicaEl = document.createElement('p');
                dicaEl.className = 'solar-scripts-hint';
                dicaEl.innerHTML = dica;
                modal.appendChild(dicaEl);
            }

            const corpoEl = document.createElement('div');
            corpoEl.className = 'solar-scripts-modal-corpo';
            if (typeof corpo === 'string') {
                corpoEl.innerHTML = corpo;
            } else if (corpo instanceof HTMLElement) {
                corpoEl.appendChild(corpo);
            }
            modal.appendChild(corpoEl);

            if (acoes.length > 0) {
                const acoesEl = document.createElement('div');
                acoesEl.className = 'solar-scripts-modal-acoes';
                acoes.forEach((acao) => {
                    const botao = document.createElement('button');
                    botao.type = 'button';
                    botao.className = acao.classe === 'primario' ? 'solar-scripts-btn-primario' : 'solar-scripts-btn-secundario';
                    botao.textContent = acao.texto;
                    botao.addEventListener('click', () => acao.aoClicar?.(fechar, modal));
                    acoesEl.appendChild(botao);
                });
                modal.appendChild(acoesEl);
            }

            backdrop.appendChild(modal);
            document.body.appendChild(backdrop);

            function fechar() {
                backdrop.remove();
                document.removeEventListener('keydown', aoPressionarTecla);
            }

            function aoPressionarTecla(evento) {
                if (evento.key === 'Escape') fechar();
            }
            document.addEventListener('keydown', aoPressionarTecla);

            if (fecharAoClicarFora) {
                backdrop.addEventListener('click', (evento) => {
                    if (evento.target === backdrop) fechar();
                });
            }

            aoAbrir?.(modal);

            return { backdrop, modal, fechar };
        }

        /** Garante que o container fixo dos toasts exista e devolve a referencia dele. */
        function garantirContainerToast() {
            if (!document.body) return null;
            let container = document.querySelector('.solar-scripts-toast-container');
            if (!container) {
                container = document.createElement('div');
                container.className = 'solar-scripts-toast-container';
                document.body.appendChild(container);
            }
            return container;
        }

        /**
         * Mostra um toast (aviso nao-bloqueante) no canto superior direito, com botao opcional
         * de acao e botao de fechar. Fica visivel ate o usuario interagir (nao some sozinho),
         * seguindo o comportamento original do topico 5.
         */
        function mostrarToast({ titulo, linhasHtml, urgente = false, aoClicarAbrir, textoBotaoAbrir = 'Abrir' }) {
            const container = garantirContainerToast();
            if (!container) return null;

            const toast = document.createElement('div');
            toast.className = urgente ? 'solar-scripts-toast solar-scripts-toast-urgente' : 'solar-scripts-toast';
            toast.innerHTML = `
                <button type="button" class="solar-scripts-toast-fechar" aria-label="Fechar">&times;</button>
                <strong>${titulo}</strong>
                ${linhasHtml}
                ${aoClicarAbrir ? `<button type="button" class="solar-scripts-toast-abrir">${textoBotaoAbrir}</button>` : ''}
            `;

            toast.querySelector('.solar-scripts-toast-fechar').addEventListener('click', () => toast.remove());
            if (aoClicarAbrir) {
                toast.querySelector('.solar-scripts-toast-abrir').addEventListener('click', () => {
                    aoClicarAbrir();
                    toast.remove();
                });
            }

            container.appendChild(toast);
            return toast;
        }

        return { abrirModal, mostrarToast };
    })();

    /* --------------------------------------------------------------------------------------------
     * 1.7. Modulo de Gerenciamento de Scripts (ativar/desativar por modulo)
     * --------------------------------------------------------------------------------------------
     * Guarda, via GM_setValue/GM_getValue, se cada um dos scripts (topicos 2-11) esta ativo ou
     * nao. Por padrao TODOS comecam ativos (mesmo comportamento de antes, quando cada script era
     * instalado separadamente). A tela que edita esses valores fica no modulo 1.8; aqui fica so a
     * logica de leitura/escrita do estado.
     * ------------------------------------------------------------------------------------------ */
    const SolarGerenciadorDeModulos = (() => {
        function chaveDoModulo(id) {
            return `${SolarConfig.CHAVES.MODULO_ATIVO_PREFIXO}${id}`;
        }

        function estaAtivo(id) {
            return GM_getValue(chaveDoModulo(id), true);
        }

        function definirAtivo(id, ativo) {
            GM_setValue(chaveDoModulo(id), Boolean(ativo));
        }

        return { estaAtivo, definirAtivo };
    })();

    /* --------------------------------------------------------------------------------------------
     * 1.8. Modulo do Painel de Configuracoes (icone de engrenagem)
     * --------------------------------------------------------------------------------------------
     * Cria o botao flutuante (engrenagem) visivel em qualquer pagina do Solar e o menu que se
     * abre a partir dele. Este modulo NAO sabe o que cada item do menu faz - ele so oferece
     * "registrarItemMenu(...)", que qualquer outro modulo pode chamar para se anunciar no menu.
     * Isso mantem o painel desacoplado: o topico 5 (Notificador) registra a sua propria opcao de
     * configuracao, o modulo 1.7 (via bootstrap) registra "Ativar/Desativar Scripts", e o modulo
     * 1.9 registra "Historico de Atualizacoes" - cada um cuidando do proprio conteudo.
     * ------------------------------------------------------------------------------------------ */
    const SolarPainelConfiguracoes = (() => {
        const logPainel = criarLogger('Painel de Configuracoes');
        const itensMenu = [];
        let menuAberto = false;
        let elementoBotao = null;
        let elementoMenu = null;

        function renderizarMenu() {
            if (!elementoMenu) return;
            elementoMenu.innerHTML = '';

            itensMenu.forEach((item) => {
                const linha = document.createElement('div');
                linha.className = 'solar-scripts-gear-item';
                linha.innerHTML = `<span>${item.icone}</span><span>${item.texto}</span>`;
                linha.addEventListener('click', () => {
                    fecharMenu();
                    item.aoClicar();
                });
                elementoMenu.appendChild(linha);
            });

            const separador = document.createElement('div');
            separador.className = 'solar-scripts-gear-separador';
            elementoMenu.appendChild(separador);

            const rodape = document.createElement('div');
            rodape.className = 'solar-scripts-gear-rodape';
            rodape.textContent = `${SolarConfig.NOME_SCRIPT} - v${SolarConfig.VERSAO}`;
            elementoMenu.appendChild(rodape);
        }

        function alternarMenu() {
            menuAberto = !menuAberto;
            elementoMenu.classList.toggle('solar-scripts-aberto', menuAberto);
        }

        function fecharMenu() {
            menuAberto = false;
            elementoMenu?.classList.remove('solar-scripts-aberto');
        }

        /**
         * Registra um item no menu da engrenagem.
         * @param {{icone: string, texto: string, aoClicar: Function}} item
         */
        function registrarItemMenu(item) {
            itensMenu.push(item);
            renderizarMenu();
        }

        function inicializar() {
            if (document.getElementById('solar-scripts-gear-btn') || !document.body) return;
            injetarEstilosGlobais();

            elementoBotao = document.createElement('div');
            elementoBotao.id = 'solar-scripts-gear-btn';
            elementoBotao.title = 'Configuracoes do Solar - Scripts';
            elementoBotao.textContent = '⚙️';

            elementoMenu = document.createElement('div');
            elementoMenu.id = 'solar-scripts-gear-menu';

            elementoBotao.addEventListener('click', (evento) => {
                evento.stopPropagation();
                alternarMenu();
            });
            document.addEventListener('click', (evento) => {
                if (menuAberto && !elementoMenu.contains(evento.target) && evento.target !== elementoBotao) {
                    fecharMenu();
                }
            });

            document.body.appendChild(elementoBotao);
            document.body.appendChild(elementoMenu);

            renderizarMenu();
            logPainel.info('Painel de configuracoes (engrenagem) inicializado.');
        }

        return { inicializar, registrarItemMenu };
    })();

    /* --------------------------------------------------------------------------------------------
     * 1.9. Modulo de Boas-vindas, Atualizacoes e Changelog remoto (GitHub)
     * --------------------------------------------------------------------------------------------
     * Responsavel por 3 coisas:
     *   a) Mostrar uma mensagem de boas-vindas na primeira instalacao;
     *   b) Mostrar uma mensagem de atualizacao (com o que mudou) sempre que a versao instalada
     *      for diferente da versao anterior conhecida;
     *   c) Alimentar a tela "Historico de Atualizacoes" (registrada no painel da engrenagem),
     *      que busca o changelog completo direto do GitHub (CHANGELOG.json na raiz do
     *      repositorio configurado em SolarConfig.REPOSITORIO), com um changelog local embutido
     *      como plano B (funciona mesmo offline ou se o GitHub estiver fora do ar).
     *
     * IMPORTANTE PARA MANUTENCAO FUTURA: a cada nova versao publicada, atualize as DUAS listas:
     *   1. O array CHANGELOG_LOCAL abaixo (garante a mensagem de atualizacao mesmo sem rede);
     *   2. O arquivo CHANGELOG.json na raiz do repositorio (alimenta o historico completo).
     * ------------------------------------------------------------------------------------------ */
    const SolarChangelog = (() => {
        const logChangelog = criarLogger('Changelog');

        const CHANGELOG_LOCAL = [
            {
                versao: '1.0.0',
                data: '2026-09-16',
                mudancas: [
                    'Unificacao de todos os scripts do Solar (10 ao todo) em um unico arquivo instalavel: "Solar - Scripts".',
                    'Novo painel de configuracoes: icone de engrenagem fixo no canto da tela, com menu para configurar o Notificador, ativar/desativar cada script individualmente e ver este historico de atualizacoes.',
                    'As configuracoes do Notificador de Atendimentos (antes acessiveis so pelo menu da extensao do Tampermonkey) agora tambem ficam disponiveis direto na pagina, pelo painel de engrenagem.',
                    'Mensagens automaticas de boas-vindas (na instalacao) e de atualizacao (a cada nova versao), com a lista do que mudou.',
                    'Correcao: acesso ao AngularJS da pagina (variavel "angular") ajustado para funcionar corretamente no modo sandbox do Tampermonkey, exigido para o script unico funcionar com multiplas permissoes (GM_*).',
                    'Correcao: cor invalida (##0bc210) no estado desabilitado do botao de Materializacao por Data.',
                    'Endurecimento de seguranca: nomes e descricoes vindos da API/Angular agora sao escapados antes de entrar na tela (evita que caracteres especiais quebrem o layout ou injetem HTML).',
                    'Otimizacao: os varios observadores de mudanca de tela (MutationObserver) que cada script rodava separadamente foram unificados em um unico observador compartilhado.',
                ],
            },
        ];

        function obterVersaoMaisRecenteLocal() {
            return CHANGELOG_LOCAL[0]?.versao ?? SolarConfig.VERSAO;
        }

        function renderizarEntradas(entradas) {
            if (!entradas || entradas.length === 0) {
                return '<p class="solar-scripts-hint">Nenhum registro de atualizacao disponivel.</p>';
            }
            return entradas.map((entrada) => `
                <div style="margin-bottom:14px;">
                    <div style="font-weight:700; color:#0b3d2e; font-size:14px;">
                        Versao ${SolarUtils.escapeHtml(entrada.versao)}
                        <span style="font-weight:400; color:#999; font-size:12px;">- ${SolarUtils.escapeHtml(entrada.data || '')}</span>
                    </div>
                    <ul style="margin:6px 0 0 18px; padding:0; font-size:13px; line-height:1.5;">
                        ${(entrada.mudancas || []).map((mudanca) => `<li>${SolarUtils.escapeHtml(mudanca)}</li>`).join('')}
                    </ul>
                </div>
            `).join('');
        }

        /** Busca o CHANGELOG.json do GitHub. Resolve null em caso de qualquer falha (sem lancar). */
        function buscarChangelogRemoto() {
            return new Promise((resolve) => {
                if (typeof GM_xmlhttpRequest !== 'function') {
                    resolve(null);
                    return;
                }
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: SolarConfig.CHANGELOG_URL,
                    timeout: 8000,
                    onload: (resposta) => {
                        try {
                            if (resposta.status < 200 || resposta.status >= 300) {
                                resolve(null);
                                return;
                            }
                            const dados = JSON.parse(resposta.responseText);
                            if (!Array.isArray(dados)) {
                                resolve(null);
                                return;
                            }
                            GM_setValue(SolarConfig.CHAVES.CHANGELOG_CACHE, { obtidoEm: Date.now(), entradas: dados });
                            resolve(dados);
                        } catch (erro) {
                            logChangelog.warn('Changelog remoto veio em formato inesperado.', erro);
                            resolve(null);
                        }
                    },
                    onerror: () => resolve(null),
                    ontimeout: () => resolve(null),
                });
            });
        }

        /** Changelog completo: tenta o GitHub, cai para cache local salvo, e por fim para o embutido. */
        async function obterChangelogCompleto() {
            const remoto = await buscarChangelogRemoto();
            if (remoto) return { entradas: remoto, origem: 'github' };

            const cache = GM_getValue(SolarConfig.CHAVES.CHANGELOG_CACHE, null);
            if (cache?.entradas?.length) return { entradas: cache.entradas, origem: 'cache' };

            return { entradas: CHANGELOG_LOCAL, origem: 'local' };
        }

        /** Abre a tela "Historico de Atualizacoes" (item do menu da engrenagem). */
        function abrirHistoricoCompleto() {
            const { modal } = SolarUI.abrirModal({
                titulo: '📜 Historico de Atualizacoes',
                dica: 'Buscando a lista completa de versoes no GitHub...',
                corpo: '<div id="solar-scripts-historico-corpo" style="min-height:60px;">Carregando...</div>',
                acoes: [
                    { texto: 'Fechar', classe: 'secundario', aoClicar: (fechar) => fechar() },
                ],
            });

            obterChangelogCompleto().then(({ entradas, origem }) => {
                const corpo = modal.querySelector('#solar-scripts-historico-corpo');
                if (!corpo) return;
                corpo.innerHTML = renderizarEntradas(entradas);

                const dicaEl = modal.querySelector('.solar-scripts-hint');
                if (dicaEl) {
                    const textoOrigem = origem === 'github'
                        ? 'Lista atualizada, obtida agora do GitHub.'
                        : origem === 'cache'
                            ? 'Nao foi possivel acessar o GitHub agora - mostrando a ultima lista obtida com sucesso.'
                            : 'Nao foi possivel acessar o GitHub - mostrando a lista basica incluida no proprio script.';
                    dicaEl.textContent = textoOrigem;
                }
            });
        }

        /** Modal de boas-vindas, mostrado uma unica vez, na primeira instalacao. */
        function mostrarBoasVindas(modulosDisponiveis) {
            const listaModulos = modulosDisponiveis.map((modulo) => `
                <li style="margin-bottom:6px;"><strong>${SolarUtils.escapeHtml(modulo.nome)}</strong>
                    <span style="color:#777;"> - ${SolarUtils.escapeHtml(modulo.descricao)}</span>
                </li>
            `).join('');

            SolarUI.abrirModal({
                titulo: `👋 Bem-vindo(a) ao ${SolarConfig.NOME_SCRIPT}!`,
                dica: `Versao instalada: ${SolarConfig.VERSAO}`,
                corpo: `
                    <p style="font-size:13.5px;">Este pacote reune, em um unico script, todas as melhorias de produtividade para o Solar:</p>
                    <ul style="font-size:13px; padding-left:18px; margin:8px 0;">${listaModulos}</ul>
                    <p style="font-size:13px; margin-top:12px;">
                        Procure o icone <strong>⚙️</strong> no canto inferior direito da tela: e por ele que voce
                        configura o Notificador, ativa/desativa scripts individualmente e consulta o historico de
                        atualizacoes.
                    </p>
                `,
                acoes: [{ texto: 'Entendi!', classe: 'primario', aoClicar: (fechar) => fechar() }],
            });
        }

        /** Modal de atualizacao, mostrado quando a versao instalada muda. */
        function mostrarAtualizacao(versaoAnterior, versaoAtual) {
            const entradasNovas = CHANGELOG_LOCAL.filter(
                (entrada) => SolarUtils.compararVersoes(entrada.versao, versaoAnterior) > 0
                    && SolarUtils.compararVersoes(entrada.versao, versaoAtual) <= 0
            );
            const entradasParaMostrar = entradasNovas.length > 0 ? entradasNovas : CHANGELOG_LOCAL.slice(0, 1);

            SolarUI.abrirModal({
                titulo: `🚀 ${SolarConfig.NOME_SCRIPT} foi atualizado!`,
                dica: `${versaoAnterior} &rarr; ${versaoAtual}`,
                corpo: `
                    ${renderizarEntradas(entradasParaMostrar)}
                    <p class="solar-scripts-hint" style="margin-top:10px;">
                        Veja o historico completo a qualquer momento em ⚙️ &rarr; Historico de Atualizacoes.
                    </p>
                `,
                acoes: [{ texto: 'Ok, entendi', classe: 'primario', aoClicar: (fechar) => fechar() }],
            });
        }

        /**
         * Ponto de entrada chamado no boot: compara a versao instalada anteriormente (guardada
         * via GM_setValue) com a versao atual do script e decide se mostra boas-vindas, mostra
         * atualizacao, ou nao mostra nada (versao ja conhecida).
         */
        function verificarInstalacaoOuAtualizacao(modulosDisponiveis) {
            const versaoInstalada = GM_getValue(SolarConfig.CHAVES.VERSAO_INSTALADA, null);

            if (versaoInstalada === null) {
                mostrarBoasVindas(modulosDisponiveis);
                GM_setValue(SolarConfig.CHAVES.VERSAO_INSTALADA, SolarConfig.VERSAO);
                return;
            }

            if (versaoInstalada !== SolarConfig.VERSAO) {
                mostrarAtualizacao(versaoInstalada, SolarConfig.VERSAO);
                GM_setValue(SolarConfig.CHAVES.VERSAO_INSTALADA, SolarConfig.VERSAO);
            }
        }

        function registrarNoPainel() {
            SolarPainelConfiguracoes.registrarItemMenu({
                icone: '📜',
                texto: 'Historico de Atualizacoes',
                aoClicar: abrirHistoricoCompleto,
            });
        }

        return { verificarInstalacaoOuAtualizacao, abrirHistoricoCompleto, registrarNoPainel, obterVersaoMaisRecenteLocal };
    })();

    /* ============================================================================================
     * 2. SOLAR - IDENTIFICADOR, NAVEGACAO E IMPRESSAO RAPIDA
     * ============================================================================================
     * Mostra o numero do evento no topo do documento aberto, permite navegar entre documentos do
     * mesmo processo (primeiro/anterior/proximo/ultimo) e abre o PDF em nova aba para garantir a
     * impressao. So atua dentro de /atendimento/, onde o visualizador de documentos aparece.
     * ------------------------------------------------------------------------------------------ */
    const ModuloIdentificador = (() => {
        const log = criarLogger('2. Identificador');

        /* ---- 2.1. Modulo de Integracao com AngularJS ---------------------------------------- */
        function obterEscopoAngular() {
            const elemento = document.querySelector('[ng-controller="AudienciaCtrl"]');
            if (!elemento) return null;
            try {
                return unsafeWindow.angular.element(elemento).scope();
            } catch (erro) {
                return null;
            }
        }

        function obterEventos() {
            const escopo = obterEscopoAngular();
            return (escopo && escopo.eproc && escopo.eproc.processo && escopo.eproc.processo.eventos) || null;
        }

        function obterTodosDocumentos() {
            const eventos = obterEventos();
            const listaDocs = [];
            if (!eventos) return listaDocs;
            const eventosOrdenados = [...eventos].reverse();
            eventosOrdenados.forEach((evento) => {
                (evento.documentos || []).forEach((doc) => listaDocs.push(String(doc.documento)));
            });
            return listaDocs;
        }

        function encontrarEventoPorDocId(docId) {
            const eventos = obterEventos();
            if (!docId || !eventos) return null;
            for (const evento of eventos) {
                const docs = evento.documentos || [];
                if (docs.some((doc) => String(doc.documento) === String(docId))) {
                    return { numero: evento.numero, descricao: evento.descricao };
                }
            }
            return null;
        }

        function extrairDocId(src) {
            if (!src) return null;
            const encontrado = src.match(/\/documento\/(\d+)\//);
            return encontrado ? encontrado[1] : null;
        }

        function navegarPara(targetDocId) {
            const embed = document.getElementById('embed');
            if (!embed || !targetDocId) return;
            const srcAtual = embed.getAttribute('src');
            if (!srcAtual) return;
            embed.setAttribute('src', srcAtual.replace(/\/documento\/\d+\//, `/documento/${targetDocId}/`));
        }

        /* ---- 2.2. Modulo de Utilidades de Copia e Impressao ---------------------------------- */
        function dispararImpressao() {
            const embed = document.getElementById('embed');
            if (!embed) {
                alert('Documento nao encontrado para impressao.');
                return;
            }

            const src = embed.getAttribute('src');
            if (!src) {
                alert('Nao foi possivel obter o endereco do documento.');
                return;
            }

            const novaAba = window.open(src, '_blank');
            if (!novaAba) {
                alert('O navegador bloqueou a abertura da impressao. Clique no icone de "Pop-up bloqueado" na barra de enderecos e selecione "Sempre permitir".');
                return;
            }

            novaAba.focus();
            novaAba.onload = () => {
                setTimeout(() => novaAba.print(), 500);
            };
        }

        // Exposta em unsafeWindow (nao em "window") porque e chamada a partir de HTML inserido
        // via innerHTML na pagina (onclick="..."), que executa no contexto real da pagina - ver
        // nota sobre sandbox no cabecalho do arquivo. So e registrada dentro de iniciar() (ver
        // 2.6), respeitando ativacao/desativacao do modulo em vez de rodar sempre.
        function exporFuncaoDeCopiaRapida() {
            unsafeWindow.solarCopiarEventoRapido = function (elemento, numero) {
                SolarUtils.copiarTexto(numero);

                const htmlOriginal = elemento.innerHTML;
                elemento.innerHTML = '✅';
                elemento.style.color = '#28a745';

                setTimeout(() => {
                    elemento.innerHTML = htmlOriginal;
                    elemento.style.color = '#f0c040';
                }, 1200);
            };
        }

        /* ---- 2.3. Modulo de Estilos ----------------------------------------------------------- */
        function injetarEstilos() {
            if (document.getElementById('solar-identificador-estilos')) return;
            GM_addStyle(`
                .solar-id-nav-btn {
                    background: rgba(255, 255, 255, 0.15); border: 1px solid rgba(255, 255, 255, 0.4);
                    color: #ffffff; border-radius: 4px; padding: 4px 10px; margin-left: 4px;
                    cursor: pointer; font-weight: bold; font-size: 14px; transition: all 0.2s ease;
                    font-family: monospace; display: inline-flex; align-items: center; justify-content: center;
                }
                .solar-id-nav-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.35); border-color: #f0c040; }
                .solar-id-nav-btn:disabled { opacity: 0.3; cursor: not-allowed; border-color: rgba(255, 255, 255, 0.2); }
                .solar-id-print-btn {
                    background: #28a745; border: 1px solid #1e7e34; color: #ffffff; border-radius: 4px;
                    padding: 4px 12px; margin-left: 12px; cursor: pointer; font-weight: bold; font-size: 13px;
                    transition: all 0.2s ease; display: inline-flex; align-items: center; gap: 4px;
                }
                .solar-id-print-btn:hover { background: #218838; border-color: #1c7430; transform: scale(1.03); }
                .solar-id-copy-btn { cursor: pointer; margin-left: 8px; color: #f0c040; font-size: 1.1em; display: inline-block; transition: transform 0.1s; }
                .solar-id-copy-btn:hover { color: #ffffff !important; transform: scale(1.2); }
            `);
            const marcador = document.createElement('meta');
            marcador.id = 'solar-identificador-estilos';
            marcador.style.display = 'none';
            document.head.appendChild(marcador);
        }

        /* ---- 2.4. Modulo de Interface (Banner de Evento) -------------------------------------- */
        function criarBanner() {
            injetarEstilos();

            const banner = document.createElement('div');
            banner.id = 'evento-banner-solar';
            banner.style.cssText = [
                'background: linear-gradient(135deg, #1a4a7a 0%, #2a6099 100%)',
                'color: #ffffff', 'padding: 9px 18px', 'margin: 8px 15px 0 15px', 'border-radius: 6px',
                'font-size: 13.5px', 'font-weight: bold', 'font-family: inherit', 'display: none',
                'align-items: center', 'justify-content: space-between', 'box-shadow: 0 2px 6px rgba(0,0,0,0.28)',
                'border-left: 5px solid #f0c040', 'letter-spacing: 0.01em', 'user-select: none',
            ].join(';');

            banner.addEventListener('click', (evento) => {
                const btnNav = evento.target.closest('.solar-id-nav-btn');
                if (btnNav && !btnNav.disabled) {
                    const targetId = btnNav.getAttribute('data-target-id');
                    if (targetId) navegarPara(targetId);
                    return;
                }

                const btnPrint = evento.target.closest('.solar-id-print-btn');
                if (btnPrint) dispararImpressao();
            });

            return banner;
        }

        function atualizarBanner(src) {
            const banner = document.getElementById('evento-banner-solar');
            if (!banner) return;

            const docId = extrairDocId(src);
            const evento = encontrarEventoPorDocId(docId);

            if (!evento) {
                banner.style.display = 'none';
                return;
            }

            banner.style.display = 'flex';

            const todosDocs = obterTodosDocumentos();
            const indiceAtual = todosDocs.indexOf(String(docId));

            const primeiroId = todosDocs[0] || '';
            const ultimoId = todosDocs[todosDocs.length - 1] || '';
            const anteriorId = indiceAtual > 0 ? todosDocs[indiceAtual - 1] : '';
            const proximoId = (indiceAtual !== -1 && indiceAtual < todosDocs.length - 1) ? todosDocs[indiceAtual + 1] : '';

            const desabilitarPrimeiroAnterior = indiceAtual <= 0 ? 'disabled' : '';
            const desabilitarProximoUltimo = (indiceAtual === -1 || indiceAtual >= todosDocs.length - 1) ? 'disabled' : '';

            const infoHtml = `
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:17px;line-height:1">📋</span>
                    <span>Evento <strong>${evento.numero}</strong>
                        <span class="solar-id-copy-btn" title="Copiar numero do evento" onclick="window.solarCopiarEventoRapido(this, '${evento.numero}')">📄</span>
                        &mdash; ${SolarUtils.escapeHtml(evento.descricao)}
                    </span>
                </div>
            `;

            const controlesHtml = `
                <div style="display:flex; align-items:center;">
                    <button class="solar-id-nav-btn" data-target-id="${primeiroId}" title="Primeiro documento (mais antigo)" ${desabilitarPrimeiroAnterior}>|&larr;</button>
                    <button class="solar-id-nav-btn" data-target-id="${anteriorId}" title="Documento anterior" ${desabilitarPrimeiroAnterior}>&larr;</button>
                    <button class="solar-id-nav-btn" data-target-id="${proximoId}" title="Proximo documento" ${desabilitarProximoUltimo}>&rarr;</button>
                    <button class="solar-id-nav-btn" data-target-id="${ultimoId}" title="Ultimo documento (mais recente)" ${desabilitarProximoUltimo}>&rarr;|</button>
                    <button class="solar-id-print-btn" title="Imprimir este documento"><span>🖶️</span> Imprimir</button>
                </div>
            `;

            banner.innerHTML = infoHtml + controlesHtml;
        }

        /* ---- 2.5. Modulo de Inicializacao e Monitoramento do DOM ------------------------------ */
        let observadorEmbed = null;

        function atualizarBannerComRetentativa(embed, tentativa) {
            const src = embed.getAttribute('src');
            const docId = extrairDocId(src);
            const evento = encontrarEventoPorDocId(docId);

            if (evento || tentativa >= 20) {
                atualizarBanner(src);
                return;
            }
            setTimeout(() => atualizarBannerComRetentativa(embed, tentativa + 1), 300);
        }

        function instalarNaEmbed(embed) {
            const span9 = embed.parentElement;
            if (!span9) return;

            let banner = document.getElementById('evento-banner-solar');
            if (!banner) {
                banner = criarBanner();
                span9.insertBefore(banner, embed);
            } else if (banner.parentElement !== span9) {
                span9.insertBefore(banner, embed);
            }

            atualizarBannerComRetentativa(embed, 0);

            if (observadorEmbed) observadorEmbed.disconnect();
            observadorEmbed = new MutationObserver((mutations) => {
                mutations.forEach((mutacao) => {
                    if (mutacao.attributeName === 'src') atualizarBannerComRetentativa(embed, 0);
                });
            });
            observadorEmbed.observe(embed, { attributes: true, attributeFilter: ['src'] });
        }

        function observarSurgimentoDaEmbed() {
            return SolarObservadorDOM.assinar((mutations) => {
                for (const mutacao of mutations) {
                    for (const node of mutacao.addedNodes) {
                        if (node.id === 'embed' && node.tagName === 'EMBED') {
                            instalarNaEmbed(node);
                            return;
                        }
                        if (node.querySelector) {
                            const encontrado = node.querySelector('embed#embed');
                            if (encontrado) {
                                instalarNaEmbed(encontrado);
                                return;
                            }
                        }
                    }
                }
            });
        }

        function iniciarAposDom() {
            const embed = document.getElementById('embed');
            if (embed && embed.tagName === 'EMBED') instalarNaEmbed(embed);
            observarSurgimentoDaEmbed();
        }

        function aguardarAngular() {
            const escopo = obterEscopoAngular();
            if (typeof unsafeWindow.angular !== 'undefined' && escopo && escopo.eproc) {
                iniciarAposDom();
            } else {
                setTimeout(aguardarAngular, 300);
            }
        }

        /* ---- 2.6. Ponto de entrada do modulo --------------------------------------------------- */
        function iniciar() {
            exporFuncaoDeCopiaRapida();
            log.info('Modulo iniciado - aguardando AngularJS carregar o processo.');
            aguardarAngular();
        }

        return {
            id: 'identificador',
            nome: 'Identificador, Navegacao e Impressao Rapida',
            descricao: 'Mostra o numero do evento, permite navegar entre documentos e imprime com um clique.',
            quando: 'dom',
            ativarEm: (pathname) => pathname.startsWith('/atendimento/'),
            iniciar,
        };
    })();

    /* ============================================================================================
     * 3. SOLAR - MARCADOR DE PROCESSOS VISITADOS
     * ============================================================================================
     * Pinta de roxo o numero do processo assim que o usuario clica nele (ou no botao de copiar
     * associado), marcando visualmente quais processos ja foram visitados na sessao.
     * ------------------------------------------------------------------------------------------ */
    const ModuloMarcadorVisitados = (() => {
        const log = criarLogger('3. Marcador de Visitados');

        /* ---- 3.1. Modulo de Deteccao e Marcacao ------------------------------------------------ */
        function aoClicarNoDocumento(evento) {
            const alvo = evento.target;

            // 1. Tenta achar o link do processo diretamente (clique no proprio numero).
            let linkProcesso = alvo.closest('a.btn-link[href*="/processo/identificar/"], a.btn-link[href*="/processo/listar/"]');

            // 2. Se nao foi no numero, verifica se foi em algum "botao de copiar" proximo.
            if (!linkProcesso) {
                const botaoCopiar = alvo.closest('[title*="opiar"], [class*="copy"], [class*="copiar"], .fa-copy, .fa-clipboard, [ng-click*="copiar"]');
                if (botaoCopiar) {
                    const container = botaoCopiar.closest('td, li, div.media, div.media-body, span, div');
                    if (container) {
                        linkProcesso = container.querySelector('a.btn-link[href*="/processo/identificar/"], a.btn-link[href*="/processo/listar/"]');
                    }
                }
            }

            // 3. Se identificou o processo do clique, pinta-o de roxo.
            if (linkProcesso) {
                const textoProcesso = linkProcesso.querySelector('b');
                (textoProcesso || linkProcesso).style.setProperty('color', '#800080', 'important');
            }
        }

        /* ---- 3.2. Ponto de entrada do modulo --------------------------------------------------- */
        function iniciar() {
            // A "fase de captura" (terceiro argumento "true") faz este listener ouvir o clique
            // ANTES do Solar poder bloquea-lo - preservado do script original.
            document.body.addEventListener('click', aoClicarNoDocumento, true);
            log.info('Modulo iniciado.');
        }

        return {
            id: 'marcador-visitados',
            nome: 'Marcador de Processos Visitados',
            descricao: 'Pinta de roxo o numero do processo ao clicar, marcando o que ja foi visitado.',
            quando: 'dom',
            ativarEm: () => true,
            iniciar,
        };
    })();

    /* ============================================================================================
     * 4. SOLAR - MATERIALIZACAO POR DATA
     * ============================================================================================
     * Adiciona um filtro por intervalo de datas ao lado do botao nativo de materializacao,
     * permitindo gerar um PDF unico apenas com os documentos protocolados no periodo informado.
     * ------------------------------------------------------------------------------------------ */
    const ModuloMaterializacaoPorData = (() => {
        const log = criarLogger('4. Materializacao por Data');

        /* ---- 4.1. Modulo de Estilos ------------------------------------------------------------ */
        function injetarEstilos() {
            if (document.getElementById('solar-materializacao-estilos')) return;
            GM_addStyle(`
                .solar-mat-container {
                    display: inline-flex; align-items: center; gap: 10px;
                    margin-left: 15px; padding: 5px 10px;
                    background-color: #f8f9fa; border: 1px solid #ddd; border-radius: 4px;
                }
                .solar-mat-input {
                    border: 1px solid #ccc; border-radius: 3px; padding: 2px 5px; font-size: 12px;
                    color: #333 !important; background: #fff !important; height: auto !important;
                }
                .solar-mat-btn {
                    background-color: #0056b3; color: white; border: none; transition: 0.2s;
                    padding: 4px 10px; border-radius: 3px; cursor: pointer; font-size: 12px; font-weight: bold;
                }
                .solar-mat-btn:hover { background-color: #0bc210; }
                /* Correcao: o script original tinha "##0bc210" (cor invalida) aqui, que o navegador
                   simplesmente ignorava. Usamos um cinza neutro, mais correto semanticamente para
                   um estado desabilitado. */
                .solar-mat-btn:disabled { background-color: #9e9e9e; cursor: not-allowed; }
                .solar-mat-status { font-size: 12px; color: #0056b3; font-weight: bold; display: none; }
            `);
            const marcador = document.createElement('meta');
            marcador.id = 'solar-materializacao-estilos';
            marcador.style.display = 'none';
            document.head.appendChild(marcador);
        }

        /* ---- 4.2. Modulo de Utilitarios de Data ------------------------------------------------ */
        function stringParaData(isoStr, fimDoDia = false) {
            if (!isoStr) return null;
            const [ano, mes, dia] = isoStr.split('-');
            if (fimDoDia) return new Date(+ano, +mes - 1, +dia, 23, 59, 59);
            return new Date(+ano, +mes - 1, +dia, 0, 0, 0);
        }

        /* ---- 4.3. Modulo de Requisicoes (Motor de Materializacao) ------------------------------ */
        async function realizarMaterializacao(dataInicioStr, dataFimStr) {
            const dataInicio = stringParaData(dataInicioStr, false);
            const dataFim = stringParaData(dataFimStr, true);
            const statusEl = document.getElementById('solar-mat-status');

            const btnOriginal = document.querySelector('#botaoDocumentoUnificado');
            if (!btnOriginal) return alert('Botao original de materializacao nao encontrado.');

            const idProcessoEncontrado = btnOriginal.getAttribute('ng-click').match(/\d+/);
            if (!idProcessoEncontrado) return alert('Falha ao extrair ID numerico do processo.');
            const idProcesso = idProcessoEncontrado[0];

            const escopoAngular = unsafeWindow.angular.element(btnOriginal).scope();
            if (!escopoAngular?.eproc?.processo?.eventos) return alert('Arvore de eventos do Angular inacessivel.');

            const eventosFiltrados = escopoAngular.eproc.processo.eventos.filter((evento) => {
                if (!evento.data_protocolo) return false;
                const dataEvento = new Date(evento.data_protocolo);
                return dataEvento >= dataInicio && dataEvento <= dataFim;
            });

            let totalDocumentos = 0;
            eventosFiltrados.forEach((evento) => { totalDocumentos += (evento.documentos ? evento.documentos.length : 0); });

            if (totalDocumentos === 0) {
                alert('[Solar] Nenhum documento atrelado encontrado para esta data.');
                reiniciarInterface();
                return;
            }

            // Ordenacao cronologica crescente: documentos mais antigos primeiro.
            eventosFiltrados.sort((a, b) => new Date(a.data_protocolo) - new Date(b.data_protocolo));

            try {
                const opcoesFetch = { headers: SolarUtils.headersComCsrf(), credentials: 'same-origin' };

                statusEl.textContent = 'Sincronizando...';
                await fetch(`/procapi/processo/${idProcesso}/lista_eventos_materializacao/?forcar_atualizacao=true`, { ...opcoesFetch, method: 'GET' });

                const formData = new FormData();
                formData.append('processo_numero_grau', idProcesso);

                let documentoAtual = 0;
                for (const evento of eventosFiltrados) {
                    if (!evento.documentos) continue;
                    for (const doc of evento.documentos) {
                        documentoAtual++;
                        statusEl.textContent = `Baixando documento ${documentoAtual} de ${totalDocumentos}...`;

                        const jsonParam = encodeURIComponent(JSON.stringify(doc));
                        const urlConversao = `/procapi/processo/${idProcesso}/documento/${doc.documento}?converter=true&informacoes_documento=${jsonParam}`;
                        const respostaDoc = await fetch(urlConversao, { ...opcoesFetch, method: 'GET' });

                        if (respostaDoc.ok) {
                            const blob = await respostaDoc.blob();
                            formData.append('arquivos', blob, `${doc.documento}.pdf`);
                        } else {
                            log.warn(`Documento ignorado por erro no servidor: ${doc.documento}`);
                        }
                    }
                }

                statusEl.textContent = 'Finalizando...';
                const urlUnificar = `/atendimento/solicitacoes-documentos-atendimento/unificar-pdf?processo_numero_grau=${idProcesso}`;
                const respostaMerge = await fetch(urlUnificar, {
                    method: 'POST',
                    headers: opcoesFetch.headers,
                    credentials: 'same-origin',
                    body: formData,
                });

                if (!respostaMerge.ok) {
                    const erroServidor = await respostaMerge.text();
                    log.error('Erro do backend ao unificar PDF.', erroServidor);
                    throw new Error(`Falha ${respostaMerge.status} na requisicao de unificacao.`);
                }

                const blobFinal = await respostaMerge.blob();
                const objUrl = URL.createObjectURL(blobFinal);

                const numeroProcesso = document.body.textContent.match(SolarUtils.REGEX_PROCESSO_CNJ)?.[0] || idProcesso;
                const nomeArquivo = `Materializacao_Parcial_${numeroProcesso.replace(/\D/g, '')}.pdf`;

                const link = document.createElement('a');
                link.href = objUrl;
                link.download = nomeArquivo;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(objUrl);

                statusEl.style.color = '#28a745';
                statusEl.textContent = 'Download Concluido! ✔️';
                setTimeout(reiniciarInterface, 4000);
            } catch (erro) {
                log.error('Falha ao materializar documentos.', erro);
                statusEl.style.color = '#dc3545';
                statusEl.textContent = 'Erro ao materializar. Tente novamente.';
                setTimeout(reiniciarInterface, 4000);
            }
        }

        /* ---- 4.4. Modulo de Interface (Injecao de UI) ------------------------------------------ */
        function reiniciarInterface() {
            const btn = document.getElementById('solar-mat-trigger');
            const status = document.getElementById('solar-mat-status');
            if (btn) { btn.style.display = 'inline'; btn.disabled = false; }
            if (status) { status.style.display = 'none'; status.style.color = '#0056b3'; }
        }

        function injetarInterface() {
            if (document.querySelector('#solar-mat-date-filter')) return;

            const botaoAlvo = document.querySelector('#botaoDocumentoUnificado');
            if (!botaoAlvo || !botaoAlvo.parentNode) return;

            const container = document.createElement('div');
            container.id = 'solar-mat-date-filter';
            container.className = 'solar-mat-container';

            const hoje = new Date().toISOString().split('T')[0];

            container.innerHTML = `
                <label style="font-size: 12px; margin:0; color:#333;">Inicio: <input type="date" id="solar-mat-inicio" class="solar-mat-input"></label>
                <label style="font-size: 12px; margin:0; color:#333;">Fim: <input type="date" id="solar-mat-fim" class="solar-mat-input" value="${hoje}"></label>
                <button id="solar-mat-trigger" class="solar-mat-btn">Materializacao por Data</button>
                <span id="solar-mat-status" class="solar-mat-status">Aguardando...</span>
            `;

            botaoAlvo.parentNode.insertBefore(container, botaoAlvo.nextSibling);

            document.getElementById('solar-mat-trigger').addEventListener('click', (evento) => {
                evento.preventDefault();
                const inicio = document.getElementById('solar-mat-inicio').value;
                const fim = document.getElementById('solar-mat-fim').value;
                if (!inicio || !fim) return alert('Por favor, defina as datas.');

                const btn = evento.target;
                const status = document.getElementById('solar-mat-status');
                btn.disabled = true;
                btn.style.display = 'none';
                status.style.display = 'inline';
                status.style.color = '#0056b3';
                status.textContent = 'Iniciando extracao...';

                realizarMaterializacao(inicio, fim);
            });
        }

        /* ---- 4.5. Ponto de entrada do modulo ---------------------------------------------------- */
        function iniciar() {
            injetarEstilos();

            SolarObservadorDOM.assinar(() => {
                if (document.querySelector('#botaoDocumentoUnificado')) injetarInterface();
            });

            setTimeout(injetarInterface, 1000);
            log.info('Modulo iniciado.');
        }

        return {
            id: 'materializacao-por-data',
            nome: 'Materializacao por Data',
            descricao: 'Gera um PDF unico apenas com os documentos protocolados no intervalo de datas informado.',
            quando: 'dom',
            ativarEm: () => true,
            iniciar,
        };
    })();

    /* ============================================================================================
     * 5. SOLAR - NOTIFICADOR DE ATENDIMENTOS LIBERADOS (VIA API)
     * ============================================================================================
     * Consulta periodicamente a API do Solar e alerta (balao na tela + som + notificacao do
     * sistema operacional) quando um atendimento novo entra na fila "Liberados", em qualquer aba
     * aberta do Solar. Tambem alerta quando um atendimento fica tempo demais parado (ninguem
     * clicou em "Atender", ou alguem atendeu mas nao finalizou).
     *
     * IMPORTANTE SOBRE CONFIGURACOES: no script original, essas preferencias so eram acessiveis
     * clicando no icone da extensao Tampermonkey (GM_registerMenuCommand). Agora existe uma tela
     * unica "Configurar Notificador" acessivel pelo painel de engrenagem (modulo 1.8), reunindo
     * filtro de defensorias, alertas de atraso e som em um so lugar (item 2 do pedido original).
     * Os comandos de menu do Tampermonkey continuam existindo, como atalho extra.
     * ------------------------------------------------------------------------------------------ */
    const ModuloNotificador = (() => {
        const log = criarLogger('5. Notificador');

        /* ---- 5.1. Modulo de Configuracao -------------------------------------------------------- */
        const CONFIG = {
            API_LISTA_URL: 'https://solar.defensoria.mg.def.br/atendimento/index/get/',

            // Defensoria usada exclusivamente para emissao de senha pela recepcao. Tem
            // liberado:true mas NAO deve contar como "liberado de verdade".
            DEFENSORIA_TRIAGEM_EXCLUIR: 'TRIAGEM PASSOS',

            POLL_INTERVAL_MS: 30_000,
            LOCK_TTL_MS: 45_000,
            LOCK_CONFIRMACAO_MIN_MS: 250,
            LOCK_CONFIRMACAO_JITTER_MS: 250,

            MAX_NOMES_NO_TOAST: 3,

            ALERTA_DEMORA_MINUTOS_PADRAO: 30,
            ALERTA_ESQUECEU_MINUTOS_PADRAO: 60,

            // O backend do Solar emite os timestamps ja em horario local de Brasilia (UTC-3), mas
            // com o sufixo "Z" do ISO 8601 (que tecnicamente indica UTC). Corrigimos somando de
            // volta 3h. So valido enquanto o Solar usar horario de Brasilia (sem horario de
            // verao, que o Brasil nao usa desde 2019).
            CORRECAO_FUSO_BACKEND_MS: 3 * 60 * 60 * 1000,

            PRIMEIRA_CHECAGEM_JITTER_MAX_MS: 3_000,

            STORAGE_COUNT: 'solarNotifApi_liberadosCount',
            STORAGE_CONHECIDOS: 'solarNotifApi_assistidosConhecidos',
            STORAGE_EVENT: 'solarNotifApi_event',

            STORAGE_EVENT_DEMORA: 'solarNotifApi_eventDemora',
            STORAGE_ALERTA_DEMORA_ENVIADOS: 'solarNotifApi_alertaDemoraEnviados',
            STORAGE_ALERTA_DEMORA_ATIVO: 'solarNotifApi_alertaDemoraAtivo',
            STORAGE_ALERTA_DEMORA_MINUTOS: 'solarNotifApi_alertaDemoraMinutos',

            STORAGE_EVENT_ESQUECEU: 'solarNotifApi_eventEsqueceu',
            STORAGE_ALERTA_ESQUECEU_ENVIADOS: 'solarNotifApi_alertaEsqueceuEnviados',
            STORAGE_ALERTA_ESQUECEU_ATIVO: 'solarNotifApi_alertaEsqueceuAtivo',
            STORAGE_ALERTA_ESQUECEU_MINUTOS: 'solarNotifApi_alertaEsqueceuMinutos',

            STORAGE_LOCK: 'solarNotifApi_lock',
            STORAGE_SOUND_ON: 'solarNotifApi_soundOn',
            STORAGE_FILTRO_ATIVO: 'solarNotifApi_filtroAtivo',
            STORAGE_DEFENSORIAS_CONHECIDAS: 'solarNotifApi_defensoriasConhecidas',
            STORAGE_DEFENSORIAS_FILTRO: 'solarNotifApi_defensoriasFiltro',
        };

        const TAB_ID = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

        /* ---- 5.2. Modulo de Estilos especificos (o restante vem do nucleo, modulo 1.4) --------- */
        function injetarEstilos() {
            if (document.getElementById('solar-notif-estilos')) return;
            GM_addStyle(`
                .solar-notif-input-nome { flex: 1; padding: 7px 9px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px; }
                .solar-notif-btn-remover { background: transparent; border: none; color: #c00; cursor: pointer; font-size: 17px; line-height: 1; padding: 0 6px; }
                .solar-notif-btn-remover:hover { color: #900; }
                .solar-notif-secao-titulo { font-weight: 700; color: #0b3d2e; margin: 14px 0 6px; font-size: 13.5px; }
                .solar-notif-secao-titulo:first-child { margin-top: 0; }
                .solar-notif-avancado summary { cursor: pointer; font-size: 12.5px; color: #555; margin-top: 12px; }
                .solar-notif-avancado-botoes { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
                .solar-notif-avancado-botoes button { background: #eee; color: #333; border: none; border-radius: 4px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
                .solar-notif-avancado-botoes button:hover { background: #ddd; }
            `);
            const marcador = document.createElement('meta');
            marcador.id = 'solar-notif-estilos';
            marcador.style.display = 'none';
            document.head.appendChild(marcador);
        }

        /* ---- 5.3. Modulo de Som ------------------------------------------------------------------ */
        function somEstaAtivo() {
            return GM_getValue(CONFIG.STORAGE_SOUND_ON, true);
        }

        function tocarSinoDeAlerta() {
            if (!somEstaAtivo()) return;
            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) return;
                const contexto = new AudioCtx();
                const notas = [523.25, 659.25, 783.99]; // C5-E5-G5, onda triangular
                notas.forEach((frequencia, indice) => {
                    const oscilador = contexto.createOscillator();
                    const ganho = contexto.createGain();
                    oscilador.type = 'triangle';
                    oscilador.frequency.value = frequencia;
                    ganho.gain.value = 0.0001;
                    oscilador.connect(ganho).connect(contexto.destination);
                    const inicio = contexto.currentTime + indice * 0.14;
                    ganho.gain.exponentialRampToValueAtTime(0.35, inicio + 0.02);
                    ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.55);
                    oscilador.start(inicio);
                    oscilador.stop(inicio + 0.6);
                });
                setTimeout(() => contexto.close().catch((erro) => log.warn('Falha ao fechar AudioContext', erro)), 1400);
            } catch (erro) {
                log.warn('Falha ao tocar som de notificacao (possivel bloqueio de autoplay do navegador).', erro);
            }
        }

        /* ---- 5.4. Modulo de Filtro de Defensorias ------------------------------------------------ */
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
            atendimentos.forEach((atendimento) => {
                if (atendimento.defensoria && !conhecidas.has(atendimento.defensoria)) {
                    conhecidas.add(atendimento.defensoria);
                    houveNovidade = true;
                }
            });
            if (houveNovidade) {
                GM_setValue(CONFIG.STORAGE_DEFENSORIAS_CONHECIDAS, [...conhecidas].sort((a, b) => a.localeCompare(b, 'pt-BR')));
            }
        }

        /* ---- 5.5. Modulo do Painel de Configuracoes (tela unica "Configurar Notificador") ------
         * Reune o que antes eram duas telas separadas (filtro de defensorias + alertas de
         * atraso) mais o controle de som, tudo em um unico modal, seguindo o pedido de ter uma
         * engrenagem "Configurar Script Notificador". Construido sobre o modal generico do
         * nucleo (modulo 1.6).
         * ---------------------------------------------------------------------------------------- */
        function abrirConfiguracoes() {
            injetarEstilos();

            const filtroAtivoSalvo = GM_getValue(CONFIG.STORAGE_FILTRO_ATIVO, false);
            let conhecidas = GM_getValue(CONFIG.STORAGE_DEFENSORIAS_CONHECIDAS, []).slice();
            const filtroSalvo = GM_getValue(CONFIG.STORAGE_DEFENSORIAS_FILTRO, null);
            const notificandoTodasInicial = !filtroSalvo || filtroSalvo.length === 0;
            const selecionadas = new Set(notificandoTodasInicial ? conhecidas : filtroSalvo);

            const demoraAtivo = GM_getValue(CONFIG.STORAGE_ALERTA_DEMORA_ATIVO, true);
            const demoraMinutos = GM_getValue(CONFIG.STORAGE_ALERTA_DEMORA_MINUTOS, CONFIG.ALERTA_DEMORA_MINUTOS_PADRAO);
            const esqueceuAtivo = GM_getValue(CONFIG.STORAGE_ALERTA_ESQUECEU_ATIVO, true);
            const esqueceuMinutos = GM_getValue(CONFIG.STORAGE_ALERTA_ESQUECEU_MINUTOS, CONFIG.ALERTA_ESQUECEU_MINUTOS_PADRAO);
            const somAtivoSalvo = somEstaAtivo();

            const corpo = `
                <div class="solar-notif-secao-titulo">🔔 Filtro de defensorias notificadas</div>
                <label class="solar-scripts-check-linha" style="font-weight:700;">
                    <input type="checkbox" id="sn-filtro-ativo" ${filtroAtivoSalvo ? 'checked' : ''}>
                    <span>Ativar filtro de defensorias
                        <span class="solar-scripts-check-descricao">Desativado (padrao): todas as defensorias notificam. Ativado: voce escolhe quais - digite o nome manualmente ou espere o script capturar automaticamente.</span>
                    </span>
                </label>
                <div id="sn-bloco-filtro" style="margin-left:4px;">
                    <label class="solar-scripts-check-linha">
                        <input type="checkbox" id="sn-todas">
                        <span>Notificar todas (inclusive novas que aparecerem)</span>
                    </label>
                    <div style="display:flex; gap:6px; margin: 8px 0;">
                        <input type="text" id="sn-input-nome" class="solar-notif-input-nome" placeholder="Nome exato da defensoria (ex.: DEFENSORIA DAS FAMILIAS DE PASSOS)">
                        <button type="button" id="sn-btn-adicionar" class="solar-scripts-btn-secundario">Adicionar</button>
                    </div>
                    <div id="sn-lista"></div>
                </div>

                <hr>
                <div class="solar-notif-secao-titulo">⏰ Alertas de atraso</div>
                <label class="solar-scripts-check-linha" style="font-weight:700;">
                    <input type="checkbox" id="sn-demora-ativo" ${demoraAtivo ? 'checked' : ''}>
                    <span>Atendimento aguardando (ninguem clicou em "Atender")</span>
                </label>
                <div style="display:flex; align-items:center; gap:8px; margin: 2px 0 12px 26px;">
                    <span style="font-size:13px;">Avisar a cada</span>
                    <input type="number" id="sn-demora-minutos" min="1" step="1" value="${demoraMinutos}"
                           style="width:64px; padding:5px 7px; border:1px solid #ccc; border-radius:4px; font-size:13px;">
                    <span style="font-size:13px;">minutos</span>
                </div>
                <label class="solar-scripts-check-linha" style="font-weight:700;">
                    <input type="checkbox" id="sn-esqueceu-ativo" ${esqueceuAtivo ? 'checked' : ''}>
                    <span>Atendimento iniciado, mas nao finalizado no sistema</span>
                </label>
                <div style="display:flex; align-items:center; gap:8px; margin: 2px 0 12px 26px;">
                    <span style="font-size:13px;">Avisar a cada</span>
                    <input type="number" id="sn-esqueceu-minutos" min="1" step="1" value="${esqueceuMinutos}"
                           style="width:64px; padding:5px 7px; border:1px solid #ccc; border-radius:4px; font-size:13px;">
                    <span style="font-size:13px;">minutos</span>
                </div>

                <hr>
                <div class="solar-notif-secao-titulo">🔊 Som</div>
                <label class="solar-scripts-check-linha">
                    <input type="checkbox" id="sn-som-ativo" ${somAtivoSalvo ? 'checked' : ''}>
                    <span>Tocar som ao notificar um novo atendimento liberado</span>
                </label>

                <details class="solar-notif-avancado">
                    <summary>Ferramentas avancadas</summary>
                    <div class="solar-notif-avancado-botoes">
                        <button type="button" id="sn-testar-notificacao">🔔 Testar notificacao agora</button>
                        <button type="button" id="sn-testar-windows">🖥️ Testar notificacao do Windows</button>
                        <button type="button" id="sn-resetar-baseline">♻️ Resetar baseline de contagem</button>
                    </div>
                </details>
            `;

            const { modal, fechar } = SolarUI.abrirModal({
                titulo: '🔔 Configurar Notificador de Atendimentos',
                dica: 'Alertas sobre novos atendimentos liberados e atendimentos parados, em qualquer aba aberta do Solar.',
                corpo,
                largura: '540px',
                acoes: [
                    { texto: 'Cancelar', classe: 'secundario', aoClicar: (fecharModal) => fecharModal() },
                    {
                        texto: 'Salvar',
                        classe: 'primario',
                        aoClicar: (fecharModal, modalEl) => {
                            const filtroAtivo = modalEl.querySelector('#sn-filtro-ativo').checked;
                            GM_setValue(CONFIG.STORAGE_FILTRO_ATIVO, filtroAtivo);

                            if (!filtroAtivo) {
                                log.info('Filtro de defensorias desativado: todas voltam a notificar.');
                            } else if (modalEl.querySelector('#sn-todas').checked) {
                                GM_setValue(CONFIG.STORAGE_DEFENSORIAS_FILTRO, null);
                                log.info('Filtro ativado: notificando todas as defensorias.');
                            } else {
                                const selecionadasFinal = [...selecionadas].filter((defensoria) => conhecidas.includes(defensoria));
                                GM_setValue(CONFIG.STORAGE_DEFENSORIAS_FILTRO, selecionadasFinal);
                                log.info('Filtro de defensorias salvo:', selecionadasFinal);
                            }

                            GM_setValue(CONFIG.STORAGE_ALERTA_DEMORA_ATIVO, modalEl.querySelector('#sn-demora-ativo').checked);
                            GM_setValue(
                                CONFIG.STORAGE_ALERTA_DEMORA_MINUTOS,
                                Math.max(1, Number(modalEl.querySelector('#sn-demora-minutos').value) || CONFIG.ALERTA_DEMORA_MINUTOS_PADRAO)
                            );
                            GM_setValue(CONFIG.STORAGE_ALERTA_ESQUECEU_ATIVO, modalEl.querySelector('#sn-esqueceu-ativo').checked);
                            GM_setValue(
                                CONFIG.STORAGE_ALERTA_ESQUECEU_MINUTOS,
                                Math.max(1, Number(modalEl.querySelector('#sn-esqueceu-minutos').value) || CONFIG.ALERTA_ESQUECEU_MINUTOS_PADRAO)
                            );
                            GM_setValue(CONFIG.STORAGE_SOUND_ON, modalEl.querySelector('#sn-som-ativo').checked);

                            log.info('Configuracoes do Notificador salvas.');
                            fecharModal();
                        },
                    },
                ],
                aoAbrir(modal) {
                    const checkFiltroAtivo = modal.querySelector('#sn-filtro-ativo');
                    const blocoFiltro = modal.querySelector('#sn-bloco-filtro');
                    const checkTodas = modal.querySelector('#sn-todas');
                    const listaEl = modal.querySelector('#sn-lista');
                    const inputNome = modal.querySelector('#sn-input-nome');
                    const btnAdicionar = modal.querySelector('#sn-btn-adicionar');
                    checkTodas.checked = notificandoTodasInicial;

                    function renderizarLista() {
                        if (conhecidas.length === 0) {
                            listaEl.innerHTML = '<p class="solar-scripts-hint">Nenhuma defensoria ainda. Adicione manualmente acima, ou deixe o script capturar automaticamente enquanto roda (a cada 30s, com o filtro ativado).</p>';
                            return;
                        }

                        listaEl.innerHTML = conhecidas.map((defensoria, indice) => `
                            <div class="solar-scripts-check-linha" style="justify-content:space-between;">
                                <label style="display:flex; align-items:center; gap:8px; flex:1;">
                                    <input type="checkbox" data-defensoria-idx="${indice}"
                                        ${checkTodas.checked ? 'disabled' : ''}
                                        ${checkTodas.checked || selecionadas.has(defensoria) ? 'checked' : ''}>
                                    <span>${SolarUtils.escapeHtml(defensoria)}</span>
                                </label>
                                <button type="button" class="solar-notif-btn-remover" data-remover-idx="${indice}" title="Remover">&times;</button>
                            </div>
                        `).join('');

                        listaEl.querySelectorAll('[data-defensoria-idx]').forEach((checkbox) => {
                            checkbox.addEventListener('change', () => {
                                const nome = conhecidas[Number(checkbox.dataset.defensoriaIdx)];
                                if (checkbox.checked) selecionadas.add(nome);
                                else selecionadas.delete(nome);
                            });
                        });

                        listaEl.querySelectorAll('[data-remover-idx]').forEach((botao) => {
                            botao.addEventListener('click', () => {
                                const indice = Number(botao.dataset.removerIdx);
                                const removida = conhecidas[indice];
                                conhecidas.splice(indice, 1);
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

                    modal.querySelector('#sn-testar-notificacao').addEventListener('click', () => {
                        tratarEventoNovoAtendimento({
                            novos: [{ nome: 'FULANO DE TAL DA SILVA (teste)', defensoria: 'DEFENSORIA DE TESTE (GERAL)', numero: `teste-${Date.now()}` }],
                            total: (GM_getValue(CONFIG.STORAGE_COUNT, 0) ?? 0) + 1,
                        });
                    });

                    modal.querySelector('#sn-testar-windows').addEventListener('click', () => {
                        if (typeof GM_notification !== 'function') {
                            log.warn('GM_notification nao esta disponivel nesta instalacao do Tampermonkey/navegador.');
                            return;
                        }
                        try {
                            GM_notification({
                                title: '🖥️ Teste de notificacao do Windows',
                                text: 'Se voce esta vendo isso, as notificacoes do sistema operacional estao funcionando nesta maquina.',
                                timeout: 10000,
                            });
                        } catch (erro) {
                            log.error('GM_notification lancou um erro ao tentar notificar.', erro);
                        }
                    });

                    modal.querySelector('#sn-resetar-baseline').addEventListener('click', () => {
                        GM_setValue(CONFIG.STORAGE_COUNT, null);
                        GM_setValue(CONFIG.STORAGE_CONHECIDOS, null);
                        GM_setValue(CONFIG.STORAGE_ALERTA_DEMORA_ENVIADOS, {});
                        GM_setValue(CONFIG.STORAGE_ALERTA_ESQUECEU_ENVIADOS, {});
                        SolarUI.mostrarToast({
                            titulo: '♻️ Baseline resetado',
                            linhasHtml: '<span class="solar-scripts-toast-linha">A proxima checagem ja vai notificar normalmente sobre quem estiver na fila agora.</span>',
                        });
                    });
                },
            });
        }

        function registrarNoPainel() {
            SolarPainelConfiguracoes.registrarItemMenu({
                icone: '🔔',
                texto: 'Configurar Notificador',
                aoClicar: abrirConfiguracoes,
            });
        }

        /* ---- 5.6. Modulo de Eleicao de Lider entre Abas (com reconfirmacao) --------------------- */
        async function tentarAssumirLideranca() {
            const lock = GM_getValue(CONFIG.STORAGE_LOCK, null);
            const agora = Date.now();
            const semLiderAtivo = !lock || (agora - lock.ts) > CONFIG.LOCK_TTL_MS;
            const jaSouLider = lock?.id === TAB_ID;

            if (!semLiderAtivo && !jaSouLider) return false;

            GM_setValue(CONFIG.STORAGE_LOCK, { id: TAB_ID, ts: agora });

            // Reconfirmacao: espera um pouco e relê o lock. Se outra aba tambem tentou assumir
            // neste meio-tempo, ela sobrescreveu com o proprio id, e desistimos deste ciclo -
            // evita duas abas processando o mesmo ciclo e gerando notificacao duplicada.
            await SolarUtils.esperar(CONFIG.LOCK_CONFIRMACAO_MIN_MS + Math.random() * CONFIG.LOCK_CONFIRMACAO_JITTER_MS);

            const lockAposEspera = GM_getValue(CONFIG.STORAGE_LOCK, null);
            return lockAposEspera?.id === TAB_ID;
        }

        /* ---- 5.7. Modulo de Acesso a API JSON --------------------------------------------------- */
        async function buscarDadosLiberadosViaAPI() {
            const csrfToken = SolarUtils.lerCookie('csrftoken');
            if (!csrfToken) {
                throw new Error('Cookie "csrftoken" nao encontrado nesta aba - confirme se esta logado no Solar.');
            }

            const resposta = await fetch(CONFIG.API_LISTA_URL, {
                method: 'POST',
                credentials: 'same-origin',
                headers: SolarUtils.headersComCsrf({ 'Content-Type': 'application/json;charset=utf-8' }),
                body: JSON.stringify({ data: new Date().toISOString() }),
            });

            if (resposta.redirected) {
                const erro = new Error(`A requisicao foi redirecionada para "${resposta.url}" - a sessao provavelmente expirou.`);
                erro.sessaoExpirada = true;
                throw erro;
            }

            if (!resposta.ok) {
                throw new Error(`Resposta HTTP ${resposta.status} ao consultar a API de atendimentos.`);
            }

            const contentType = resposta.headers.get('content-type') ?? '';
            if (!contentType.includes('application/json')) {
                const erro = new Error(`Resposta com Content-Type inesperado ("${contentType || '(vazio)'}") - a sessao provavelmente expirou.`);
                erro.sessaoExpirada = true;
                throw erro;
            }

            let bruto;
            try {
                bruto = await resposta.json();
            } catch (erro) {
                const erroSessao = new Error(`Falha ao interpretar a resposta como JSON (${erro.message}) - a sessao provavelmente expirou.`);
                erroSessao.sessaoExpirada = true;
                throw erroSessao;
            }

            if (!Array.isArray(bruto)) {
                throw new Error('Resposta da API nao e uma lista (formato pode ter mudado desde a ultima verificacao).');
            }

            // Regra de negocio: liberado:true sozinho inclui senhas de TRIAGEM PASSOS (emissao
            // pela recepcao) - nao deve notificar. liberado:true + data_atendimento_recepcao
            // preenchido tambem inclui cadastros rapidos no ACOLHIMENTO INICIAL, ja concluidos
            // pela propria recepcao (realizado:true) - tambem nao deve notificar. O sinal
            // confiavel de "realmente aguardando o defensor" e: liberado:true E
            // data_atendimento_recepcao preenchido E defensoria != TRIAGEM PASSOS E realizado:false.
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

        /* ---- 5.8. Modulo de Diff entre Ciclos ----------------------------------------------------- */
        function construirChavesAtuais(atendimentos) {
            return atendimentos.map((atendimento) => ({
                chave: atendimento.numero || `${atendimento.defensoria ?? ''}::${atendimento.nome}`,
                nome: atendimento.nome,
                defensoria: atendimento.defensoria,
            }));
        }

        /* ---- 5.9. Modulo de Aviso de Sessao Expirada ---------------------------------------------- */
        let avisoSessaoExpiradaAtivo = false;

        function avisarSessaoExpirada() {
            if (avisoSessaoExpiradaAtivo) return;
            avisoSessaoExpiradaAtivo = true;

            SolarUI.mostrarToast({
                titulo: '⚠️ Sessao expirada',
                linhasHtml: '<span class="solar-scripts-toast-linha">O notificador parou de funcionar. Faca login novamente no Solar nesta aba.</span>',
                aoClicarAbrir: () => window.open(SolarConfig.ATENDIMENTO_PAGINA_URL, '_blank'),
            });

            if (typeof GM_notification === 'function') {
                try {
                    GM_notification({
                        title: '⚠️ Solar - Sessao expirada',
                        text: 'O notificador de atendimentos parou de funcionar porque a sessao expirou. Faca login novamente no Solar.',
                        timeout: 20000,
                        onclick: () => window.open(SolarConfig.ATENDIMENTO_PAGINA_URL, '_blank'),
                    });
                } catch (erro) {
                    log.warn('Falha ao disparar notificacao do SO para aviso de sessao expirada.', erro);
                }
            }
        }

        /* ---- 5.10. Modulo de Alertas de Atendimento Parado (dois tipos) ---------------------------
         * Tipo 1 "demora": liberado, mas ninguem clicou em "Atender" ainda (em_atendimento ===
         *   null). Referencia de tempo: data_atendimento_recepcao (precisa da correcao de fuso).
         * Tipo 2 "esqueceu": alguem clicou em "Atender" (em_atendimento preenchido) mas nunca
         *   finalizou (realizado continua false). Referencia: em_atendimento.data_inicio - este
         *   campo NAO vem com sufixo "Z" (diferente de data_atendimento_recepcao), entao NAO
         *   recebe a correcao de fuso.
         * ------------------------------------------------------------------------------------------ */
        function corrigirTimestampBackend(isoString) {
            const ms = new Date(isoString).getTime();
            if (Number.isNaN(ms)) return NaN;
            return ms + CONFIG.CORRECAO_FUSO_BACKEND_MS;
        }

        function calcularNovosAlertas({ itens, minutosLimite, registroAnterior, agora, obterInstanteReferencia }) {
            const registroAtual = {};
            const novosAlertas = [];

            itens.forEach((atendimento) => {
                if (!atendimento.numero) return;

                const instanteRef = obterInstanteReferencia(atendimento);
                if (Number.isNaN(instanteRef)) return;

                const minutosDecorridos = Math.floor((agora - instanteRef) / 60000);
                if (minutosDecorridos < minutosLimite) return;

                const ultimoAlerta = registroAnterior[atendimento.numero];
                const deveAlertar = !ultimoAlerta || (agora - ultimoAlerta) >= minutosLimite * 60_000;

                if (deveAlertar) {
                    registroAtual[atendimento.numero] = agora;
                    novosAlertas.push({
                        numero: atendimento.numero,
                        nome: atendimento.nome,
                        defensoria: atendimento.defensoria,
                        minutos: minutosDecorridos,
                        servidor: atendimento.emAtendimento?.servidor ?? null,
                    });
                } else {
                    registroAtual[atendimento.numero] = ultimoAlerta;
                }
            });

            return { registroAtual, novosAlertas };
        }

        function verificarAtendimentosDemorados(atendimentos) {
            const agora = Date.now();
            const naoIniciados = atendimentos.filter((atendimento) => !atendimento.emAtendimento);
            const iniciadosNaoFechados = atendimentos.filter((atendimento) => atendimento.emAtendimento);

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

                GM_setValue(CONFIG.STORAGE_ALERTA_DEMORA_ENVIADOS, registroAtual);

                if (novosAlertas.length > 0) {
                    GM_setValue(CONFIG.STORAGE_EVENT_DEMORA, { ts: agora, atendimentos: novosAlertas });
                    dispararAlertasGlobaisDemora(novosAlertas);
                }
            }

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
            atendimentosDemorados.forEach((atendimento) => {
                try {
                    GM_notification({
                        title: '⏰ Atendimento aguardando ha muito tempo',
                        text: `${atendimento.nome}${atendimento.defensoria ? ` — ${atendimento.defensoria}` : ''}\nLiberado ha ${SolarUtils.formatarDuracao(atendimento.minutos)} e ainda nao foi atendido.`,
                        timeout: 20000,
                        onclick: () => window.open(SolarConfig.ATENDIMENTO_PAGINA_URL, '_blank'),
                    });
                } catch (erro) {
                    log.warn('Falha ao disparar notificacao do SO para alerta de demora.', erro);
                }
            });
        }

        function dispararAlertasGlobaisEsqueceu(atendimentosEsquecidos) {
            if (typeof GM_notification !== 'function') return;
            atendimentosEsquecidos.forEach((atendimento) => {
                try {
                    GM_notification({
                        title: '⏰ Atendimento iniciado mas nao finalizado',
                        text: `${atendimento.nome}${atendimento.defensoria ? ` — ${atendimento.defensoria}` : ''}\nEm atendimento${atendimento.servidor ? ` por ${atendimento.servidor}` : ''} ha ${SolarUtils.formatarDuracao(atendimento.minutos)}, mas ainda nao foi finalizado no sistema.`,
                        timeout: 20000,
                        onclick: () => window.open(SolarConfig.ATENDIMENTO_PAGINA_URL, '_blank'),
                    });
                } catch (erro) {
                    log.warn('Falha ao disparar notificacao do SO para alerta de atendimento nao finalizado.', erro);
                }
            });
        }

        let ultimoTsDemoraProcessadoNestaAba = null;

        function tratarEventoDemora(evento) {
            if (!evento?.atendimentos?.length) return;
            if (evento.ts === ultimoTsDemoraProcessadoNestaAba) return;
            ultimoTsDemoraProcessadoNestaAba = evento.ts;

            // A notificacao do SO NAO dispara aqui - ja foi disparada uma unica vez pela aba
            // lider. Este handler roda em toda aba aberta e cuida so do toast visual.
            evento.atendimentos.forEach((atendimento) => {
                const duracao = SolarUtils.formatarDuracao(atendimento.minutos);
                const linhasHtml = `
                    <span class="solar-scripts-toast-linha">${SolarUtils.escapeHtml(atendimento.nome)}${atendimento.defensoria ? ` — ${SolarUtils.escapeHtml(atendimento.defensoria)}` : ''}</span>
                    <span class="solar-scripts-toast-linha">Liberado ha ${duracao} e ainda nao foi atendido.</span>
                `;
                SolarUI.mostrarToast({
                    titulo: '⏰ Atendimento aguardando ha muito tempo',
                    linhasHtml,
                    urgente: true,
                    aoClicarAbrir: () => window.open(SolarConfig.ATENDIMENTO_PAGINA_URL, '_blank'),
                });
            });
        }

        let ultimoTsEsqueceuProcessadoNestaAba = null;

        function tratarEventoEsqueceu(evento) {
            if (!evento?.atendimentos?.length) return;
            if (evento.ts === ultimoTsEsqueceuProcessadoNestaAba) return;
            ultimoTsEsqueceuProcessadoNestaAba = evento.ts;

            evento.atendimentos.forEach((atendimento) => {
                const duracao = SolarUtils.formatarDuracao(atendimento.minutos);
                const linhasHtml = `
                    <span class="solar-scripts-toast-linha">${SolarUtils.escapeHtml(atendimento.nome)}${atendimento.defensoria ? ` — ${SolarUtils.escapeHtml(atendimento.defensoria)}` : ''}</span>
                    <span class="solar-scripts-toast-linha">Em atendimento${atendimento.servidor ? ` por ${SolarUtils.escapeHtml(atendimento.servidor)}` : ''} ha ${duracao}, mas ainda nao foi finalizado no sistema.</span>
                `;
                SolarUI.mostrarToast({
                    titulo: '⏰ Atendimento iniciado mas nao finalizado',
                    linhasHtml,
                    urgente: true,
                    aoClicarAbrir: () => window.open(SolarConfig.ATENDIMENTO_PAGINA_URL, '_blank'),
                });
            });
        }

        /* ---- 5.11. Modulo do Ciclo de Verificacao --------------------------------------------------- */
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

                // "Sem historico anterior" (instalacao nova ou reset de baseline) e tratado como
                // conjunto vazio: tudo que estiver na fila agora entra como "novo" e notifica -
                // o usuario precisa saber quem ja esta esperando ao abrir o Solar pela manha.
                const eraPrimeiraChecagem = conhecidosAnteriores === null;
                const setAnterior = new Set(conhecidosAnteriores ?? []);
                const novosTodos = chavesAtuais.filter((c) => !setAnterior.has(c.chave));
                const novosNotificaveis = novosTodos.filter((c) => defensoriaInteressa(c.defensoria));

                GM_setValue(CONFIG.STORAGE_CONHECIDOS, chavesAtuais.map((c) => c.chave));

                if (eraPrimeiraChecagem) {
                    log.info(`Primeira checagem: ${dados.total} atendimento(s) em Liberados encontrados.`);
                }

                if (novosTodos.length > 0 && novosNotificaveis.length === 0) {
                    log.info(`${novosTodos.length} novo(s) atendimento(s) fora do filtro de defensorias configurado - notificacao nao disparada.`);
                }

                if (novosNotificaveis.length > 0) {
                    GM_setValue(CONFIG.STORAGE_EVENT, {
                        ts: Date.now(),
                        novos: novosNotificaveis.map(({ nome, defensoria, chave }) => ({ nome, defensoria, numero: chave })),
                        total: dados.total,
                    });

                    // Som e notificacao do SO sao eventos "globais" (o usuario so precisa
                    // ouvir/ver uma vez) - diferente do toast, que deve aparecer em CADA aba. Por
                    // isso disparamos aqui, uma unica vez, direto na aba lider.
                    dispararAlertasGlobaisNovoAtendimento(novosNotificaveis, dados.total);
                }
            } catch (erro) {
                log.warn('Falha ao verificar novos atendimentos.', erro);
                if (erro?.sessaoExpirada) avisarSessaoExpirada();
            } finally {
                verificacaoEmAndamento = false;
            }
        }

        /* ---- 5.12. Modulo de Alertas Globais (som + notificacao do SO) -------------------------------
         * Disparados uma unica vez pela aba lider, nunca replicados por aba.
         * ------------------------------------------------------------------------------------------ */
        function dispararAlertasGlobaisNovoAtendimento(novos, total) {
            tocarSinoDeAlerta();

            if (typeof GM_notification !== 'function') return;

            const titulo = novos.length === 1 ? 'Novo atendimento liberado!' : `${novos.length} novos atendimentos liberados!`;
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
                    onclick: () => window.open(SolarConfig.ATENDIMENTO_PAGINA_URL, '_blank'),
                });
            } catch (erro) {
                log.warn('Falha ao disparar notificacao do SO para novo atendimento.', erro);
            }
        }

        /* ---- 5.13. Modulo de Reacao ao Evento de Novo Atendimento (toast em todas as abas) ----------- */
        const chavesNovoJaMostradasNestaAba = new Set();

        function tratarEventoNovoAtendimento(evento) {
            if (!evento?.novos?.length) return;

            // Camada extra contra duplicidade na MESMA aba: o mesmo atendimento nunca gera dois
            // toasts iguais nesta aba, mesmo se chegar em eventos distintos.
            const novosFiltrados = evento.novos.filter((n) => {
                const chave = n.numero || `${n.defensoria ?? ''}::${n.nome}`;
                if (chavesNovoJaMostradasNestaAba.has(chave)) return false;
                chavesNovoJaMostradasNestaAba.add(chave);
                return true;
            });
            if (novosFiltrados.length === 0) return;

            const { total } = evento;
            const titulo = novosFiltrados.length === 1 ? 'Novo atendimento liberado!' : `${novosFiltrados.length} novos atendimentos liberados!`;

            const visiveis = novosFiltrados.slice(0, CONFIG.MAX_NOMES_NO_TOAST);
            const restantes = novosFiltrados.length - visiveis.length;

            const linhasHtml = visiveis
                .map((n) => `<span class="solar-scripts-toast-linha">• ${SolarUtils.escapeHtml(n.nome)}${n.defensoria ? ` — ${SolarUtils.escapeHtml(n.defensoria)}` : ''}</span>`)
                .join('')
                + (restantes > 0 ? `<span class="solar-scripts-toast-linha">e mais ${restantes}...</span>` : '')
                + `<span class="solar-scripts-toast-linha-total">Total na fila: ${total}</span>`;

            // Som e notificacao do SO NAO disparam aqui - ja foram disparados uma unica vez pela
            // aba lider em dispararAlertasGlobaisNovoAtendimento. Este handler cuida so do toast.
            SolarUI.mostrarToast({
                titulo,
                linhasHtml,
                aoClicarAbrir: () => window.open(SolarConfig.ATENDIMENTO_PAGINA_URL, '_blank'),
            });
        }

        /* ---- 5.14. Ponto de entrada do modulo ---------------------------------------------------------- */
        function iniciar() {
            injetarEstilos();
            registrarNoPainel();

            GM_addValueChangeListener(CONFIG.STORAGE_EVENT, (_nome, _antigo, novo) => tratarEventoNovoAtendimento(novo));
            GM_addValueChangeListener(CONFIG.STORAGE_EVENT_DEMORA, (_nome, _antigo, novo) => tratarEventoDemora(novo));
            GM_addValueChangeListener(CONFIG.STORAGE_EVENT_ESQUECEU, (_nome, _antigo, novo) => tratarEventoEsqueceu(novo));

            GM_registerMenuCommand('🔔 Configurar Notificador de Atendimentos', abrirConfiguracoes);
            GM_registerMenuCommand('🔔 Testar notificacao agora', () => {
                tratarEventoNovoAtendimento({
                    novos: [{ nome: 'FULANO DE TAL DA SILVA (teste)', defensoria: 'DEFENSORIA DE TESTE (GERAL)', numero: `teste-${Date.now()}` }],
                    total: (GM_getValue(CONFIG.STORAGE_COUNT, 0) ?? 0) + 1,
                });
            });
            GM_registerMenuCommand('♻️ Resetar baseline de contagem (Notificador)', () => {
                GM_setValue(CONFIG.STORAGE_COUNT, null);
                GM_setValue(CONFIG.STORAGE_CONHECIDOS, null);
                GM_setValue(CONFIG.STORAGE_ALERTA_DEMORA_ENVIADOS, {});
                GM_setValue(CONFIG.STORAGE_ALERTA_ESQUECEU_ENVIADOS, {});
                log.info('Baseline resetado.');
            });

            // A primeira checagem e espalhada num atraso aleatorio (em vez de disparar
            // instantaneamente) - reduz a chance de duas abas abertas quase ao mesmo tempo
            // colidirem exatamente na eleicao de lider logo na largada.
            setTimeout(verificarNovosAtendimentos, Math.random() * CONFIG.PRIMEIRA_CHECAGEM_JITTER_MAX_MS);
            setInterval(verificarNovosAtendimentos, CONFIG.POLL_INTERVAL_MS);

            log.info(`Monitoramento ativo (checagem a cada ${CONFIG.POLL_INTERVAL_MS / 1000}s, via fetch direto a API).`);
        }

        return {
            id: 'notificador-atendimentos',
            nome: 'Notificador de Atendimentos Liberados (via API)',
            descricao: 'Alerta com balao, som e notificacao do sistema quando surge um novo atendimento liberado.',
            quando: 'dom',
            ativarEm: () => true,
            iniciar,
        };
    })();

    /* ============================================================================================
     * 6. SOLAR - PAGINACAO AVANCADA
     * ============================================================================================
     * Expande a barra de paginacao das listas do Solar para ate 20 botoes numericos e adiciona um
     * campo de salto direto para uma pagina especifica.
     * ------------------------------------------------------------------------------------------ */
    const ModuloPaginacaoAvancada = (() => {
        const log = criarLogger('6. Paginacao Avancada');

        /* ---- 6.1. Modulo de Estilos ------------------------------------------------------------- */
        function injetarEstilos() {
            if (document.getElementById('solar-paginacao-estilos')) return;
            GM_addStyle(`
                .solar-pag-salto-wrapper { display: inline-flex; align-items: center; margin-left: 15px; margin-top: 3px; gap: 6px; }
                .solar-pag-input-salto {
                    width: 90px; height: 32px !important; padding: 4px 10px; border: 1px solid #ccc;
                    border-radius: 4px; text-align: center; font-weight: bold; color: #333;
                    background-color: #fff; box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
                    transition: border-color 0.2s; box-sizing: border-box !important; margin: 0 !important;
                }
                .solar-pag-input-salto:focus { border-color: #2a6099; outline: none; }
                .solar-pag-btn-ir {
                    height: 32px !important; padding: 0 14px; border: 1px solid #2a6099; border-radius: 4px;
                    background-color: #2a6099; color: #ffffff; font-weight: bold; cursor: pointer;
                    transition: background-color 0.2s; box-sizing: border-box !important; margin: 0 !important;
                    display: inline-flex; align-items: center; justify-content: center;
                }
                .solar-pag-btn-ir:hover { background-color: #1a4a7a; }
            `);
            const marcador = document.createElement('meta');
            marcador.id = 'solar-paginacao-estilos';
            marcador.style.display = 'none';
            document.head.appendChild(marcador);
        }

        /* ---- 6.2. Modulo de Expansao da Barra de Botoes (ate 20 numeros) ------------------------ */
        function expandirBarraDePaginacao(ulElement) {
            if (ulElement.hasAttribute('data-expandido')) return;

            const liAtivo = ulElement.querySelector('li.active');
            if (!liAtivo) return;
            const paginaAtual = parseInt(liAtivo.textContent.trim(), 10);

            let totalPaginas = paginaAtual;
            const linkUltima = ulElement.querySelector('a[data-original-title="Última página"]');
            if (linkUltima) {
                const encontrado = linkUltima.getAttribute('href').match(/page=(\d+)/);
                if (encontrado) totalPaginas = parseInt(encontrado[1], 10);
            } else {
                ulElement.querySelectorAll('a[href*="page="]').forEach((link) => {
                    const encontrado = link.getAttribute('href').match(/page=(\d+)/);
                    if (encontrado) {
                        const pagina = parseInt(encontrado[1], 10);
                        if (pagina > totalPaginas) totalPaginas = pagina;
                    }
                });
            }

            let inicio = Math.max(1, paginaAtual - 9);
            let fim = Math.min(totalPaginas, inicio + 19);
            if (fim - inicio < 19) inicio = Math.max(1, fim - 19);

            const itens = Array.from(ulElement.children);
            let indiceDeInsercao = -1;

            itens.forEach((item, indice) => {
                if (/^\d+$/.test(item.textContent.trim())) {
                    if (indiceDeInsercao === -1) indiceDeInsercao = indice;
                    item.remove();
                }
            });

            if (indiceDeInsercao === -1) return;

            const fragmento = document.createDocumentFragment();
            const urlBase = new URL(window.location.href);

            for (let pagina = inicio; pagina <= fim; pagina++) {
                const novoItem = document.createElement('li');
                if (pagina === paginaAtual) {
                    novoItem.className = 'active';
                    novoItem.innerHTML = `<a href="#">${pagina}</a>`;
                } else {
                    urlBase.searchParams.set('page', pagina);
                    novoItem.innerHTML = `<a href="${urlBase.toString()}">${pagina}</a>`;
                }
                fragmento.appendChild(novoItem);
            }

            const itemReferencia = ulElement.children[indiceDeInsercao];
            if (itemReferencia) ulElement.insertBefore(fragmento, itemReferencia);
            else ulElement.appendChild(fragmento);

            ulElement.setAttribute('data-expandido', 'true');
        }

        /* ---- 6.3. Modulo de Navegacao por URL (Salto de Pagina) ---------------------------------- */
        function pularParaPagina(numeroPagina) {
            const urlAtual = new URL(window.location.href);
            urlAtual.searchParams.set('page', numeroPagina);
            window.location.href = urlAtual.toString();
        }

        /* ---- 6.4. Modulo de Injecao Geral na Interface -------------------------------------------- */
        function aplicarMelhorias() {
            const divsPaginacao = document.querySelectorAll('.pagination-right');
            if (divsPaginacao.length === 0) return;

            injetarEstilos();

            divsPaginacao.forEach((div, indice) => {
                const ulElement = div.querySelector('ul');
                if (!ulElement) return;

                expandirBarraDePaginacao(ulElement);

                if (indice === divsPaginacao.length - 1 && !document.getElementById('solar-pag-salto-wrapper')) {
                    const wrapper = document.createElement('div');
                    wrapper.id = 'solar-pag-salto-wrapper';
                    wrapper.className = 'solar-pag-salto-wrapper';

                    const input = document.createElement('input');
                    input.type = 'number';
                    input.min = 1;
                    input.className = 'solar-pag-input-salto';
                    input.placeholder = 'Página...';
                    input.title = 'Digite o numero e aperte Enter ou clique em Ir';

                    const btnIr = document.createElement('button');
                    btnIr.className = 'solar-pag-btn-ir';
                    btnIr.textContent = 'Ir';
                    btnIr.title = 'Ir para a pagina digitada';

                    input.addEventListener('keyup', (evento) => {
                        if (evento.key === 'Enter') {
                            const novaPagina = parseInt(input.value, 10);
                            if (!Number.isNaN(novaPagina) && novaPagina > 0) pularParaPagina(novaPagina);
                        }
                    });
                    btnIr.addEventListener('click', () => {
                        const novaPagina = parseInt(input.value, 10);
                        if (!Number.isNaN(novaPagina) && novaPagina > 0) pularParaPagina(novaPagina);
                    });

                    wrapper.appendChild(input);
                    wrapper.appendChild(btnIr);
                    div.appendChild(wrapper);

                    div.style.display = 'flex';
                    div.style.alignItems = 'center';
                    div.style.justifyContent = 'flex-end';
                }
            });
        }

        /* ---- 6.5. Ponto de entrada do modulo --------------------------------------------------------- */
        function iniciar() {
            SolarObservadorDOM.assinar(() => {
                if (document.querySelector('.pagination-right')) aplicarMelhorias();
            });
            setTimeout(aplicarMelhorias, 800);
            log.info('Modulo iniciado.');
        }

        return {
            id: 'paginacao-avancada',
            nome: 'Paginacao Avancada',
            descricao: 'Expande a paginacao para ate 20 botoes e adiciona campo de salto direto para uma pagina.',
            quando: 'dom',
            ativarEm: () => true,
            iniciar,
        };
    })();

    /* ============================================================================================
     * 7. SOLAR - ATUALIZACAO FORCADA DE PROCESSOS
     * ============================================================================================
     * Intercepta proativamente as chamadas de rede (fetch/XHR) que a propria pagina faz para
     * ler dados do processo e forca uma atualizacao no backend antes de deixar essas chamadas
     * seguirem - garante que a tela sempre mostre dados sincronizados, independente da rota de
     * navegacao usada para chegar ate ela. Por isso este e o UNICO modulo com timing "start":
     * precisa going antes de qualquer fetch/XHR nativo da pagina, entao roda assim que o script
     * inteiro executa (document-start), sem esperar o DOM.
     * ------------------------------------------------------------------------------------------ */
    const ModuloAtualizacaoForcada = (() => {
        const log = criarLogger('7. Atualizacao Forcada');

        /* ---- 7.1. Modulo de Configuracao --------------------------------------------------------- */
        const CONFIG = {
            enableRaceGuard: true,

            // Este prefixo casa com QUALQUER chamada de API relacionada ao processo, nao so o
            // carregamento da pagina de detalhes (ex.: previas em listas, autocomplete, widgets).
            processApiPrefix: '/procapi/processo/',

            // gateMaxWaitMs e mantido levemente maior que fetchTimeoutMs de proposito: assim o
            // AbortController do fetch quase sempre vence a corrida primeiro, e o portao nunca
            // libera a pagina nativa antes da tentativa de atualizacao terminar.
            fetchTimeoutMs: 30000,
            gateMaxWaitMs: 32000,

            resultDisplayMs: 4000,
            ownRequestHeader: 'X-Solar-Fast-Sync',
        };

        const updatedProcesses = new Set();
        const gates = new Map();

        // Regex calculada uma unica vez (evita reconstruir a cada chamada de rede da pagina).
        const escapedPrefix = CONFIG.processApiPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const PROCESS_ID_REGEX = new RegExp(`${escapedPrefix}(\\d+)`);

        /* ---- 7.2. Modulo de Indicador Visual (Toast de Progresso) --------------------------------- */
        const UI = {
            toast: null,
            textEl: null,
            spinnerEl: null,
            btnEl: null,
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
                        z-index: 2147483000;
                        pointer-events: auto;
                        display: none; align-items: center; gap: 12px;
                        transition: opacity 0.3s ease, background-color 0.3s ease; opacity: 0;
                    `;

                    this.toast.innerHTML = `
                        <style>
                            /* Keyframe definido localmente (em vez de reaproveitar a do nucleo,
                               modulo 1.4) porque este modulo pode disparar em "document-start",
                               antes dos estilos globais serem injetados - precisa ser
                               autossuficiente. */
                            @keyframes solarFastSyncGirar { 100% { transform: rotate(360deg); } }
                            .solar-fast-sync-spinner { width: 16px; height: 16px; border: 2px solid #ecf0f1; border-top-color: transparent; border-radius: 50%; animation: solarFastSyncGirar 1s linear infinite; }
                            #solar-fast-sync-btn-ok {
                                background: #e74c3c; border: 1px solid #c0392b; color: #fff;
                                padding: 4px 12px; border-radius: 4px; cursor: pointer;
                                font-weight: bold; font-size: 12px; display: none;
                                transition: background 0.2s;
                            }
                            #solar-fast-sync-btn-ok:hover { background: #c0392b; }
                        </style>
                        <div class="solar-fast-sync-spinner" id="solar-fast-sync-spinner"></div>
                        <span id="solar-fast-sync-text">Forcando Atualizacao Automaticamente</span>
                        <button id="solar-fast-sync-btn-ok">OK</button>
                    `;
                    document.documentElement.appendChild(this.toast);

                    this.textEl = this.toast.querySelector('#solar-fast-sync-text');
                    this.spinnerEl = this.toast.querySelector('#solar-fast-sync-spinner');
                    this.btnEl = this.toast.querySelector('#solar-fast-sync-btn-ok');

                    this.btnEl.addEventListener('click', () => this.hide(true));
                } catch (erro) {
                    log.warn('Falha ao inicializar indicador visual.', erro);
                }
            },

            updateCounterText() {
                try {
                    if (!this.textEl || this.startedAt === null) return;
                    const segundos = Math.floor((Date.now() - this.startedAt) / 1000);
                    this.textEl.textContent = `Forcando Atualizacao Automaticamente (${segundos}s)`;
                } catch (erro) {
                    log.warn('Falha ao atualizar contador do indicador visual.', erro);
                }
            },

            startSyncing() {
                try {
                    this.init();
                    if (!this.toast) return;

                    clearTimeout(this.hideTimeout);
                    clearInterval(this.counterInterval);

                    this.toast.style.background = '#2c3e50';
                    if (this.btnEl) this.btnEl.style.display = 'none';

                    this.startedAt = Date.now();
                    if (this.spinnerEl) this.spinnerEl.style.display = 'block';
                    this.updateCounterText();
                    this.counterInterval = setInterval(() => this.updateCounterText(), 1000);

                    this.toast.style.display = 'flex';
                    setTimeout(() => { if (this.toast) this.toast.style.opacity = '1'; }, 10);
                } catch (erro) {
                    log.warn('Falha ao exibir indicador visual.', erro);
                }
            },

            showResult(sucesso) {
                try {
                    if (!this.toast) return;

                    clearInterval(this.counterInterval);
                    this.startedAt = null;
                    clearTimeout(this.hideTimeout);

                    if (this.spinnerEl) this.spinnerEl.style.display = 'none';

                    if (sucesso) {
                        if (this.textEl) this.textEl.textContent = 'Atualizacao Forcada Concluida ✅';
                        if (this.btnEl) this.btnEl.style.display = 'none';
                        this.toast.style.background = '#27ae60';
                        this.hideTimeout = setTimeout(() => this.hide(), CONFIG.resultDisplayMs);
                    } else {
                        if (this.textEl) this.textEl.textContent = 'Falha na Atualizacao Forcada 🔴';
                        if (this.btnEl) this.btnEl.style.display = 'block';
                        this.toast.style.background = '#991111';
                        // Falha: NAO agenda o timeout. O aviso fica ate o usuario clicar em "OK".
                    }
                } catch (erro) {
                    log.warn('Falha ao exibir resultado no indicador visual.', erro);
                }
            },

            hide(forcar = false) {
                try {
                    if (this.toast && (gates.size === 0 || forcar)) {
                        this.toast.style.opacity = '0';
                        setTimeout(() => {
                            if ((gates.size === 0 || forcar) && this.toast) {
                                this.toast.style.display = 'none';
                                this.toast.style.background = '#2c3e50';
                            }
                        }, 300);
                    }
                } catch (erro) {
                    log.warn('Falha ao ocultar indicador visual.', erro);
                }
            },
        };

        /* ---- 7.3. Modulo de Controle de Portoes (Race Guard) --------------------------------------- */
        function abrirPortao(processoId) {
            let resolverFn;
            const promise = new Promise((resolve) => { resolverFn = resolve; });

            const timeoutId = setTimeout(() => {
                log.warn(`Portao do processo ${processoId} expirou. Liberando requisicoes nativas por seguranca.`);
                resolverFn();
            }, CONFIG.gateMaxWaitMs);

            // IMPORTANTE: gates.set() acontece ANTES de UI.startSyncing(). Como UI.startSyncing()
            // esta isolado em try/catch, mesmo que ele falhe, o estado do portao em si ja fica
            // consistente - uma falha cosmetica nunca deixa uma entrada "presa" no Map.
            gates.set(processoId, { promise, resolverFn, timeoutId });
            UI.startSyncing();

            return promise;
        }

        function fecharPortao(processoId) {
            const portao = gates.get(processoId);
            if (!portao) return;
            clearTimeout(portao.timeoutId);
            portao.resolverFn();
            gates.delete(processoId);
            // Nao esconde o toast aqui: quem decide isso e UI.showResult(), chamado logo em
            // seguida em dispararAtualizacaoForcada, ja que o resultado precisa ficar visivel
            // por um tempo depois do portao fechar.
        }

        function extrairIdDaUrlDaApi(url) {
            if (typeof url !== 'string') return null;
            const encontrado = url.match(PROCESS_ID_REGEX);
            return encontrado ? encontrado[1] : null;
        }

        function obterPortao(processoId) {
            if (!CONFIG.enableRaceGuard || !processoId) return null;
            return gates.get(processoId)?.promise ?? null;
        }

        /* ---- 7.4. Modulo de Requisicao Direta (API) ------------------------------------------------ */
        async function forcarAtualizacaoViaAPI(pageWindow, processoId) {
            const apiUrl = `${pageWindow.location.origin}${CONFIG.processApiPrefix}${processoId}/consultar/?forcar_atualizacao=true`;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.fetchTimeoutMs);

            try {
                log.info(`Iniciando sync silencioso (GET) para o ID: ${processoId}`);

                const resposta = await pageWindow.fetch(apiUrl, {
                    method: 'GET',
                    credentials: 'same-origin',
                    signal: controller.signal,
                    headers: {
                        'Accept': 'application/json, text/plain, */*',
                        'X-Requested-With': 'XMLHttpRequest',
                        [CONFIG.ownRequestHeader]: '1',
                    },
                });

                if (!resposta.ok) throw new Error(`Status HTTP ${resposta.status}`);

                updatedProcesses.add(processoId);
                log.info(`Processo ${processoId} atualizado com sucesso no backend.`);
                return true;
            } catch (erro) {
                log.error(`Falha ao forcar atualizacao via API para o ID ${processoId}.`, erro);
                return false;
            } finally {
                clearTimeout(timeoutId);
            }
        }

        async function dispararAtualizacaoForcada(pageWindow, processoId) {
            if (updatedProcesses.has(processoId)) {
                log.info(`Processo ${processoId} ja sincronizado nesta sessao. Ignorando.`);
                return;
            }
            if (gates.has(processoId)) {
                log.info(`Atualizacao ja em andamento para o processo ${processoId}. Ignorando chamada duplicada.`);
                return;
            }

            // IMPORTANTE (invariante de sincronizacao): abrirPortao precisa ser a ULTIMA operacao
            // sincrona antes do primeiro "await" desta funcao - e isso que garante que a MESMA
            // requisicao nativa que revelou o processoId (no interceptor logo abaixo) enxergue o
            // portao ja aberto no instante seguinte. Nao insira nenhum await antes desta linha.
            if (CONFIG.enableRaceGuard) abrirPortao(processoId);

            let sucesso = false;
            try {
                sucesso = await forcarAtualizacaoViaAPI(pageWindow, processoId);
            } finally {
                if (CONFIG.enableRaceGuard) {
                    fecharPortao(processoId);
                    UI.showResult(sucesso);
                }
            }
        }

        function dispararAtualizacaoForcadaSegura(pageWindow, processoId) {
            dispararAtualizacaoForcada(pageWindow, processoId).catch((erro) =>
                log.error(`Erro inesperado ao disparar atualizacao para o processo ${processoId}.`, erro)
            );
        }

        /* ---- 7.5. Modulo de Interceptacao de Rede Proativa (fetch + XHR) ---------------------------- */
        function isRequisicaoPropria(init) {
            if (!init?.headers) return false;
            try {
                const headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
                return headers.get(CONFIG.ownRequestHeader) === '1';
            } catch {
                return false;
            }
        }

        function instalarInterceptadores(pageWindow) {
            const fetchOriginal = pageWindow.fetch.bind(pageWindow);
            pageWindow.fetch = async function fetchInterceptado(input, init = {}) {
                const url = typeof input === 'string' ? input : (input?.url ?? String(input));

                if (isRequisicaoPropria(init)) {
                    const headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
                    headers.delete(CONFIG.ownRequestHeader);
                    return fetchOriginal(input, { ...init, headers });
                }

                const processoId = extrairIdDaUrlDaApi(url);
                if (processoId) {
                    log.info(`ID de processo detectado via rede (fetch): ${processoId} - ${url}`);
                    dispararAtualizacaoForcadaSegura(pageWindow, processoId);
                }

                const portao = obterPortao(processoId);
                if (portao) {
                    log.info(`Segurando requisicao nativa (fetch) ate a conclusao: ${url}`);
                    await portao;
                }

                return fetchOriginal(input, init);
            };

            const xhrOpenOriginal = pageWindow.XMLHttpRequest.prototype.open;
            const xhrSendOriginal = pageWindow.XMLHttpRequest.prototype.send;

            pageWindow.XMLHttpRequest.prototype.open = function (metodo, url, assincrono = true, ...resto) {
                this.__solarFastSyncUrl = url;
                this.__solarFastSyncAsync = assincrono;
                return xhrOpenOriginal.call(this, metodo, url, assincrono, ...resto);
            };

            pageWindow.XMLHttpRequest.prototype.send = function (...args) {
                const url = this.__solarFastSyncUrl;
                const processoId = extrairIdDaUrlDaApi(url);

                if (processoId && this.__solarFastSyncAsync !== false) {
                    log.info(`ID de processo detectado via rede (XHR): ${processoId} - ${url}`);
                    dispararAtualizacaoForcadaSegura(pageWindow, processoId);
                }

                const portao = this.__solarFastSyncAsync === false ? null : obterPortao(processoId);
                if (portao) {
                    log.info(`Segurando requisicao nativa (XHR) ate a conclusao: ${url}`);
                    portao.then(() => xhrSendOriginal.apply(this, args));
                    return;
                }

                return xhrSendOriginal.apply(this, args);
            };
        }

        /* ---- 7.6. Modulo de Fallback de Rota (carregamento inicial) --------------------------------- */
        // Garante que, se a pagina for aberta diretamente pelo link (ou recarregada com F5), a
        // atualizacao dispare o quanto antes - antes mesmo do primeiro XHR/fetch nativo acontecer.
        // Se o padrao de hash nao bater aqui por algum motivo, o interceptor de rede acima ainda
        // pega a chamada de qualquer forma, so sem a vantagem de tempo.
        function verificarRotaInicial(pageWindow) {
            const rota = pageWindow.location.href;
            const encontrado = rota.match(/\/(?:eproc|pje)\/(\d+)/i);
            if (encontrado?.[1]) dispararAtualizacaoForcadaSegura(pageWindow, encontrado[1]);
        }

        /* ---- 7.7. Ponto de entrada do modulo ---------------------------------------------------------- */
        function iniciar() {
            const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

            if (pageWindow.__solarFastSyncInstalled) return;
            pageWindow.__solarFastSyncInstalled = true;

            instalarInterceptadores(pageWindow);
            verificarRotaInicial(pageWindow);
            log.info('Modulo iniciado (interceptacao de rede ativa).');
        }

        return {
            id: 'atualizacao-forcada',
            nome: 'Atualizacao Forcada de Processos',
            descricao: 'Forca a atualizacao do processo interceptando proativamente chamadas de rede da API nativa.',
            quando: 'start',
            ativarEm: (pathname) => pathname.startsWith('/atendimento/'),
            iniciar,
        };
    })();

    /* ============================================================================================
     * 8. SOLAR - BUSCA NA LINHA DO TEMPO
     * ============================================================================================
     * Adiciona um campo de busca em tempo real ao lado do botao "Linha do Tempo", filtrando os
     * cartoes de evento/documento pelo texto digitado (ID, descricao do evento ou documento).
     * ------------------------------------------------------------------------------------------ */
    const ModuloBuscaLinhaDoTempo = (() => {
        const log = criarLogger('8. Busca na Linha do Tempo');

        /* ---- 8.1. Modulo de Filtragem ------------------------------------------------------------- */
        function filtrarCartoes(termo) {
            const termoNormalizado = termo.toLowerCase().trim();
            document.querySelectorAll('.media-body').forEach((cartao) => {
                const textoCartao = cartao.textContent.toLowerCase();

                // Sobe na arvore do HTML ate achar o "pai supremo" do evento (o loop mais alto
                // marcado com ng-repeat), para esconder o evento inteiro, nao so um pedaco dele.
                let atual = cartao;
                let ngRepeatMaisAlto = null;
                while (atual && atual !== document.body) {
                    if (atual.hasAttribute('ng-repeat')) ngRepeatMaisAlto = atual;
                    atual = atual.parentElement;
                }

                const containerPai = ngRepeatMaisAlto || cartao.closest('li') || cartao.parentElement.parentElement;
                containerPai.style.display = textoCartao.includes(termoNormalizado) ? '' : 'none';
            });
        }

        /* ---- 8.2. Modulo de Injecao da Barra de Pesquisa ------------------------------------------- */
        function injetarBarraPesquisa() {
            if (document.getElementById('solar-busca-timeline-wrapper')) return;

            const elementos = Array.from(document.querySelectorAll('button, a, span, div'));
            const btnLinhaTempo = elementos.find((el) => el.textContent.trim() === 'Linha do Tempo');
            if (!btnLinhaTempo || btnLinhaTempo.offsetHeight === 0) return;

            const grupoBotoes = btnLinhaTempo.closest('.btn-group') || btnLinhaTempo.parentNode;

            const wrapper = document.createElement('div');
            wrapper.id = 'solar-busca-timeline-wrapper';
            wrapper.style.cssText = 'display: inline-flex; align-items: center; margin-left: 10px; margin-top: 2px; vertical-align: middle;';

            const inputPesquisa = document.createElement('input');
            inputPesquisa.id = 'solar-busca-timeline';
            inputPesquisa.type = 'text';
            inputPesquisa.placeholder = '🔍 Buscar ID, Evento ou documento...';
            inputPesquisa.autocomplete = 'off';
            inputPesquisa.style.cssText = `
                padding: 6px 14px; border: 1px solid #ccc; border-radius: 20px; font-size: 13px;
                width: 260px; outline: none; box-shadow: inset 0 1px 2px rgba(0,0,0,0.05);
                color: #333; background: #fff; transition: all 0.3s ease;
            `;

            inputPesquisa.addEventListener('focus', () => {
                inputPesquisa.style.borderColor = '#e4801c';
                inputPesquisa.style.boxShadow = '0 0 0 3px rgba(228, 128, 28, 0.2)';
            });
            inputPesquisa.addEventListener('blur', () => {
                inputPesquisa.style.borderColor = '#ccc';
                inputPesquisa.style.boxShadow = 'inset 0 1px 2px rgba(0,0,0,0.05)';
            });
            inputPesquisa.addEventListener('input', (evento) => filtrarCartoes(evento.target.value));

            wrapper.appendChild(inputPesquisa);
            grupoBotoes.insertAdjacentElement('afterend', wrapper);

            if (grupoBotoes.parentElement) {
                grupoBotoes.parentElement.style.display = 'flex';
                grupoBotoes.parentElement.style.alignItems = 'flex-start';
                grupoBotoes.parentElement.style.flexWrap = 'wrap';
            }
        }

        /* ---- 8.3. Ponto de entrada do modulo -------------------------------------------------------- */
        function iniciar() {
            SolarObservadorDOM.assinar(injetarBarraPesquisa);
            log.info('Modulo iniciado.');
        }

        return {
            id: 'busca-linha-do-tempo',
            nome: 'Busca na Linha do Tempo',
            descricao: 'Filtro em tempo real para eventos e documentos na Linha do Tempo do processo.',
            quando: 'dom',
            ativarEm: () => true,
            iniciar,
        };
    })();

    /* ============================================================================================
     * 9. SOLAR - COPIAR NOME DAS PARTES
     * ============================================================================================
     * Adiciona um botao de copia ao lado do nome das partes, tanto na tela inicial (avisos
     * pendentes) quanto nos detalhes do processo.
     * ------------------------------------------------------------------------------------------ */
    const ModuloCopiarNomeDasPartes = (() => {
        const log = criarLogger('9. Copiar Nome das Partes');

        /* ---- 9.1. Modulo de Estilos --------------------------------------------------------------- */
        function injetarEstilos() {
            if (document.getElementById('solar-copiar-nome-estilos')) return;
            GM_addStyle(`
                .btn-copiar-nome { cursor: pointer; margin-left: 6px; color: #666; font-size: 0.9em; display: inline-block; transition: transform 0.1s; }
                .btn-copiar-nome:hover { color: #333 !important; transform: scale(1.1); }
                .btn-copiar-nome.copiado { color: #28a745 !important; }
            `);
            const marcador = document.createElement('meta');
            marcador.id = 'solar-copiar-nome-estilos';
            marcador.style.display = 'none';
            document.head.appendChild(marcador);
        }

        /* ---- 9.2. Modulo de Limpeza de Texto -------------------------------------------------------- */
        function limparNome(texto) {
            // Remove espacos extras nas pontas e prefixos entre parenteses no inicio (ex.: "(AT) ").
            return texto.replace(/^\([^)]+\)\s*/, '').trim();
        }

        /* ---- 9.3. Modulo de Injecao Cirurgica -------------------------------------------------------- */
        function injetarBotoes() {
            // Cena 1: tela inicial (avisos pendentes) - o nome sempre fica na 4a coluna (indice 3).
            document.querySelectorAll('table tbody tr').forEach((linha) => {
                if (!linha.querySelector('td.reg_acoes')) return;

                const tdNome = linha.children[3];
                if (!tdNome || tdNome.hasAttribute('data-copy-injected')) return;

                const nomeCru = tdNome.textContent;
                if (nomeCru.trim().length === 0) return;

                const nomeLimpo = limparNome(nomeCru);
                const botao = SolarUtils.criarBotaoDeCopia(nomeLimpo, 'btn-copiar-nome');

                tdNome.textContent = nomeCru.trim() + ' ';
                tdNome.appendChild(botao);
                tdNome.setAttribute('data-copy-injected', 'true');
            });

            // Cena 2: tela de detalhes do processo.
            document.querySelectorAll('a[data-container="#popover_pessoa"]:not([data-copy-injected])').forEach((link) => {
                const tagNegrito = link.querySelector('b.ng-binding');
                if (!tagNegrito) return;

                const nomeLimpo = limparNome(tagNegrito.textContent);
                const botao = SolarUtils.criarBotaoDeCopia(nomeLimpo, 'btn-copiar-nome');

                tagNegrito.insertAdjacentElement('afterend', botao);
                link.setAttribute('data-copy-injected', 'true');
            });
        }

        /* ---- 9.4. Ponto de entrada do modulo ----------------------------------------------------------- */
        function iniciar() {
            injetarEstilos();
            SolarObservadorDOM.assinar(injetarBotoes);
            setTimeout(injetarBotoes, 1000);
            log.info('Modulo iniciado.');
        }

        return {
            id: 'copiar-nome-das-partes',
            nome: 'Copiar Nome das Partes',
            descricao: 'Adiciona botao de copia ao lado do nome das partes na tela inicial e nos detalhes do processo.',
            quando: 'dom',
            ativarEm: () => true,
            iniciar,
        };
    })();

    /* ============================================================================================
     * 10. SOLAR - COPIAR NUMERO DE PROCESSO
     * ============================================================================================
     * Adiciona um botao de copia ao lado dos numeros de processo, nas telas inicial e de
     * detalhes, extraindo o numero pelo padrao CNJ.
     * ------------------------------------------------------------------------------------------ */
    const ModuloCopiarNumeroDeProcesso = (() => {
        const log = criarLogger('10. Copiar Numero de Processo');

        /* ---- 10.1. Modulo de Estilos -------------------------------------------------------------- */
        function injetarEstilos() {
            if (document.getElementById('solar-copiar-numero-estilos')) return;
            GM_addStyle(`
                .btn-copiar-processo {
                    cursor: pointer; margin-left: 6px; color: #666; font-size: 0.9em; display: inline-flex;
                    align-items: center; transition: transform 0.1s; text-decoration: none !important;
                }
                .btn-copiar-processo:hover { color: #333 !important; transform: scale(1.1); }
                .btn-copiar-processo.copiado { color: #28a745 !important; }
            `);
            const marcador = document.createElement('meta');
            marcador.id = 'solar-copiar-numero-estilos';
            marcador.style.display = 'none';
            document.head.appendChild(marcador);
        }

        /* ---- 10.2. Modulo de Injecao Cirurgica ------------------------------------------------------ */
        function injetarBotoes() {
            // Seletores exatos: 1) tela inicial (avisos pendentes); 2) cabecalho dos detalhes;
            // 3) link das partes nos detalhes.
            const seletores = [
                'a.btn-link[href*="/processo/identificar/"] b',
                'b.text-error.ng-binding',
                'a.btn-link[href*="/processo/listar/"] b',
            ].join(', ');

            document.querySelectorAll(seletores).forEach((tagNegrito) => {
                if (tagNegrito.hasAttribute('data-copy-injected')) return;

                const encontrado = tagNegrito.textContent.match(SolarUtils.REGEX_PROCESSO_CNJ);
                if (!encontrado) return;

                const numeroProcesso = encontrado[0];
                const botao = SolarUtils.criarBotaoDeCopia(numeroProcesso, 'btn-copiar-processo');

                // Inserido logo APOS a tag <b>, protegendo o botao de ser apagado quando o
                // Angular atualizar os dados do processo.
                tagNegrito.insertAdjacentElement('afterend', botao);
                tagNegrito.setAttribute('data-copy-injected', 'true');
            });
        }

        /* ---- 10.3. Ponto de entrada do modulo --------------------------------------------------------- */
        function iniciar() {
            injetarEstilos();
            SolarObservadorDOM.assinar(injetarBotoes);
            setTimeout(injetarBotoes, 1000);
            log.info('Modulo iniciado.');
        }

        return {
            id: 'copiar-numero-de-processo',
            nome: 'Copiar Numero de Processo',
            descricao: 'Adiciona botao de copia ao lado dos numeros de processo nas telas inicial e de detalhes.',
            quando: 'dom',
            ativarEm: () => true,
            iniciar,
        };
    })();

    /* ============================================================================================
     * 11. SOLAR - DESTACAR PRAZOS
     * ============================================================================================
     * Destaca prazos criticos, proximos e expirados nas listas do Solar (cores de fundo + badges
     * informativos), com um painel de resumo no topo da tabela contando quantos itens ha em cada
     * situacao.
     * ------------------------------------------------------------------------------------------ */
    const ModuloDestacarPrazos = (() => {
        const log = criarLogger('11. Destacar Prazos');

        /* ---- 11.1. Modulo de Configuracao de Regras ------------------------------------------------ */
        const CONFIG = {
            dias: { amarelo: 4, vermelho: 3, ciencia: 2 },
            seletorTabela: 'table.table-striped.table-hover',
        };

        // Regex compilada uma unica vez na inicializacao.
        const REGEX_DATA = /(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/g;

        /* ---- 11.2. Modulo de Estilos ------------------------------------------------------------------ */
        function injetarEstilos() {
            if (document.getElementById('solar-prazos-estilos')) return;
            GM_addStyle(`
                tr.solar-critico td:first-child { box-shadow: inset 4px 0 0 0 #c62828 !important; }
                tr.solar-atencao td:first-child { box-shadow: inset 4px 0 0 0 #f9a825 !important; }
                tr.solar-verde td:first-child { box-shadow: inset 4px 0 0 0 #2e7d32 !important; }
                tr.solar-expirado td:first-child { box-shadow: inset 4px 0 0 0 #0073b7 !important; }

                tr.solar-critico > td { background-color: #ffebee !important; border-bottom: 1px solid #ffcdd2 !important; }
                tr.solar-atencao > td { background-color: #fffde7 !important; border-bottom: 1px solid #fff59d !important; }
                tr.solar-verde > td { background-color: #e8f5e9 !important; border-bottom: 1px solid #c8e6c9 !important; }
                tr.solar-expirado > td { background-color: #F5F9FF !important; border-bottom: 1px solid #0073b7 !important; }

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

                .solar-resumo-container { display: flex; gap: 12px; margin: 10px 0; flex-wrap: wrap; }
                .solar-resumo-item {
                    padding: 6px 16px; border-radius: 6px; font-weight: 600; font-size: 12px;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid rgba(0,0,0,0.05);
                }
            `);
            const marcador = document.createElement('meta');
            marcador.id = 'solar-prazos-estilos';
            marcador.style.display = 'none';
            document.head.appendChild(marcador);
        }

        /* ---- 11.3. Modulo de Parsing de Datas ---------------------------------------------------------- */
        function converterDataBR(str) {
            if (!str) return null;
            const encontrados = [...str.matchAll(REGEX_DATA)];
            if (encontrados.length === 0) return null;
            const m = encontrados[encontrados.length - 1];
            return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 23), +(m[5] || 59), 59);
        }

        const diasRestantes = (dataAlvo) => (dataAlvo - new Date()) / 86400000;

        /* ---- 11.4. Estado e Contadores --------------------------------------------------------------- */
        let containerAlvo = null;
        const contadoresGlobais = {
            qtdCienciaProxima: 0, qtdAmarelo: 0, qtdVermelho: 0,
            qtdCienciaSistema: 0, qtdExpirado: 0, qtdFechado: 0,
        };

        function anexarBadge(container, texto, classeCor, icone) {
            const badge = document.createElement('div');
            badge.className = `solar-prazo-badge ${classeCor}`;
            badge.innerHTML = `<i class="fas ${icone}"></i> ${SolarUtils.escapeHtml(texto)}`;
            container.appendChild(badge);
        }

        /* ---- 11.5. Modulo de Resumo em Lote (evita "layout thrashing") -------------------------------- */
        function atualizarResumo(tabela) {
            try {
                let div = document.getElementById('solar-prazo-resumo');
                if (!div) {
                    div = document.createElement('div');
                    div.id = 'solar-prazo-resumo';
                    div.className = 'solar-resumo-container';
                    tabela.parentNode?.insertBefore(div, tabela);
                }

                const fragmentos = [];
                if (contadoresGlobais.qtdExpirado > 0) fragmentos.push(`<span class="solar-resumo-item" style="background:#0073b7; color:#ffffff;">❌ ${contadoresGlobais.qtdExpirado} expirado(s)</span>`);
                if (contadoresGlobais.qtdFechado > 0) fragmentos.push(`<span class="solar-resumo-item" style="background:#e8f5e9; color:#2e7d32; border-color:#c8e6c9;">✔ ${contadoresGlobais.qtdFechado} fechado(s)</span>`);
                if (contadoresGlobais.qtdCienciaSistema > 0) fragmentos.push(`<span class="solar-resumo-item" style="background:#fffde7; color:#f57f17; border-color:#fff59d;">⚠️ ${contadoresGlobais.qtdCienciaSistema} ciencia(s) pelo sistema</span>`);
                if (contadoresGlobais.qtdVermelho > 0) fragmentos.push(`<span class="solar-resumo-item" style="background:#ffebee; color:#c62828; border-color:#ffcdd2;">⚠ ${contadoresGlobais.qtdVermelho} prazo(s) critico(s)</span>`);
                if (contadoresGlobais.qtdAmarelo > 0) fragmentos.push(`<span class="solar-resumo-item" style="background:#fffde7; color:#f57f17; border-color:#fff59d;">⏰ ${contadoresGlobais.qtdAmarelo} atencao</span>`);
                if (contadoresGlobais.qtdCienciaProxima > 0) fragmentos.push(`<span class="solar-resumo-item" style="background:#fffde7; color:#f57f17; border-color:#fff59d;">🔔 ${contadoresGlobais.qtdCienciaProxima} ciencia(s) proxima(s)</span>`);

                div.innerHTML = fragmentos.join('');
            } catch (erro) {
                log.warn('Falha ao atualizar painel de resumo.', erro);
            }
        }

        /* ---- 11.6. Motor de Processamento -------------------------------------------------------------- */
        function processarTabela() {
            try {
                const tabela = document.querySelector(CONFIG.seletorTabela);
                if (!tabela) return;

                const linhasNaoProcessadas = tabela.querySelectorAll('tbody tr:not([data-prazo-processado="1"])');
                if (linhasNaoProcessadas.length === 0) return;

                const urlParams = new URLSearchParams(window.location.search);
                const tipoSituacaoURL = urlParams.get('situacao');

                // Pausa o observador central ANTES de mexer no DOM, para que os badges e classes
                // que este modulo insere nao disparem uma nova rodada de callbacks (inclusive de
                // outros modulos) enquanto a escrita esta em andamento.
                SolarObservadorDOM.pausar();

                let alterouAlguma = false;

                linhasNaoProcessadas.forEach((tr) => {
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

                    const dataVenc = converterDataBR(textoPrazo);
                    if (!dataVenc && !isHtmlExpirado) return;

                    const dias = dataVenc ? diasRestantes(dataVenc) : -1;
                    const isPendenteAbertura = tipoSituacaoURL === '10' || (tr.textContent || '').includes('Aguardando Abertura');
                    const isExpiradoContext = tipoSituacaoURL === '40';

                    if (isHtmlExpirado || dias < 0) {
                        if (isPendenteAbertura) {
                            tr.classList.add('solar-atencao');
                            anexarBadge(tdPrazo, 'CIENCIA REGISTRADA PELO SISTEMA', 'solar-badge-amarelo', 'fa-exclamation-triangle');
                            contadoresGlobais.qtdCienciaSistema++;
                        } else if (isExpiradoContext) {
                            tr.classList.add('solar-expirado');
                            anexarBadge(tdPrazo, 'EXPIRADO O PRAZO FATAL', 'solar-badge-preto', 'fa-times-circle');
                            contadoresGlobais.qtdExpirado++;
                        } else {
                            tr.classList.add('solar-critico');
                            anexarBadge(tdPrazo, 'PRAZO CRITICO', 'solar-badge-vermelho', 'fa-exclamation-triangle');
                            contadoresGlobais.qtdVermelho++;
                        }
                        alterouAlguma = true;
                        return;
                    }

                    if (isPendenteAbertura) {
                        if (dias <= CONFIG.dias.ciencia) {
                            tr.classList.add('solar-atencao');
                            anexarBadge(tdPrazo, 'CIENCIA PROXIMA', 'solar-badge-amarelo', 'fa-bell');
                            contadoresGlobais.qtdCienciaProxima++;
                            alterouAlguma = true;
                        }
                        return;
                    }

                    if (dias <= CONFIG.dias.vermelho) {
                        tr.classList.add('solar-critico');
                        anexarBadge(tdPrazo, 'PRAZO CRITICO', 'solar-badge-vermelho', 'fa-exclamation-triangle');
                        contadoresGlobais.qtdVermelho++;
                        alterouAlguma = true;
                    } else if (dias <= CONFIG.dias.amarelo) {
                        tr.classList.add('solar-atencao');
                        anexarBadge(tdPrazo, 'PRAZO PROXIMO', 'solar-badge-amarelo-branco', 'fa-clock');
                        contadoresGlobais.qtdAmarelo++;
                        alterouAlguma = true;
                    }
                });

                if (alterouAlguma) atualizarResumo(tabela);

                SolarObservadorDOM.retomar();
            } catch (erro) {
                log.warn('Falha ao processar tabela de prazos.', erro);
                SolarObservadorDOM.retomar();
            }
        }

        /* ---- 11.7. Ponto de entrada do modulo ----------------------------------------------------------- */
        function iniciar() {
            injetarEstilos();
            containerAlvo = document.querySelector('.table-responsive') ?? document.body;

            const processarDebounced = SolarUtils.debounce(processarTabela, 300);
            SolarObservadorDOM.assinar((mutations) => {
                if (mutations.some((m) => m.addedNodes.length > 0)) processarDebounced();
            });

            processarTabela();
            log.info('Modulo iniciado.');
        }

        return {
            id: 'destacar-prazos',
            nome: 'Destacar Prazos',
            descricao: 'Destaca prazos criticos, proximos e expirados nas listas do Solar, com painel de resumo.',
            quando: 'dom',
            ativarEm: () => true,
            iniciar,
        };
    })();

    /* ============================================================================================
     * 12. INICIALIZACAO GERAL (BOOTSTRAP)
     * ============================================================================================
     * Ultimo topico do arquivo: reune todos os modulos definidos acima, decide QUANDO e SE cada
     * um deve rodar (respeitando ativacao/desativacao e a pagina atual) e monta os itens fixos do
     * painel de engrenagem que nao pertencem a nenhum script especifico (Ativar/Desativar
     * Scripts, Sobre este Script). O modulo 1.9 (Changelog) e chamado por ultimo, depois de tudo
     * estar de pe, para so entao decidir se mostra boas-vindas/atualizacao.
     * ------------------------------------------------------------------------------------------ */
    const logBootstrap = criarLogger('Bootstrap');

    const MODULOS = [
        ModuloIdentificador,
        ModuloMarcadorVisitados,
        ModuloMaterializacaoPorData,
        ModuloNotificador,
        ModuloPaginacaoAvancada,
        ModuloAtualizacaoForcada,
        ModuloBuscaLinhaDoTempo,
        ModuloCopiarNomeDasPartes,
        ModuloCopiarNumeroDeProcesso,
        ModuloDestacarPrazos,
    ];

    /* ---- 12.1. Modulo do Painel "Ativar/Desativar Scripts" -------------------------------------- */
    function abrirPainelDeModulos() {
        const listaHtml = MODULOS.map((modulo) => `
            <label class="solar-scripts-check-linha">
                <input type="checkbox" data-modulo-id="${modulo.id}" ${SolarGerenciadorDeModulos.estaAtivo(modulo.id) ? 'checked' : ''}>
                <span>${SolarUtils.escapeHtml(modulo.nome)}
                    <span class="solar-scripts-check-descricao">${SolarUtils.escapeHtml(modulo.descricao)}</span>
                </span>
            </label>
        `).join('');

        SolarUI.abrirModal({
            titulo: '🧩 Ativar/Desativar Scripts',
            dica: 'Desmarque os scripts que voce nao quer usar. A pagina precisa ser recarregada para as mudancas terem efeito.',
            corpo: `<div>${listaHtml}</div>`,
            largura: '540px',
            acoes: [
                { texto: 'Cancelar', classe: 'secundario', aoClicar: (fechar) => fechar() },
                {
                    texto: 'Salvar e recarregar',
                    classe: 'primario',
                    aoClicar: (fechar, modal) => {
                        modal.querySelectorAll('[data-modulo-id]').forEach((checkbox) => {
                            SolarGerenciadorDeModulos.definirAtivo(checkbox.dataset.moduloId, checkbox.checked);
                        });
                        fechar();
                        window.location.reload();
                    },
                },
            ],
        });
    }

    /* ---- 12.2. Modulo da Tela "Sobre este Script" (inclui o interruptor de Modo Debug) ---------- */
    function abrirSobre() {
        const modoDebugAtivo = GM_getValue(SolarConfig.CHAVES.MODO_DEBUG, false);

        SolarUI.abrirModal({
            titulo: `ℹ️ ${SolarConfig.NOME_SCRIPT}`,
            dica: `Versao ${SolarConfig.VERSAO} - ${MODULOS.length} scripts inclusos.`,
            corpo: `
                <p style="font-size:13px;">Compilado de scripts de produtividade para o Solar, mantido pela Defensoria Publica de Minas Gerais - Unidade Passos.</p>
                <p style="font-size:13px;">
                    <a href="${SolarConfig.HOMEPAGE_URL}" target="_blank" rel="noopener noreferrer">Repositório no GitHub</a>
                    &nbsp;&middot;&nbsp;
                    <a href="${SolarConfig.HOMEPAGE_URL}/issues" target="_blank" rel="noopener noreferrer">Reportar um problema</a>
                </p>
                <hr>
                <label class="solar-scripts-check-linha">
                    <input type="checkbox" id="sobre-modo-debug" ${modoDebugAtivo ? 'checked' : ''}>
                    <span>Modo debug<span class="solar-scripts-check-descricao">Mostra mensagens detalhadas ("info") de todos os modulos no console do navegador. Util para diagnosticar problemas.</span></span>
                </label>
            `,
            largura: '460px',
            acoes: [
                {
                    texto: 'Fechar',
                    classe: 'primario',
                    aoClicar: (fechar, modal) => {
                        GM_setValue(SolarConfig.CHAVES.MODO_DEBUG, modal.querySelector('#sobre-modo-debug').checked);
                        fechar();
                    },
                },
            ],
        });
    }

    /* ---- 12.3. Modulo de Orquestracao (decide o que roda, quando, e com que seguranca) ---------- */
    function moduloDeveRodarAgora(modulo) {
        try {
            return SolarGerenciadorDeModulos.estaAtivo(modulo.id) && modulo.ativarEm(window.location.pathname);
        } catch (erro) {
            logBootstrap.error(`Falha ao avaliar se o modulo "${modulo.id}" deve rodar nesta pagina.`, erro);
            return false;
        }
    }

    function iniciarModuloComSeguranca(modulo) {
        try {
            modulo.iniciar();
        } catch (erro) {
            // Um modulo com erro nao deve derrubar os demais - cada iniciar() roda isolado.
            logBootstrap.error(`O script "${modulo.nome}" (${modulo.id}) lancou um erro ao iniciar e foi ignorado.`, erro);
        }
    }

    /* ---- 12.4. Sequencia de Boot -------------------------------------------------------------------
     * Fase 1 roda de forma sincrona, ainda em document-start (so o topico 7 usa isso hoje).
     * Fase 2 roda quando o DOM estiver pronto (ver SolarUtils.aoDomPronto): injeta estilos e o
     * painel de engrenagem, registra os itens fixos do menu, inicia os demais modulos e, por
     * ultimo, verifica se deve mostrar a mensagem de boas-vindas/atualizacao.
     * ------------------------------------------------------------------------------------------ */
    MODULOS.filter((modulo) => modulo.quando === 'start' && moduloDeveRodarAgora(modulo))
        .forEach(iniciarModuloComSeguranca);

    SolarUtils.aoDomPronto(() => {
        injetarEstilosGlobais();
        SolarPainelConfiguracoes.inicializar();

        // Os modulos 'dom' rodam ANTES dos itens fixos do menu serem registrados: assim, quando
        // o Notificador (topico 5) se registra na engrenagem durante o proprio iniciar(), o item
        // "Configurar Notificador" aparece no topo do menu, antes dos itens genericos de gestao
        // do script (Ativar/Desativar, Historico, Sobre), que fazem mais sentido no rodape.
        MODULOS.filter((modulo) => modulo.quando === 'dom' && moduloDeveRodarAgora(modulo))
            .forEach(iniciarModuloComSeguranca);

        SolarPainelConfiguracoes.registrarItemMenu({
            icone: '🧩',
            texto: 'Ativar/Desativar Scripts',
            aoClicar: abrirPainelDeModulos,
        });
        SolarChangelog.registrarNoPainel();
        SolarPainelConfiguracoes.registrarItemMenu({
            icone: 'ℹ️',
            texto: 'Sobre este Script',
            aoClicar: abrirSobre,
        });

        SolarChangelog.verificarInstalacaoOuAtualizacao(MODULOS);

        logBootstrap.info(`Inicializacao concluida (${SolarConfig.VERSAO}). ${MODULOS.length} scripts disponiveis nesta instalacao.`);
    });
})();
