// ==UserScript==
// @name         Solar - Download Comprovante de Distribuição
// @namespace    https://solar.defensoria.mg.def.br/
// @version      1.3.0
// @description  Adiciona um botão de download do "Comprovante de Distribuição" (Recibo) direto na listagem de Peticionamentos do Solar, já renomeando o PDF para "Comprovante de Distribuição - [CNJ] (Protocolo Solar) - [data].pdf". Reaproveita a checkbox nativa da 1ª coluna (sem duplicar) para o download em lote, sempre disponível nas linhas Protocolado, com trava mútua contra a checkbox nativa de peticionamentos Aguardando (e de qualquer outra situação).
// @author       Guilherme
// @match        https://solar.defensoria.mg.def.br/processo/peticionamento/buscar/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  // ============================================================
  // CONFIGURAÇÃO
  // ============================================================
  const LOG_TAG = '[Solar Tampermonkey - ComprovanteDistribuicao]';
  const MUTATION_DEBOUNCE_MS = 250;
  const BULK_DOWNLOAD_DELAY_MS = 900; // intervalo entre downloads em lote (evita bloqueio de "múltiplos downloads" do Chrome)
  const SITUACAO_ALVO = 'protocolado'; // só processos protocolados têm Recibo disponível
  const CNJ_REGEX = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/;
  const DATA_REGEX = /(\d{2})\/(\d{2})\/(\d{4})/;
  const PET_ID_REGEX = /\/processo\/peticionamento\/(\d+)\/visualizar\/?/i;

  const BULK_BTN_LABEL_IDLE = '<i class="fas fa-download" aria-hidden="true"></i> Baixar Comprovantes em Lote';
  const bulkBtnLabelSelecting = (n) =>
    `<i class="fas fa-download" aria-hidden="true"></i> Baixar Selecionados${n > 0 ? ` (${n})` : ''}`;

  let btnLoteRef = null;

  // ============================================================
  // CSS ISOLADO (prefixo solar-util- para não colidir com o Bootstrap nativo)
  // ============================================================
  const style = document.createElement('style');
  style.textContent = `
    /* Botão verde sólido o tempo todo (sem depender de hover) e sem a
       borda fina, para ficar mais parecido com os botões nativos coloridos
       (ex.: o botão de WhatsApp que o Solar já usa em linhas Protocolado). */
    .solar-util-btn-download,
    .solar-util-btn-download:hover,
    .solar-util-btn-download:focus,
    .solar-util-btn-download:active {
      background-color: #5cb85c !important;
      background-image: none !important;
      border-color: transparent !important;
      color: #fff !important;
      text-shadow: none !important;
      box-shadow: none !important;
    }
    .solar-util-btn-download:hover,
    .solar-util-btn-download:focus {
      background-color: #4cae4c !important;
    }
    .solar-util-btn-download:active {
      background-color: #398439 !important;
    }
    .solar-util-btn-download[disabled] {
      opacity: 0.7;
      cursor: not-allowed;
    }
    .solar-util-btn-download.is-error,
    .solar-util-btn-download.is-error:hover {
      background-color: #d9534f !important;
    }

    /* Checkbox NATIVA do Solar, "adotada" (sem duplicar) nas linhas
       Protocolado: fica sempre disponível (sem precisar clicar em nenhum
       botão antes), sem nenhum estilo extra (mesma aparência nativa do
       Solar). Quando travada pela regra de exclusividade, fica cinza
       (disabled nativo) mas continua visível no lugar. */
    .solar-util-select-recibo {
      cursor: pointer;
    }
    .solar-util-select-recibo:disabled {
      cursor: not-allowed;
    }

    /* Linha inteira fica verde quando selecionada para o lote */
    tr.solar-verde > td {
      background-color: #e8f5e9 !important;
      border-bottom: 1px solid #c8e6c9 !important;
    }

    #solar-util-bulk-btn {
      margin-left: 6px;
    }

    #solar-util-toast-container {
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: 360px;
    }
    .solar-util-toast {
      background: #333;
      color: #fff;
      padding: 10px 14px;
      border-radius: 4px;
      font-size: 13px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    .solar-util-toast.is-visible {
      opacity: 1;
      transform: translateY(0);
    }
    .solar-util-toast.is-success { background: #4cae4c; }
    .solar-util-toast.is-error { background: #d9534f; }
  `;
  document.head.appendChild(style);

  // ============================================================
  // TOAST (feedback não-bloqueante; nunca usar alert()/confirm())
  // ============================================================
  function getToastContainer() {
    let el = document.getElementById('solar-util-toast-container');
    if (!el) {
      el = document.createElement('div');
      el.id = 'solar-util-toast-container';
      document.body.appendChild(el);
    }
    return el;
  }

  function toast(message, type = 'info', durationMs = 4000) {
    const container = getToastContainer();
    const el = document.createElement('div');
    el.className = `solar-util-toast is-${type}`;
    el.textContent = message;
    container.appendChild(el);
    // força reflow para a transição funcionar
    requestAnimationFrame(() => el.classList.add('is-visible'));
    setTimeout(() => {
      el.classList.remove('is-visible');
      setTimeout(() => el.remove(), 250);
    }, durationMs);
  }

  // ============================================================
  // UTILITÁRIOS
  // ============================================================
  function sanitizeFilename(name) {
    // Remove caracteres inválidos em nomes de arquivo (Windows/macOS/Linux)
    return name.replace(/[\\/:*?"<>|]/g, '-').trim();
  }

  function extrairSituacao(tr) {
    // Não confiamos em classes de apresentação (label-success etc.) porque
    // podem mudar; usamos o texto visível do badge de situação.
    const labels = tr.querySelectorAll('td span.label, td span');
    for (const el of labels) {
      const txt = (el.textContent || '').trim().toLowerCase();
      if (txt === 'protocolado' || txt === 'aguardando' || txt === 'na fila' ||
          txt === 'em análise' || txt === 'falha do protocolo' || txt === 'pronto para protocolo') {
        return txt;
      }
    }
    return null;
  }

  function extrairAbrirLink(tr) {
    // Busca robusta: primeiro pelo grupo de ações nomeado, com fallback
    // para qualquer link cujo href bata com o padrão de URL de visualização.
    const grupo = tr.querySelector('.btn-group[name="Abrir"]');
    if (grupo) {
      const link = grupo.querySelector('a[href*="/processo/peticionamento/"]');
      if (link?.getAttribute('href')) return link;
    }
    // Fallback: percorre todos os <a> da linha
    const todosLinks = tr.querySelectorAll('a[href*="/processo/peticionamento/"]');
    for (const a of todosLinks) {
      if (PET_ID_REGEX.test(a.getAttribute('href') || '')) return a;
    }
    return null;
  }

  function extrairPetId(tr) {
    const link = extrairAbrirLink(tr);
    if (!link) return null;
    const href = link.getAttribute('href') || '';
    const m = href.match(PET_ID_REGEX);
    return m ? m[1] : null;
  }

  function extrairCnj(tr) {
    // Tenta achar o número CNJ dentro do <b> do link do processo (mais preciso).
    const bold = tr.querySelector('td b');
    if (bold && CNJ_REGEX.test(bold.textContent || '')) {
      return bold.textContent.match(CNJ_REGEX)[0];
    }
    // Fallback: regex sobre o texto inteiro da linha.
    const full = tr.textContent || '';
    const m = full.match(CNJ_REGEX);
    return m ? m[0] : null;
  }

  // Monta um mapa {texto do cabeçalho em minúsculas -> índice da coluna}
  // percorrendo o <thead>. Evita depender de posições fixas de coluna
  // (DOM volátil), permitindo achar "Data Resposta"/"Data Registro" mesmo
  // que a ordem das colunas mude.
  function construirMapaColunas(root) {
    const headerRow = root.querySelector('table thead tr');
    const mapa = {};
    if (!headerRow) return mapa;
    Array.from(headerRow.children).forEach((cell, idx) => {
      const texto = (cell.textContent || '').trim().toLowerCase();
      if (texto) mapa[texto] = idx;
    });
    return mapa;
  }

  function extrairData(tr, colMap) {
    const cells = Array.from(tr.children);
    const porIndice = (idx) => {
      if (idx === undefined || !cells[idx]) return '';
      const txt = (cells[idx].textContent || '').trim();
      const m = txt.match(DATA_REGEX);
      return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
    };
    let data = porIndice(colMap['data resposta']) || porIndice(colMap['data registro']);
    if (!data) {
      // Fallback: pega a última data dd/mm/aaaa encontrada na linha inteira
      // (heurística: "Data Resposta" normalmente aparece depois de "Data
      // Registro" na ordem visual/textual da linha).
      const matches = [...(tr.textContent || '').matchAll(new RegExp(DATA_REGEX, 'g'))];
      if (matches.length) {
        const ultimo = matches[matches.length - 1];
        data = `${ultimo[1]}-${ultimo[2]}-${ultimo[3]}`;
      }
    }
    return data;
  }

  // Extrai o base64 do PDF do Recibo a partir do HTML da página de detalhe.
  // Estratégia primária: parseia o HTML como DOM de verdade e navega pela
  // árvore (mais resiliente a mudanças de atributos/formatação do que regex).
  // Estratégia de fallback: regex sobre o HTML bruto, para o caso do parser
  // falhar por algum motivo inesperado.
  function extrairReciboBase64(doc, htmlBruto) {
    try {
      const h4s = Array.from(doc.querySelectorAll('h4'));
      const reciboH4 = h4s.find((h) => (h.textContent || '').trim().toLowerCase() === 'recibo');
      let obj = null;
      if (reciboH4) {
        let el = reciboH4.nextElementSibling;
        let tentativas = 0;
        while (el && tentativas < 5 && !obj) {
          if (el.tagName === 'OBJECT') obj = el;
          el = el.nextElementSibling;
          tentativas++;
        }
      }
      if (!obj) {
        obj = doc.querySelector('object[type="application/pdf"]');
      }
      const data = obj ? obj.getAttribute('data') : null;
      const prefixo = 'data:application/pdf;base64,';
      if (data && data.startsWith(prefixo)) {
        return data.slice(prefixo.length);
      }
    } catch (err) {
      console.warn(`${LOG_TAG} [ExtrairRecibo]`, 'Falha na extração via DOM, tentando regex.', err);
    }

    // Fallback por regex sobre o HTML bruto
    const html = htmlBruto || '';
    let m = html.match(/<h4>\s*Recibo\s*<\/h4>\s*<object[^>]*data=["']data:application\/pdf;base64,([A-Za-z0-9+/=]+)["']/i);
    if (m) return m[1];
    const idx = html.indexOf('>Recibo<');
    if (idx !== -1) {
      const janela = html.slice(idx, idx + 4000);
      m = janela.match(/data:application\/pdf;base64,([A-Za-z0-9+/=]+)["']/i);
      if (m) return m[1];
    }
    return null;
  }

  function base64ParaBlob(base64) {
    const byteChars = atob(base64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteNumbers[i] = byteChars.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: 'application/pdf' });
  }

  function dispararDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Libera o object URL um pouco depois, dando tempo ao navegador de iniciar o download.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function montarNomeArquivo(cnj, petId, dataStr) {
    const numero = cnj || `SOLAR-${petId}`;
    let nome = `Comprovante de Distribuição - ${numero}`;
    if (dataStr) nome += ` - (${dataStr})`;
    return sanitizeFilename(nome) + '.pdf';
  }

  // ============================================================
  // DOWNLOAD DE UM RECIBO (usado tanto no botão individual quanto no lote)
  // ============================================================
  async function baixarRecibo(petId, cnj, dataStr) {
    const url = `/processo/peticionamento/${petId}/visualizar/`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ao abrir ${url}`);
    }
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const base64 = extrairReciboBase64(doc, html);
    if (!base64) {
      throw new Error('Recibo (Comprovante de Distribuição) não encontrado na página do peticionamento.');
    }

    const blob = base64ParaBlob(base64);
    const filename = montarNomeArquivo(cnj, petId, dataStr);
    dispararDownload(blob, filename);
    return filename;
  }

  // ============================================================
  // BOTÃO INDIVIDUAL POR LINHA
  // ============================================================
  function setBotaoEstado(btn, estado) {
    const icon = btn.querySelector('i');
    btn.classList.remove('is-error');
    switch (estado) {
      case 'loading':
        btn.disabled = true;
        icon.className = 'fas fa-spinner fa-spin';
        break;
      case 'success':
        btn.disabled = false;
        icon.className = 'fas fa-check';
        setTimeout(() => { icon.className = 'fas fa-download'; }, 2000);
        break;
      case 'error':
        btn.disabled = false;
        btn.classList.add('is-error');
        icon.className = 'fas fa-exclamation-triangle';
        setTimeout(() => {
          icon.className = 'fas fa-download';
          btn.classList.remove('is-error');
        }, 4000);
        break;
      default:
        btn.disabled = false;
        icon.className = 'fas fa-download';
    }
  }

  function criarBotaoDownload(petId, cnj, dataStr) {
    const btn = document.createElement('a');
    btn.href = 'javascript:void(0)';
    btn.className = 'btn btn-small solar-util-btn-download';
    btn.title = 'Baixar Comprovante de Distribuição';
    btn.setAttribute('rel', 'tooltip');
    btn.setAttribute('data-original-title', 'Baixar Comprovante de Distribuição');
    btn.innerHTML = '<i class="fas fa-download" aria-hidden="true"></i>';

    btn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      setBotaoEstado(btn, 'loading');
      try {
        const filename = await baixarRecibo(petId, cnj, dataStr);
        setBotaoEstado(btn, 'success');
        toast(`Baixado: ${filename}`, 'success');
      } catch (err) {
        console.warn(`${LOG_TAG} [BotaoIndividual]`, err);
        setBotaoEstado(btn, 'error');
        toast(`Falha ao baixar comprovante do processo ${cnj || petId}: ${err.message}`, 'error', 6000);
      }
    });

    return btn;
  }

  // ============================================================
  // CHECKBOX NATIVA DO SOLAR (reaproveitada, só nas linhas Protocolado)
  // ============================================================
  // O Solar já renderiza uma checkbox na 1ª coluna de cada linha, usada
  // pelo botão nativo "Protocolar Manifestações Selecionadas". Nas linhas
  // desabilitadas por padrão, ela vem SEM atributo "name" - ou seja, mesmo
  // que fosse reabilitada, o <form> nativo não a enviaria (campos sem
  // "name" não são serializados em submissões HTML).
  //
  // Reaproveitamos essa mesma checkbox (sem criar nenhuma nova/duplicada)
  // nas linhas "Protocolado", já habilitada por padrão (sem precisar clicar
  // em nenhum botão antes), com três camadas de proteção contra qualquer
  // interferência no fluxo nativo de protocolar em massa:
  //   1) Removemos qualquer "name" (o form nativo ignora campos sem nome);
  //   2) Atribuímos form="solar-util-no-form" (um id de formulário que não
  //      existe), desvinculando-a explicitamente de qualquer <form> da
  //      página via o atributo padrão "form" do HTML;
  //   3) Trava mútua em tempo real (ver aoMudarQualquerCheckbox /
  //      atualizarTravaSobre*): marcar uma checkbox nativa de "Aguardando"
  //      (ou de qualquer outra situação) desabilita todas as de
  //      "Protocolado", e vice-versa - elas continuam visíveis, só ficam
  //      acinzentadas (disabled nativo), nunca somem da tela.
  function configurarCheckboxNativa(tr, petId, cnj, dataStr) {
    const primeiraCelula = tr.querySelector('td');
    const cb = primeiraCelula ? primeiraCelula.querySelector('input[type="checkbox"]') : null;
    if (!cb) {
      console.warn(`${LOG_TAG} [ConfigurarCheckbox]`, `Checkbox nativa não encontrada para o peticionamento #${petId}; download em lote indisponível para esta linha.`);
      return;
    }

    cb.removeAttribute('name');
    cb.setAttribute('form', 'solar-util-no-form');
    cb.classList.add('solar-util-select-recibo');
    cb.disabled = false; // disponível desde já; a trava pode desabilitar depois, conforme o contexto
    cb.title = 'Selecionar para download em lote do Comprovante de Distribuição';
    cb.dataset.petId = petId;
    cb.dataset.cnj = cnj || '';
    cb.dataset.data = dataStr || '';

    // Aplica o estado de trava vigente (ex.: tabela recarregada via AJAX
    // enquanto já havia uma checkbox nativa de outra situação marcada).
    if (algumCheckboxNativoSelecionado()) {
      cb.dataset.solarUtilTravadoPor = 'nativo';
      cb.disabled = true;
    }
  }

  // ============================================================
  // TRAVA MÚTUA: checkbox nativa de "Protocolado" (nossa) x checkbox
  // nativa de "Aguardando" (ou qualquer outra situação, por segurança)
  // ============================================================
  function algumComprovanteSelecionado() {
    return document.querySelectorAll('.solar-util-select-recibo:checked').length > 0;
  }

  function algumCheckboxNativoSelecionado() {
    const todos = document.querySelectorAll('table.display-data tbody input[type="checkbox"]:not(.solar-util-select-recibo)');
    return Array.from(todos).some((cb) => cb.checked);
  }

  function obterCheckboxSelecionarTodos() {
    return document.querySelector('table.display-data thead input[type="checkbox"]');
  }

  // Marcar um comprovante ("Protocolado") desabilita (cinza, mas visível)
  // toda checkbox nativa de outra situação - inclusive o "Selecionar todas"
  // do cabeçalho, que não distingue nossas checkboxes das nativas.
  function atualizarTravaSobreNativos() {
    const travar = algumComprovanteSelecionado();
    const nativos = document.querySelectorAll('table.display-data tbody input[type="checkbox"]:not(.solar-util-select-recibo)');
    nativos.forEach((cb) => {
      if (travar) {
        if (!cb.disabled) {
          cb.dataset.solarUtilTravadoPor = 'comprovante';
          cb.disabled = true;
        }
      } else if (cb.dataset.solarUtilTravadoPor === 'comprovante') {
        cb.disabled = false;
        delete cb.dataset.solarUtilTravadoPor;
      }
    });

    const selTodos = obterCheckboxSelecionarTodos();
    if (selTodos) {
      if (travar) {
        if (!selTodos.disabled) {
          selTodos.dataset.solarUtilTravadoPor = 'comprovante';
          selTodos.disabled = true;
          selTodos.title = 'Desmarque os comprovantes selecionados para usar "Selecionar todas".';
        }
      } else if (selTodos.dataset.solarUtilTravadoPor === 'comprovante') {
        selTodos.disabled = false;
        selTodos.removeAttribute('title');
        delete selTodos.dataset.solarUtilTravadoPor;
      }
    }
  }

  // Marcar uma checkbox nativa de "Aguardando" (ou outra situação)
  // desabilita (cinza, mas visível) toda checkbox de comprovante "Protocolado".
  function atualizarTravaSobreComprovantes() {
    const travar = algumCheckboxNativoSelecionado();
    document.querySelectorAll('.solar-util-select-recibo').forEach((cb) => {
      if (travar) {
        if (!cb.disabled) {
          cb.dataset.solarUtilTravadoPor = 'nativo';
          cb.disabled = true;
        }
      } else if (cb.dataset.solarUtilTravadoPor === 'nativo') {
        cb.disabled = false;
        delete cb.dataset.solarUtilTravadoPor;
      }
    });
  }

  // Rede de segurança: se, por qualquer caminho que não passe pelo nosso
  // listener de 'change' (ex.: o "Selecionar todas" nativo marcando várias
  // linhas de uma vez via JS interno do Solar, sem disparar 'change' em
  // cada checkbox), um comprovante e uma checkbox nativa de outra situação
  // acabarem marcados ao mesmo tempo, desmarcamos os comprovantes por
  // segurança (prioriza não interferir na ação nativa do Solar).
  function garantirExclusividade() {
    const comprovantesMarcados = Array.from(document.querySelectorAll('.solar-util-select-recibo:checked'));
    if (comprovantesMarcados.length === 0) return;
    if (!algumCheckboxNativoSelecionado()) return;

    comprovantesMarcados.forEach((cb) => {
      cb.checked = false;
      cb.closest('tr')?.classList.remove('solar-verde');
    });
    atualizarContadorBotaoLote();
    atualizarTravaSobreComprovantes();
    toast('Uma seleção nativa do Solar foi detectada junto com comprovantes marcados; os comprovantes foram desmarcados por segurança.', 'error', 6000);
  }

  function aoMudarQualquerCheckbox(ev) {
    const cb = ev.target;
    if (!(cb instanceof HTMLInputElement) || cb.type !== 'checkbox') return;

    if (cb.classList.contains('solar-util-select-recibo')) {
      const tr = cb.closest('tr');
      tr?.classList.toggle('solar-verde', cb.checked);
      atualizarContadorBotaoLote();
      atualizarTravaSobreNativos();
    } else {
      atualizarTravaSobreComprovantes();
    }
    garantirExclusividade();
  }

  // ============================================================
  // PROCESSAMENTO DE LINHAS (injeta botão + adota checkbox, uma vez por linha)
  // ============================================================
  function processarLinha(tr, colMap) {
    if (!tr || tr.dataset.solarUtilProcessed === '1') return;
    if (!(tr instanceof HTMLElement) || tr.tagName !== 'TR') return;

    const situacao = extrairSituacao(tr);
    if (situacao !== SITUACAO_ALVO) return; // só linhas "Protocolado" têm Recibo

    const petId = extrairPetId(tr);
    if (!petId) {
      console.warn(`${LOG_TAG} [ProcessarLinha]`, 'Não foi possível extrair o ID do peticionamento da linha', tr);
      return;
    }

    const abrirLink = extrairAbrirLink(tr);
    const grupo = abrirLink ? abrirLink.closest('.btn-group') : null;
    if (!abrirLink || !grupo) {
      console.warn(`${LOG_TAG} [ProcessarLinha]`, `Botão "Abrir" não encontrado para o peticionamento #${petId}; botão de download não injetado.`);
      return;
    }

    const cnj = extrairCnj(tr);
    if (!cnj) {
      console.warn(`${LOG_TAG} [ProcessarLinha]`, `Número CNJ não encontrado para o peticionamento #${petId}; será usado o número interno do Solar no nome do arquivo.`);
    }
    const dataStr = extrairData(tr, colMap || {});

    // Botão de download à ESQUERDA do "Abrir" (mesma estilística dos demais botões)
    const btnDownload = criarBotaoDownload(petId, cnj, dataStr);
    grupo.insertBefore(btnDownload, abrirLink);

    // Adota (sem duplicar) a checkbox nativa da 1ª coluna da linha para o lote
    configurarCheckboxNativa(tr, petId, cnj, dataStr);

    tr.dataset.solarUtilProcessed = '1';
  }

  function processarTabela(root) {
    const colMap = construirMapaColunas(root);
    const linhas = root.querySelectorAll('tbody tr');
    linhas.forEach((tr) => processarLinha(tr, colMap));
  }

  // ============================================================
  // BOTÃO "BAIXAR COMPROVANTES EM LOTE" (ação direta - sem etapa de revelar)
  // ============================================================
  function atualizarContadorBotaoLote() {
    if (!btnLoteRef) return;
    const n = document.querySelectorAll('.solar-util-select-recibo:checked').length;
    btnLoteRef.innerHTML = n > 0 ? bulkBtnLabelSelecting(n) : BULK_BTN_LABEL_IDLE;
  }

  async function executarDownloadEmLote(btnLote) {
    const checkboxes = Array.from(document.querySelectorAll('.solar-util-select-recibo:checked'));
    if (checkboxes.length === 0) {
      toast('Marque ao menos um comprovante (checkbox das linhas Protocolado) antes de baixar em lote.', 'error');
      return;
    }

    btnLote.disabled = true;
    let sucesso = 0;
    let falha = 0;

    for (let i = 0; i < checkboxes.length; i++) {
      const cb = checkboxes[i];
      btnLote.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Baixando ${i + 1}/${checkboxes.length}...`;
      try {
        await baixarRecibo(cb.dataset.petId, cb.dataset.cnj, cb.dataset.data);
        cb.checked = false;
        cb.closest('tr')?.classList.remove('solar-verde');
        sucesso++;
      } catch (err) {
        console.warn(`${LOG_TAG} [DownloadEmLote]`, `Peticionamento #${cb.dataset.petId}`, err);
        falha++;
        // mantém marcado para o usuário identificar quais falharam
      }
      // Pequeno intervalo entre downloads para reduzir a chance do Chrome
      // bloquear downloads automáticos múltiplos.
      if (i < checkboxes.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, BULK_DOWNLOAD_DELAY_MS));
      }
    }

    btnLote.disabled = false;
    atualizarTravaSobreNativos(); // libera nativos travados pelas marcações que acabaram de ser desfeitas
    atualizarContadorBotaoLote();

    if (falha === 0) {
      toast(`${sucesso} comprovante(s) baixado(s) com sucesso.`, 'success');
    } else {
      toast(`${sucesso} baixado(s), ${falha} falharam e continuam marcados para nova tentativa. Veja o console para detalhes.`, 'error', 6000);
    }
  }

  function injetarBotaoLote() {
    if (document.getElementById('solar-util-bulk-btn')) return;

    // Mesmo container de "Associações" / "Protocolar" / "Etiquetas"
    const btnProtocolar = document.getElementById('btn_protocolar_em_massa');
    let container = btnProtocolar ? btnProtocolar.parentElement : null;

    // Fallback: se o botão nativo não existir (layout mudou), tenta achar
    // o título da página para não deixar o recurso inacessível.
    if (!container) {
      container = document.querySelector('.page-title .pull-right') || document.querySelector('.page-title');
    }
    if (!container) {
      console.warn(`${LOG_TAG} [InjetarBotaoLote]`, 'Container de botões do título da página não encontrado; botão de lote não injetado.');
      return;
    }

    const btnLote = document.createElement('button');
    btnLote.id = 'solar-util-bulk-btn';
    btnLote.type = 'button';
    btnLote.className = 'btn solar-util-btn-download';
    btnLote.innerHTML = BULK_BTN_LABEL_IDLE;
    btnLote.addEventListener('click', () => executarDownloadEmLote(btnLote));

    container.appendChild(btnLote);
    btnLoteRef = btnLote;
  }

  // ============================================================
  // OBSERVER ESCOPADO + DEBOUNCE (a tabela é recarregada via AJAX ao filtrar)
  // ============================================================
  let debounceHandle = null;
  function onMutacoes() {
    if (debounceHandle) clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => {
      const form = document.getElementById('EnviarManifestacoesForm');
      if (form) {
        processarTabela(form);
      }
      injetarBotaoLote();
    }, MUTATION_DEBOUNCE_MS);
  }

  function iniciar() {
    const form = document.getElementById('EnviarManifestacoesForm');
    if (!form) {
      // A tabela ainda não carregou (AJAX); tenta novamente em breve.
      setTimeout(iniciar, 500);
      return;
    }

    processarTabela(form);
    injetarBotaoLote();

    // Event delegation: um único listener de 'change' no form cobre todas
    // as checkboxes (nossas e nativas), inclusive as que ainda vão aparecer
    // depois de um novo carregamento da tabela.
    form.addEventListener('change', aoMudarQualquerCheckbox);

    // Observa só o container da tabela/form, nunca document.body inteiro.
    const observer = new MutationObserver(onMutacoes);
    observer.observe(form, { childList: true, subtree: true });

    console.log(`${LOG_TAG} inicializado.`);
  }

  iniciar();
})();
