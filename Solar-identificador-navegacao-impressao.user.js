// ==UserScript==
// @name         Solar - Identificador, Navegacao e Impressao Rapida
// @namespace    https://solar.defensoria.mg.def.br/
// @version      3.2.0
// @description  Exibe o numero do evento, permite copiar o numero, navegar entre documentos e abre o arquivo em nova aba para impressao garantida.
// @author       Defensoria Publica de Minas Gerais
// @match        https://solar.defensoria.mg.def.br/atendimento/*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/gustavobachiao/Scripts-Solar/main/Solar-identificador-navegacao-impressao.user.js
// @downloadURL  https://raw.githubusercontent.com/gustavobachiao/Scripts-Solar/main/Solar-identificador-navegacao-impressao.user.js
// @homepageURL  https://github.com/gustavobachiao/Scripts-Solar
// @supportURL   https://github.com/gustavobachiao/Scripts-Solar/issues
// ==/UserScript==

(function () {
    'use strict';

    // ─── Função de Cópia Segura ─────────────────────────────────────────────────
    function copiarTexto(texto) {
        navigator.clipboard.writeText(texto).then(function() {
            console.log('Copiado com sucesso: ' + texto);
        }).catch(function() {
            var ta = document.createElement('textarea');
            ta.value = texto;
            ta.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        });
    }

    // ─── Nova Estratégia de Impressão Garantida ─────────────────────────────────
    function dispararImpressao() {
        var embed = document.getElementById('embed');
        if (!embed) {
            alert('Documento não encontrado para impressão.');
            return;
        }

        var src = embed.getAttribute('src');
        if (!src) {
            alert('Não foi possível obter o endereço do documento.');
            return;
        }

        // Abre o PDF diretamente em uma nova aba
        var novaAba = window.open(src, '_blank');

        if (novaAba) {
            // Foca na nova aba
            novaAba.focus();

            // Injeta um pequeno script na nova aba para disparar a impressão assim que o PDF carregar
            novaAba.onload = function() {
                setTimeout(function() {
                    novaAba.print();
                }, 500); // Pequeno atraso para garantir a renderização
            };
        } else {
            // Se o navegador bloquear o pop-up, avisa o usuário de forma clara
            alert('O navegador bloqueou a abertura da impressão. Por favor, clique no ícone de "Pop-up bloqueado" na barra de endereços do seu navegador e selecione "Sempre permitir".');
        }
    }

    // ─── Função Global de Cópia ──────────────────────────────────────────────────
    window.solarCopiarEventoRapido = function(el, numero) {
        copiarTexto(numero);

        var originalHTML = el.innerHTML;
        el.innerHTML = '✅';
        el.style.color = '#28a745';

        setTimeout(function() {
            el.innerHTML = originalHTML;
            el.style.color = '#f0c040';
        }, 1200);
    };

    // ─── Estilos Visuais Unificados ──────────────────────────────────────────────
    function injetarEstilos() {
        if (document.getElementById('solar-banner-styles-unificado')) return;
        var style = document.createElement('style');
        style.id = 'solar-banner-styles-unificado';
        style.innerHTML = `
            .solar-nav-btn {
                background: rgba(255, 255, 255, 0.15);
                border: 1px solid rgba(255, 255, 255, 0.4);
                color: #ffffff;
                border-radius: 4px;
                padding: 4px 10px;
                margin-left: 4px;
                cursor: pointer;
                font-weight: bold;
                font-size: 14px;
                transition: all 0.2s ease;
                font-family: monospace;
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }
            .solar-nav-btn:hover:not(:disabled) {
                background: rgba(255, 255, 255, 0.35);
                border-color: #f0c040;
            }
            .solar-nav-btn:disabled {
                opacity: 0.3;
                cursor: not-allowed;
                border-color: rgba(255, 255, 255, 0.2);
            }
            .solar-print-btn-inside {
                background: #28a745;
                border: 1px solid #1e7e34;
                color: #ffffff;
                border-radius: 4px;
                padding: 4px 12px;
                margin-left: 12px;
                cursor: pointer;
                font-weight: bold;
                font-size: 13px;
                transition: all 0.2s ease;
                display: inline-flex;
                align-items: center;
                gap: 4px;
            }
            .solar-print-btn-inside:hover {
                background: #218838;
                border-color: #1c7430;
                transform: scale(1.03);
            }
            .solar-copy-btn {
                cursor: pointer;
                margin-left: 8px;
                color: #f0c040;
                font-size: 1.1em;
                display: inline-block;
                transition: transform 0.1s;
            }
            .solar-copy-btn:hover {
                color: #ffffff !important;
                transform: scale(1.2);
            }
        `;
        document.head.appendChild(style);
    }

    // ─── Utilitários do AngularJS ────────────────────────────────────────────────
    function getAngularScope() {
        var el = document.querySelector('[ng-controller="AudienciaCtrl"]');
        if (!el) return null;
        try {
            return angular.element(el).scope();
        } catch (e) {
            return null;
        }
    }

    function getEventos() {
        var scope = getAngularScope();
        return (scope && scope.eproc && scope.eproc.processo && scope.eproc.processo.eventos) || null;
    }

    function getTodosDocumentos() {
        var eventos = getEventos();
        var docsList = [];
        if (!eventos) return docsList;
        var eventosOrdenados = [...eventos].reverse();
        for (var i = 0; i < eventosOrdenados.length; i++) {
            var docs = eventosOrdenados[i].documentos || [];
            for (var j = 0; j < docs.length; j++) {
                docsList.push(String(docs[j].documento));
            }
        }
        return docsList;
    }

    function findEventoByDocId(docId) {
        var eventos = getEventos();
        if (!docId || !eventos) return null;
        for (var i = 0; i < eventos.length; i++) {
            var docs = eventos[i].documentos || [];
            for (var j = 0; j < docs.length; j++) {
                if (String(docs[j].documento) === String(docId)) {
                    return { numero: eventos[i].numero, descricao: eventos[i].descricao };
                }
            }
        }
        return null;
    }

    function extractDocId(src) {
        if (!src) return null;
        var match = src.match(/\/documento\/(\d+)\//);
        return match ? match[1] : null;
    }

    function navegarPara(targetDocId) {
        var embed = document.getElementById('embed');
        if (!embed || !targetDocId) return;
        var currentSrc = embed.getAttribute('src');
        if (!currentSrc) return;
        var newSrc = currentSrc.replace(/\/documento\/\d+\//, '/documento/' + targetDocId + '/');
        embed.setAttribute('src', newSrc);
    }

    // ─── Banner Único com Gerenciamento Centralizado de Cliques ──────────────────
    function criarBanner() {
        injetarEstilos();

        var banner = document.createElement('div');
        banner.id = 'evento-banner-solar';
        banner.style.cssText = [
            'background: linear-gradient(135deg, #1a4a7a 0%, #2a6099 100%)',
            'color: #ffffff',
            'padding: 9px 18px',
            'margin: 8px 15px 0 15px',
            'border-radius: 6px',
            'font-size: 13.5px',
            'font-weight: bold',
            'font-family: inherit',
            'display: none',
            'align-items: center',
            'justify-content: space-between',
            'box-shadow: 0 2px 6px rgba(0,0,0,0.28)',
            'border-left: 5px solid #f0c040',
            'letter-spacing: 0.01em',
            'user-select: none'
        ].join(';');

        banner.addEventListener('click', function(e) {
            // 1. Botões de navegação
            var btnNav = e.target.closest('.solar-nav-btn');
            if (btnNav && !btnNav.disabled) {
                var targetId = btnNav.getAttribute('data-target-id');
                if (targetId) navegarPara(targetId);
                return;
            }

            // 2. Botão de Impressão Garantida
            var btnPrint = e.target.closest('.solar-print-btn-inside');
            if (btnPrint) {
                dispararImpressao();
                return;
            }
        });

        return banner;
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function atualizarBanner(src) {
        var banner = document.getElementById('evento-banner-solar');
        if (!banner) return;

        var docId = extractDocId(src);
        var evento = findEventoByDocId(docId);

        if (evento) {
            banner.style.display = 'flex';

            var todosDocs = getTodosDocumentos();
            var currentIndex = todosDocs.indexOf(String(docId));

            var firstId = todosDocs[0] || '';
            var lastId = todosDocs[todosDocs.length - 1] || '';
            var prevId = currentIndex > 0 ? todosDocs[currentIndex - 1] : '';
            var nextId = (currentIndex !== -1 && currentIndex < todosDocs.length - 1) ? todosDocs[currentIndex + 1] : '';

            var disabledFirst = (currentIndex <= 0) ? 'disabled' : '';
            var disabledPrev = (currentIndex <= 0) ? 'disabled' : '';
            var disabledNext = (currentIndex === -1 || currentIndex >= todosDocs.length - 1) ? 'disabled' : '';
            var disabledLast = (currentIndex === -1 || currentIndex >= todosDocs.length - 1) ? 'disabled' : '';

            var infoHtml = '<div style="display:flex; align-items:center; gap:10px;">' +
                           '<span style="font-size:17px;line-height:1">📋</span>' +
                           '<span>Evento <strong>' + evento.numero + '</strong>' +
                           '<span class="solar-copy-btn" title="Copiar número do evento" onclick="window.solarCopiarEventoRapido(this, \'' + evento.numero + '\')">📄</span>' +
                           ' &mdash; ' + escapeHtml(evento.descricao) + '</span>' +
                           '</div>';

            var controlsHtml = '<div style="display:flex; align-items:center;">' +
                               '<button class="solar-nav-btn" data-target-id="' + firstId + '" title="Primeiro documento (Mais antigo)" ' + disabledFirst + '>|&larr;</button>' +
                               '<button class="solar-nav-btn" data-target-id="' + prevId + '" title="Documento anterior" ' + disabledPrev + '>&larr;</button>' +
                               '<button class="solar-nav-btn" data-target-id="' + nextId + '" title="Próximo documento" ' + disabledNext + '>&rarr;</button>' +
                               '<button class="solar-nav-btn" data-target-id="' + lastId + '" title="Último documento (Mais recente)" ' + disabledLast + '>&rarr;|</button>' +
                               '<button class="solar-print-btn-inside" title="Imprimir este documento">' +
                               '<span>🖨️</span> Imprimir' +
                               '</button>' +
                               '</div>';

            banner.innerHTML = infoHtml + controlsHtml;
        } else {
            banner.style.display = 'none';
        }
    }

    // ─── Instalação e Monitoramento do DOM ───────────────────────────────────────
    var embedObserver = null;

    function instalarNaEmbed(embed) {
        var span9 = embed.parentElement;
        if (!span9) return;

        var banner = document.getElementById('evento-banner-solar');
        if (!banner) {
            banner = criarBanner();
            span9.insertBefore(banner, embed);
        } else if (banner.parentElement !== span9) {
            span9.insertBefore(banner, embed);
        }

        atualizarBannerComRetentativa(embed, 0);

        if (embedObserver) embedObserver.disconnect();
        embedObserver = new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
                if (m.attributeName === 'src') {
                    atualizarBannerComRetentativa(embed, 0);
                }
            });
        });
        embedObserver.observe(embed, { attributes: true, attributeFilter: ['src'] });
    }

    function atualizarBannerComRetentativa(embed, tentativa) {
        var src = embed.getAttribute('src');
        var docId = extractDocId(src);
        var evento = findEventoByDocId(docId);

        if (evento || tentativa >= 20) {
            atualizarBanner(src);
        } else {
            setTimeout(function () {
                atualizarBannerComRetentativa(embed, tentativa + 1);
            }, 300);
        }
    }

    function observarDOM() {
        var rootObserver = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var nodes = mutations[i].addedNodes;
                for (var j = 0; j < nodes.length; j++) {
                    var node = nodes[j];
                    if (node.id === 'embed' && node.tagName === 'EMBED') {
                        instalarNaEmbed(node);
                        return;
                    }
                    if (node.querySelector) {
                        var found = node.querySelector('embed#embed');
                        if (found) {
                            instalarNaEmbed(found);
                            return;
                        }
                    }
                }
            }
        });
        rootObserver.observe(document.body, { childList: true, subtree: true });
    }

    function iniciar() {
        var embed = document.getElementById('embed');
        if (embed && embed.tagName === 'EMBED') {
            instalarNaEmbed(embed);
        }
        observarDOM();
    }

    function aguardarAngular() {
        var scope = getAngularScope();
        if (typeof angular !== 'undefined' && scope && scope.eproc) {
            iniciar();
        } else {
            setTimeout(aguardarAngular, 300);
        }
    }

    aguardarAngular();
})();
