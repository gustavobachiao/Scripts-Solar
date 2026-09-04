// ==UserScript==
// @name         Solar - Busca na Linha do Tempo
// @namespace    https://solar.defensoria.mg.def.br/
// @version      1.0.0
// @description  Filtro em tempo real para eventos e documentos na Linha do Tempo do Solar.
// @author       Defensoria Publica de Minas Gerais
// @match        https://solar.defensoria.mg.def.br/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/SEU-USUARIO/Scripts-Solar/main/solar-busca-linha-do-tempo.user.js
// @downloadURL  https://raw.githubusercontent.com/SEU-USUARIO/Scripts-Solar/main/solar-busca-linha-do-tempo.user.js
// @homepageURL  https://github.com/SEU-USUARIO/Scripts-Solar
// @supportURL   https://github.com/SEU-USUARIO/Scripts-Solar/issues
// ==/UserScript==

(function() {
    'use strict';

    function injetarBarraPesquisa() {
        // Evita duplicatas
        if (document.getElementById('solar-busca-timeline-wrapper')) return;

        // Procura o botão Linha do Tempo
        const elementos = Array.from(document.querySelectorAll('button, a, span, div'));
        const btnLinhaTempo = elementos.find(el => el.textContent.trim() === 'Linha do Tempo');

        // Confirma se achou e se está visível
        if (btnLinhaTempo && btnLinhaTempo.offsetHeight > 0) {

            // Acha o contêiner do grupo de botões para não quebrar o layout nativo
            const btnGroup = btnLinhaTempo.closest('.btn-group') || btnLinhaTempo.parentNode;

            // Cria um invólucro (wrapper) para garantir o alinhamento horizontal
            const wrapper = document.createElement('div');
            wrapper.id = 'solar-busca-timeline-wrapper';

            // 👇 MUDANÇA AQUI: Adicionado margin-top para alinhar com o botão
            wrapper.style.cssText = `
                display: inline-flex;
                align-items: center;
                margin-left: 10px;
                margin-top: 2px; /* Aumente para 8px se precisar descer mais, ou diminua para 4px para subir */
                vertical-align: middle;
            `;

            // Cria o campo
            const inputPesquisa = document.createElement('input');
            inputPesquisa.id = 'solar-busca-timeline';
            inputPesquisa.type = 'text';
            inputPesquisa.placeholder = '🔍 Buscar ID, Evento ou documento...';
            inputPesquisa.autocomplete = 'off';

            inputPesquisa.style.cssText = `
                padding: 6px 14px;
                border: 1px solid #ccc;
                border-radius: 20px;
                font-size: 13px;
                width: 260px;
                outline: none;
                box-shadow: inset 0 1px 2px rgba(0,0,0,0.05);
                color: #333;
                background: #fff;
                transition: all 0.3s ease;
            `;

            inputPesquisa.addEventListener('focus', () => {
                inputPesquisa.style.borderColor = '#e4801c';
                inputPesquisa.style.boxShadow = '0 0 0 3px rgba(228, 128, 28, 0.2)';
            });
            inputPesquisa.addEventListener('blur', () => {
                inputPesquisa.style.borderColor = '#ccc';
                inputPesquisa.style.boxShadow = 'inset 0 1px 2px rgba(0,0,0,0.05)';
            });

            // Lógica de filtragem aprimorada
            inputPesquisa.addEventListener('input', (e) => {
                const termo = e.target.value.toLowerCase().trim();
                const cartoesEvento = document.querySelectorAll('.media-body');

                cartoesEvento.forEach(cartao => {
                    const textoCartao = cartao.textContent.toLowerCase();

                    // Sobe na árvore do HTML até achar o "pai supremo" do evento
                    let curr = cartao;
                    let highestNgRepeat = null;

                    while (curr && curr !== document.body) {
                        if (curr.hasAttribute('ng-repeat')) {
                            highestNgRepeat = curr; // Guarda o loop mais alto da árvore
                        }
                        curr = curr.parentElement;
                    }

                    // Define a caixa que vai sumir (Angular-wrapper ou fallback)
                    const containerPai = highestNgRepeat || cartao.closest('li') || cartao.parentElement.parentElement;

                    if (textoCartao.includes(termo)) {
                        containerPai.style.display = '';
                    } else {
                        containerPai.style.display = 'none';
                    }
                });
            });

            // Monta a estrutura
            wrapper.appendChild(inputPesquisa);
            btnGroup.insertAdjacentElement('afterend', wrapper);

            // Força o contêiner geral a manter tudo na mesma linha com Flexbox
            if (btnGroup.parentElement) {
                btnGroup.parentElement.style.display = 'flex';
                btnGroup.parentElement.style.alignItems = 'flex-start'; // Garante que o alinhamento base seja o topo original
                btnGroup.parentElement.style.flexWrap = 'wrap';
            }
        }
    }

    const observer = new MutationObserver(() => {
        injetarBarraPesquisa();
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();
