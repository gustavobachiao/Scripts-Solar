// ==UserScript==
// @name         Solar - Copiar Numero de Processo
// @namespace    https://solar.defensoria.mg.def.br/
// @version      2.0.0
// @description  Adiciona botao de copia ao lado dos numeros de processo nas telas inicial e de detalhes.
// @author       Defensoria Publica de Minas Gerais - Unidade Passos
// @match        https://solar.defensoria.mg.def.br/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/gustavobachiao/Scripts-Solar/main/Solar-copiar-numero-processo.user.js
// @downloadURL  https://raw.githubusercontent.com/gustavobachiao/Scripts-Solar/main/Solar-copiar-numero-processo.user.js
// @homepageURL  https://github.com/gustavobachiao/Scripts-Solar
// @supportURL   https://github.com/gustavobachiao/Scripts-Solar/issues
// ==/UserScript==

(function() {
    'use strict';

    // ─── Regex para o padrão CNJ (Usado apenas para extração segura) ───────────
    const regexProcesso = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/;

    // ─── Estilos Visuais (Padronizado) ──────────────────────────────────────────
    function injetarEstilos() {
        if (document.getElementById('solar-copy-process-styles')) return;
        const style = document.createElement('style');
        style.id = 'solar-copy-process-styles';
        style.innerHTML = `
            .btn-copiar-processo {
                cursor: pointer;
                margin-left: 6px;
                color: #666;
                font-size: 0.9em;
                display: inline-flex;
                align-items: center;
                transition: transform 0.1s;
                text-decoration: none !important;
            }
            .btn-copiar-processo:hover {
                color: #333 !important;
                transform: scale(1.1);
            }
            .btn-copiar-processo.copiado {
                color: #28a745 !important;
            }
        `;
        document.head.appendChild(style);
    }

    // ─── Lógica de Cópia ────────────────────────────────────────────────────────
    function copiar(texto, btnElement) {
        navigator.clipboard.writeText(texto).catch(function() {
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
    function injetarBotoesProcesso() {
        // Seletores CSS exatos baseados na estrutura enviada
        const seletores = [
            'a.btn-link[href*="/processo/identificar/"] b',   // 1. Tela Inicial (Avisos Pendentes)
            'b.text-error.ng-binding',                        // 2. Detalhes (1) - Cabeçalho
            'a.btn-link[href*="/processo/listar/"] b'         // 3. Detalhes (2) - Link partes
        ].join(', ');

        const elementosAlvo = document.querySelectorAll(seletores);

        elementosAlvo.forEach(tagB => {
            // Evita duplicatas se o botão já foi injetado nesta tag
            if (tagB.hasAttribute('data-copy-injected')) return;

            const textoCru = tagB.textContent;
            const match = textoCru.match(regexProcesso);

            if (match) {
                const numeroProcesso = match[0];

                const btn = document.createElement('span');
                btn.className = 'btn-copiar-processo';
                btn.title = `Copiar: ${numeroProcesso}`;
                btn.innerHTML = '<i class="fas fa-copy"></i>';

                btn.addEventListener('click', function(e) {
                    e.preventDefault();  // Evita que o link abra ao clicar em copiar
                    e.stopPropagation(); // Evita conflitos com popovers do Angular
                    copiar(numeroProcesso, btn);
                });

                // Insere o botão logo APÓS a tag <b>.
                // Isso protege o botão de ser apagado quando o Angular atualizar os dados do processo.
                tagB.insertAdjacentElement('afterend', btn);

                // Marca o elemento como processado
                tagB.setAttribute('data-copy-injected', 'true');
            }
        });
    }

    // ─── Inicialização e Monitoramento ──────────────────────────────────────────
    injetarEstilos();

    // Como os seletores são específicos, o MutationObserver rodará de forma ultra leve
    const observer = new MutationObserver(() => {
        injetarBotoesProcesso();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Tenta rodar logo no início também
    setTimeout(injetarBotoesProcesso, 1000);

})();
