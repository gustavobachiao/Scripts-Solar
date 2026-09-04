// ==UserScript==
// @name         Solar - Paginacao Avancada
// @namespace    https://solar.defensoria.mg.def.br/
// @version      1.0.0
// @description  Expande a paginacao para ate 20 botoes e adiciona campo de salto direto para uma pagina especifica.
// @author       Defensoria Publica de Minas Gerais
// @match        https://solar.defensoria.mg.def.br/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/SEU-USUARIO/Scripts-Solar/main/solar-paginacao-avancada.user.js
// @downloadURL  https://raw.githubusercontent.com/SEU-USUARIO/Scripts-Solar/main/solar-paginacao-avancada.user.js
// @homepageURL  https://github.com/SEU-USUARIO/Scripts-Solar
// @supportURL   https://github.com/SEU-USUARIO/Scripts-Solar/issues
// ==/UserScript==

(function() {
    'use strict';

    // ─── Estilos Visuais ────────────────────────────────────────────────────────
    function injetarEstilos() {
        if (document.getElementById('solar-avancado-styles')) return;
        const style = document.createElement('style');
        style.id = 'solar-avancado-styles';
        style.innerHTML = `
            /* Container do Salto Direto */
            .solar-salto-wrapper {
                display: inline-flex;
                align-items: center;
                margin-left: 15px;
                margin-top: 3px;
                gap: 6px; /* Cria um espaço uniforme entre o campo e o botão */
            }
            /* Campo de Input */
            .solar-input-salto {
                width: 90px;
                height: 32px !important;
                padding: 4px 10px;
                border: 1px solid #ccc;
                border-radius: 4px; /* Todas as bordas arredondadas */
                text-align: center;
                font-weight: bold;
                color: #333;
                background-color: #fff;
                box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
                transition: border-color 0.2s;
                box-sizing: border-box !important;
                margin: 0 !important;
            }
            .solar-input-salto:focus {
                border-color: #2a6099;
                outline: none;
            }
            /* Botão Ir */
            .solar-btn-ir {
                height: 32px !important;
                padding: 0 14px;
                border: 1px solid #2a6099;
                border-radius: 4px; /* Todas as bordas arredondadas */
                background-color: #2a6099;
                color: #ffffff;
                font-weight: bold;
                cursor: pointer;
                transition: background-color 0.2s;
                box-sizing: border-box !important;
                margin: 0 !important;
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }
            .solar-btn-ir:hover {
                background-color: #1a4a7a;
            }
        `;
        document.head.appendChild(style);
    }

    // ─── Lógica de Expansão da Barra de Botões (20 Números) ─────────────────────
    function expandirBarraDePaginacao(ulElement) {
        if (ulElement.hasAttribute('data-expandido')) return;

        const liAtivo = ulElement.querySelector('li.active');
        if (!liAtivo) return;
        const paginaAtual = parseInt(liAtivo.textContent.trim(), 10);

        let totalPaginas = paginaAtual;
        const linkUltima = ulElement.querySelector('a[data-original-title="Última página"]');
        if (linkUltima) {
            const match = linkUltima.getAttribute('href').match(/page=(\d+)/);
            if (match) totalPaginas = parseInt(match[1], 10);
        } else {
            const links = ulElement.querySelectorAll('a[href*="page="]');
            links.forEach(a => {
                const m = a.getAttribute('href').match(/page=(\d+)/);
                if (m) {
                    const p = parseInt(m[1], 10);
                    if (p > totalPaginas) totalPaginas = p;
                }
            });
        }

        let inicio = Math.max(1, paginaAtual - 9);
        let fim = Math.min(totalPaginas, inicio + 19);

        if (fim - inicio < 19) {
            inicio = Math.max(1, fim - 19);
        }

        const lis = Array.from(ulElement.children);
        let indexDeInsercao = -1;

        lis.forEach((li, index) => {
            const texto = li.textContent.trim();
            if (/^\d+$/.test(texto)) {
                if (indexDeInsercao === -1) indexDeInsercao = index;
                li.remove();
            }
        });

        if (indexDeInsercao === -1) return;

        const fragmento = document.createDocumentFragment();
        const urlBase = new URL(window.location.href);

        for (let i = inicio; i <= fim; i++) {
            const novoLi = document.createElement('li');
            if (i === paginaAtual) {
                novoLi.className = 'active';
                novoLi.innerHTML = `<a href="#">${i}</a>`;
            } else {
                urlBase.searchParams.set('page', i);
                novoLi.innerHTML = `<a href="${urlBase.toString()}">${i}</a>`;
            }
            fragmento.appendChild(novoLi);
        }

        const liReferencia = ulElement.children[indexDeInsercao];
        if (liReferencia) {
            ulElement.insertBefore(fragmento, liReferencia);
        } else {
            ulElement.appendChild(fragmento);
        }

        ulElement.setAttribute('data-expandido', 'true');
    }

    // ─── Navegação por URL (Salto de Página) ────────────────────────────────────
    function pularParaPagina(numeroPagina) {
        const urlAtual = new URL(window.location.href);
        urlAtual.searchParams.set('page', numeroPagina);
        window.location.href = urlAtual.toString();
    }

    // ─── Injeção Geral na Interface ─────────────────────────────────────────────
    function aplicarMelhorias() {
        const divPaginacoes = document.querySelectorAll('.pagination-right');
        if (divPaginacoes.length === 0) return;

        injetarEstilos();

        divPaginacoes.forEach(div => {
            const ulElement = div.querySelector('ul');
            if (!ulElement) return;

            expandirBarraDePaginacao(ulElement);

            if (div === divPaginacoes[divPaginacoes.length - 1] && !document.getElementById('solar-salto-wrapper')) {
                const wrapper = document.createElement('div');
                wrapper.id = 'solar-salto-wrapper';
                wrapper.className = 'solar-salto-wrapper';

                const input = document.createElement('input');
                input.type = 'number';
                input.min = 1;
                input.className = 'solar-input-salto';
                input.placeholder = 'Página...';
                input.title = 'Digite o número e aperte Enter ou clique em Ir';

                const btnIr = document.createElement('button');
                btnIr.className = 'solar-btn-ir';
                btnIr.textContent = 'Ir';
                btnIr.title = 'Ir para a página digitada';

                input.addEventListener('keyup', function(e) {
                    if (e.key === 'Enter') {
                        const novaPagina = parseInt(this.value, 10);
                        if (!isNaN(novaPagina) && novaPagina > 0) {
                            pularParaPagina(novaPagina);
                        }
                    }
                });

                btnIr.addEventListener('click', function() {
                    const novaPagina = parseInt(input.value, 10);
                    if (!isNaN(novaPagina) && novaPagina > 0) {
                        pularParaPagina(novaPagina);
                    }
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

    // ─── Inicialização e Monitoramento ──────────────────────────────────────────
    function inicializar() {
        const observer = new MutationObserver(() => {
            if (document.querySelector('.pagination-right')) {
                aplicarMelhorias();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(aplicarMelhorias, 800);
    }

    inicializar();
})();
