// ==UserScript==
// @name         Solar - Materializacao por Data
// @namespace    https://solar.defensoria.mg.def.br/
// @version      2.0.0
// @description  Materializa em um unico PDF apenas os documentos protocolados dentro do intervalo de datas informado.
// @author       Defensoria Publica de Minas Gerais
// @match        https://*.defensoria.mg.def.br/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/SEU-USUARIO/Scripts-Solar/main/solar-materializacao-por-data.user.js
// @downloadURL  https://raw.githubusercontent.com/SEU-USUARIO/Scripts-Solar/main/solar-materializacao-por-data.user.js
// @homepageURL  https://github.com/SEU-USUARIO/Scripts-Solar
// @supportURL   https://github.com/SEU-USUARIO/Scripts-Solar/issues
// ==/UserScript==

(() => {
    'use strict';

    // =========================================================================
    // 1. ISOLAMENTO DE CSS (Interface Discreta e Nativa)
    // =========================================================================
    GM_addStyle(`
        .solar-util-container {
            display: inline-flex; align-items: center; gap: 10px;
            margin-left: 15px; padding: 5px 10px;
            background-color: #f8f9fa; border: 1px solid #ddd; border-radius: 4px;
        }
        .solar-util-input {
            border: 1px solid #ccc; border-radius: 3px; padding: 2px 5px; font-size: 12px;
            color: #333 !important; background: #fff !important; height: auto !important;
        }
        .solar-util-btn {
            background-color: #0056b3; color: white; border: none; transition: 0.2s;
            padding: 4px 10px; border-radius: 3px; cursor: pointer; font-size: 12px; font-weight: bold;
        }
        .solar-util-btn:hover { background-color: #0bc210; }
        .solar-util-btn:disabled { background-color: ##0bc210; cursor: not-allowed; }
        .solar-util-status { font-size: 12px; color: #0056b3; font-weight: bold; display: none; }
    `);

    // =========================================================================
    // 2. UTILITÁRIOS E CABEÇALHOS DE SEGURANÇA
    // =========================================================================
    const strToDateObj = (isoStr, isEndOfDay = false) => {
        if (!isoStr) return null;
        const [y, m, d] = isoStr.split('-');
        if (isEndOfDay) return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), 23, 59, 59);
        return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), 0, 0, 0);
    };

    // Monta os cabeçalhos para o servidor do Tribunal reconhecer como requisição oficial
    const getFetchHeaders = () => {
        const headers = { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/plain, */*' };
        const csrfMatch = document.cookie.match(/csrftoken=([^;]+)/);
        if (csrfMatch) headers['X-CSRFToken'] = csrfMatch[1];
        return headers;
    };

    // =========================================================================
    // 3. O MOTOR DE REQUISIÇÕES CUSTOMIZADO (Custom Fetch API)
    // =========================================================================
    const realizarMaterializacao = async (startStr, endStr) => {
        const startDate = strToDateObj(startStr, false);
        const endDate = strToDateObj(endStr, true);
        const statusEl = document.getElementById('solar-util-status');

        // Captura a identificação do processo usando o AngularJS da tela
        const btnOriginal = document.querySelector('#botaoDocumentoUnificado');
        if (!btnOriginal) return alert("Botão original de materialização não encontrado.");

        const procIdMatch = btnOriginal.getAttribute('ng-click').match(/\d+/);
        if (!procIdMatch) return alert("Falha ao extrair ID numérico do processo.");
        const procId = procIdMatch[0];

        const angularScope = unsafeWindow.angular.element(btnOriginal).scope();
        if (!angularScope?.eproc?.processo?.eventos) return alert("Árvore de eventos do Angular inacessível.");

        // FILTRO CIRÚRGICO: Comparamos as datas diretamente pelo protocolo do servidor
        const eventosFiltrados = angularScope.eproc.processo.eventos.filter(ev => {
            if (!ev.data_protocolo) return false;
            const evDate = new Date(ev.data_protocolo);
            return evDate >= startDate && evDate <= endDate;
        });

        // Contabiliza apenas os documentos que existem nos eventos válidos
        let totalDocs = 0;
        eventosFiltrados.forEach(ev => totalDocs += (ev.documentos ? ev.documentos.length : 0));

        if (totalDocs === 0) {
            alert('[Solar] Nenhum documento atrelado encontrado para esta data.');
            resetUI();
            return;
        }

        // ORDENAÇÃO CRONOLÓGICA CRESCENTE: Mais antigos primeiro
        eventosFiltrados.sort((a, b) => new Date(a.data_protocolo) - new Date(b.data_protocolo));

        try {
            const fetchOpts = { headers: getFetchHeaders(), credentials: 'same-origin' };

            // REQUISIÇÃO 1: Sincronização inicial
            statusEl.textContent = 'Sincronizando...';
            await fetch(`/procapi/processo/${procId}/lista_eventos_materializacao/?forcar_atualizacao=true`, { ...fetchOpts, method: 'GET' });

            // INICIA O PACOTE DE DADOS
            const formData = new FormData();

            // A CORREÇÃO DE OURO: Adiciona o ID do Processo DENTRO do pacote, conforme o payload exigia
            formData.append('processo_numero_grau', procId);

            let currentDoc = 0;

            // REQUISIÇÃO 2: Conversão individual (Apenas dos arquivos da data)
            for (const ev of eventosFiltrados) {
                if (!ev.documentos) continue;

                for (const doc of ev.documentos) {
                    currentDoc++;
                    statusEl.textContent = `Baixando documento ${currentDoc} de ${totalDocs}...`;

                    const jsonParam = encodeURIComponent(JSON.stringify(doc));
                    const urlConversao = `/procapi/processo/${procId}/documento/${doc.documento}?converter=true&informacoes_documento=${jsonParam}`;

                    const resDoc = await fetch(urlConversao, { ...fetchOpts, method: 'GET' });

                    if (resDoc.ok) {
                        const blob = await resDoc.blob();
                        // Como os eventos foram ordenados antes, o append manterá essa exata ordem no servidor!
                        formData.append('arquivos', blob, `${doc.documento}.pdf`);
                    } else {
                        console.warn(`[Solar] Documento ignorado por erro no servidor: ${doc.documento}`);
                    }
                }
            }

            // REQUISIÇÃO 3: Unificação e Carimbo pelo Tribunal
            statusEl.textContent = 'Finalizando...';

            const urlUnificar = `/atendimento/solicitacoes-documentos-atendimento/unificar-pdf?processo_numero_grau=${procId}`;
            const resMerge = await fetch(urlUnificar, {
                method: 'POST',
                headers: fetchOpts.headers,
                credentials: 'same-origin',
                body: formData // Envia o pacote perfeitamente estruturado
            });

            if (!resMerge.ok) {
                const erroServidor = await resMerge.text();
                console.error("[Solar] Erro do Backend:", erroServidor);
                throw new Error(`Falha ${resMerge.status} na requisição de unificação.`);
            }

            // TRANSFERÊNCIA FINAL
            const finalBlob = await resMerge.blob();
            const objUrl = URL.createObjectURL(finalBlob);

            const numProc = document.body.textContent.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/)?.[0] || procId;
            const nomeFinal = `Materializacao_Parcial_${numProc.replace(/\D/g, '')}.pdf`;

            const link = document.createElement('a');
            link.href = objUrl;
            link.download = nomeFinal;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(objUrl);

            statusEl.style.color = '#28a745';
            statusEl.textContent = 'Download Concluído! ✔️';
            setTimeout(resetUI, 4000);

        } catch (error) {
            console.error("[Solar Hack]", error);
            statusEl.style.color = '#dc3545';
            statusEl.textContent = 'Erro ao materializar. Tente novamente.';
            setTimeout(resetUI, 4000);
        }
    };

    // =========================================================================
    // 4. INJEÇÃO DA INTERFACE (UI)
    // =========================================================================
    const resetUI = () => {
        const btn = document.getElementById('solar-util-trigger');
        const status = document.getElementById('solar-util-status');
        if (btn) { btn.style.display = 'inline'; btn.disabled = false; }
        if (status) { status.style.display = 'none'; status.style.color = '#0056b3'; }
    };

    const injectUI = () => {
        if (document.querySelector('#solar-util-date-filter')) return;

        const targetBtn = document.querySelector('#botaoDocumentoUnificado');
        if (!targetBtn || !targetBtn.parentNode) return;

        const container = document.createElement('div');
        container.id = 'solar-util-date-filter';
        container.className = 'solar-util-container';

        const today = new Date().toISOString().split('T')[0];

        container.innerHTML = `
            <label style="font-size: 12px; margin:0; color:#333;">Início: <input type="date" id="solar-util-start" class="solar-util-input"></label>
            <label style="font-size: 12px; margin:0; color:#333;">Fim: <input type="date" id="solar-util-end" class="solar-util-input" value="${today}"></label>
            <button id="solar-util-trigger" class="solar-util-btn">Materialização por Data</button>
            <span id="solar-util-status" class="solar-util-status">Aguardando...</span>
        `;

        targetBtn.parentNode.insertBefore(container, targetBtn.nextSibling);

        document.getElementById('solar-util-trigger').addEventListener('click', (e) => {
            e.preventDefault();
            const start = document.getElementById('solar-util-start').value;
            const end = document.getElementById('solar-util-end').value;

            if (!start || !end) return alert('Por favor, defina as datas.');

            const btn = e.target;
            const status = document.getElementById('solar-util-status');

            // Interface assume o controlo: esconde o botão e mostra o Status no lugar exato
            btn.disabled = true;
            btn.style.display = 'none';
            status.style.display = 'inline';
            status.style.color = '#0056b3';
            status.textContent = 'Iniciando extração...';

            realizarMaterializacao(start, end);
        });
    };

    // =========================================================================
    // 5. INICIALIZAÇÃO
    // =========================================================================
    const init = () => {
        const observer = new MutationObserver(() => {
            if (document.querySelector('#botaoDocumentoUnificado')) injectUI();
        });
        observer.observe(document.body, { childList: true, subtree: true });

        setTimeout(injectUI, 1000);
    };

    init();

})();
