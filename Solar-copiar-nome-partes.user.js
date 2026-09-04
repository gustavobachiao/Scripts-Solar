// ==UserScript==
// @name         Solar - Copiar Nome das Partes
// @namespace    https://solar.defensoria.mg.def.br/
// @version      1.0.0
// @description  Adiciona botao de copia ao lado do nome das partes na tela inicial e nos detalhes do processo.
// @author       Defensoria Publica de Minas Gerais
// @match        https://solar.defensoria.mg.def.br/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/gustavobachiao/Scripts-Solar/main/Solar-copiar-nome-partes.user.js
// @downloadURL  https://raw.githubusercontent.com/gustavobachiao/Scripts-Solar/main/Solar-copiar-nome-partes.user.js
// @homepageURL  https://github.com/gustavobachiao/Scripts-Solar
// @supportURL   https://github.com/gustavobachiao/Scripts-Solar/issues
// ==/UserScript==

(function() {
    'use strict';

    // ─── Estilos Visuais (Padronizado) ──────────────────────────────────────────
    function injetarEstilos() {
        if (document.getElementById('solar-copy-name-styles')) return;
        const style = document.createElement('style');
        style.id = 'solar-copy-name-styles';
        style.innerHTML = `
            .btn-copiar-nome {
                cursor: pointer;
                margin-left: 6px;
                color: #666;
                font-size: 0.9em;
                display: inline-block;
                transition: transform 0.1s;
            }
            .btn-copiar-nome:hover {
                color: #333 !important;
                transform: scale(1.1);
            }
            .btn-copiar-nome.copiado {
                color: #28a745 !important;
            }
        `;
        document.head.appendChild(style);
    }

    // ─── Lógica de Cópia e Limpeza de Texto ─────────────────────────────────────
    function limparNome(texto) {
        // Remove espaços extras nas pontas e limpa prefixos entre parênteses no início (ex: "(AT) ", "(RE) ")
        return texto.replace(/^\([^)]+\)\s*/, '').trim();
    }

    function copiar(texto, btnElement) {
        navigator.clipboard.writeText(texto).catch(function() {
            // Fallback caso a API moderna falhe
            const ta = document.createElement('textarea');
            ta.value = texto;
            ta.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        });

        // Feedback Visual (Fica verde com o check de sucesso)
        const icone = btnElement.querySelector('i');
        if (icone) {
            icone.className = 'fas fa-check';
            btnElement.classList.add('copiado');
            setTimeout(() => {
                icone.className = 'fas fa-copy';
                btnElement.classList.remove('copiado');
            }, 1500);
        }
    }

    // ─── Injeção Cirúrgica ──────────────────────────────────────────────────────
    function injetarBotoes() {

        // CENA 1: Tela Inicial (Avisos Pendentes)
        const linhasTabela = document.querySelectorAll('table tbody tr');
        linhasTabela.forEach(tr => {
            if (!tr.querySelector('td.reg_acoes')) return;

            // O nome sempre fica na 4ª coluna (índice 3)
            const tdNome = tr.children[3];

            if (!tdNome || tdNome.hasAttribute('data-copy-injected')) return;

            const nomeCru = tdNome.textContent;
            if (nomeCru.trim().length > 0) {
                const nomeLimpo = limparNome(nomeCru);

                const btn = document.createElement('span');
                btn.className = 'btn-copiar-nome';
                btn.title = `Copiar: ${nomeLimpo}`;
                btn.innerHTML = '<i class="fas fa-copy"></i>';

                btn.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    copiar(nomeLimpo, btn);
                });

                tdNome.textContent = nomeCru.trim() + ' ';
                tdNome.appendChild(btn);

                tdNome.setAttribute('data-copy-injected', 'true');
            }
        });


        // CENA 2: Tela de Detalhes do Processo
        const linksPartes = document.querySelectorAll('a[data-container="#popover_pessoa"]:not([data-copy-injected])');

        linksPartes.forEach(a => {
            const tagB = a.querySelector('b.ng-binding');
            if (!tagB) return;

            const nomeCru = tagB.textContent;
            const nomeLimpo = limparNome(nomeCru);

            const btn = document.createElement('span');
            btn.className = 'btn-copiar-nome';
            btn.title = `Copiar: ${nomeLimpo}`;
            btn.innerHTML = '<i class="fas fa-copy"></i>';

            btn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                copiar(nomeLimpo, btn);
            });

            tagB.insertAdjacentElement('afterend', btn);

            a.setAttribute('data-copy-injected', 'true');
        });
    }

    // ─── Inicialização e Monitoramento ──────────────────────────────────────────
    injetarEstilos();

    const observer = new MutationObserver(() => {
        injetarBotoes();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(injetarBotoes, 1000);

})();
