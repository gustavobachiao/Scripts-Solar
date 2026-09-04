// ==UserScript==
// @name         Solar - Marcador de Processos Visitados
// @namespace    https://solar.defensoria.mg.def.br/
// @version      1.0.0
// @description  Pinta de roxo o numero do processo ao clicar nele ou no botao de copiar, marcando visualmente o que ja foi visitado.
// @author       Defensoria Publica de Minas Gerais
// @match        https://solar.defensoria.mg.def.br/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/gustavobachiao/Scripts-Solar/main/Solar-marcador-processos-visitados.user.js
// @downloadURL  https://raw.githubusercontent.com/gustavobachiao/Scripts-Solar/main/Solar-marcador-processos-visitados.user.js
// @homepageURL  https://github.com/gustavobachiao/Scripts-Solar
// @supportURL   https://github.com/gustavobachiao/Scripts-Solar/issues
// ==/UserScript==

(function() {
    'use strict';

    // O 'true' no final aciona a "Fase de Captura". O script ouve o clique ANTES do Solar bloqueá-lo.
    document.body.addEventListener('click', function(evento) {

        const alvo = evento.target;

        // 1. Tenta achar o link do processo diretamente (caso o usuário clique no número)
        let linkProcesso = alvo.closest('a.btn-link[href*="/processo/identificar/"], a.btn-link[href*="/processo/listar/"]');

        // 2. Se não clicou no número, verifica se clicou em algum "botão de copiar"
        // (Rastreia os ícones e títulos de cópia mais comuns do sistema)
        if (!linkProcesso) {
            const botaoCopiar = alvo.closest('[title*="opiar"], [class*="copy"], [class*="copiar"], .fa-copy, .fa-clipboard, [ng-click*="copiar"]');

            if (botaoCopiar) {
                // Acha a "caixa" (linha da tabela ou cartão) onde o botão de cópia está e busca o processo dela
                const container = botaoCopiar.closest('td, li, div.media, div.media-body, span, div');
                if (container) {
                    linkProcesso = container.querySelector('a.btn-link[href*="/processo/identificar/"], a.btn-link[href*="/processo/listar/"]');
                }
            }
        }

        // 3. Se identificou a qual processo o clique pertence, pinta ele de roxo!
        if (linkProcesso) {
            const textoProcesso = linkProcesso.querySelector('b');

            if (textoProcesso) {
                textoProcesso.style.setProperty('color', '#800080', 'important');
            } else {
                linkProcesso.style.setProperty('color', '#800080', 'important');
            }
        }
    }, true); // <-- 'true' faz a mágica de furar o bloqueio do sistema!
})();
