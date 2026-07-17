/**
 * Menooo — widget de encomendas e de reservas para o site do restaurante.
 * O dono cola no site dele:
 *   <script src="https://menooo.com/embed.js" data-slug="a-minha-loja" defer></script>
 * Cria um botão flutuante "Ver Menu & Encomendar" que abre a loja num popup.
 *
 * Reservas: o mesmo script com data-reservas="1" abre /<slug>/reservar e o botão
 * passa a "Reservar Mesa". SEM o atributo o comportamento é o de sempre.
 *
 * Os DOIS podem coexistir na mesma página (o caso normal: encomendas + reservas):
 *   <script src=".../embed.js" data-slug="a-minha-loja" defer></script>
 *   <script src=".../embed.js" data-slug="a-minha-loja" data-reservas="1" defer></script>
 * Para isso cada instância tem o seu namespace (window.MenoooWidget.order /
 * .reservas), o seu gatilho (data-menooo-order / data-menooo-reservar) e os botões
 * flutuantes empilham-se em vez de ficarem um por cima do outro.
 *
 * Opções: data-label (texto), data-color (cor do botão), data-position
 * ("right" | "left"), data-button="hidden" (esconde o botão flutuante).
 * Sem dependências; isolado do CSS do site.
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var slug = script.getAttribute('data-slug');
  if (!slug) {
    // eslint-disable-next-line no-console
    console.error('[Menooo] Falta o atributo data-slug no <script>.');
    return;
  }

  var base = 'https://menooo.com';
  try {
    base = new URL(script.src).origin;
  } catch (e) {
    /* usa o valor por omissão */
  }

  // ----- modo -----
  // Presença do atributo = reservas (data-reservas, data-reservas="1", "true"…);
  // ausência = encomendas, o comportamento histórico. Só um "0"/"false" explícito
  // desliga, para que data-reservas="0" gerado por um template não surpreenda.
  var reservasAttr = script.getAttribute('data-reservas');
  var isReservas =
    reservasAttr !== null &&
    ['0', 'false', 'no', 'off'].indexOf(reservasAttr.toLowerCase()) === -1;

  var mode = isReservas ? 'reservas' : 'order';
  var conf = isReservas
    ? {
        label: 'Reservar Mesa',
        title: 'Reservar mesa',
        url: base + '/' + encodeURIComponent(slug) + '/reservar',
        trigger: '[data-menooo-reservar], a[href="#menooo-reservar"]',
      }
    : {
        label: 'Ver Menu & Encomendar',
        title: 'Encomendar',
        url: base + '/' + encodeURIComponent(slug),
        trigger: '[data-menooo-order], a[href="#menooo-order"]',
      };

  var label = script.getAttribute('data-label') || conf.label;
  var color = script.getAttribute('data-color') || '#E05A1E';
  var side = script.getAttribute('data-position') === 'left' ? 'left' : 'right';
  var storeUrl = conf.url;
  var Z = 2147483000;

  // ----- registo partilhado entre instâncias -----
  // Todas as instâncias do embed.js na página partilham este objeto: é dele que
  // sai o empilhamento dos botões e o contador do bloqueio de scroll (senão a
  // primeira instância a fechar desbloqueava o scroll por baixo do popup da outra).
  var W = (window.MenoooWidget = window.MenoooWidget || {});
  if (typeof W.__n !== 'number') W.__n = 0; // total de botões flutuantes montados
  if (!W.__stack) W.__stack = { left: 0, right: 0 }; // por lado: só empilha quem colide
  if (typeof W.__open !== 'number') W.__open = 0; // popups abertos agora

  // data-button="hidden" (ou none/false/off) => não mostra o botão flutuante;
  // o dono usa o SEU botão com data-menooo-order (ex.: "Peça aqui").
  var showFloat =
    ['hidden', 'none', 'false', 'off'].indexOf(
      (script.getAttribute('data-button') || '').toLowerCase(),
    ) === -1;

  // ----- botão flutuante -----
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.setAttribute('aria-label', label);
  css(btn, {
    position: 'fixed',
    zIndex: Z,
    background: color,
    color: '#fff',
    border: 'none',
    borderRadius: '999px',
    padding: '14px 22px',
    font: '600 15px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
    cursor: 'pointer',
    boxShadow: '0 8px 24px rgba(0,0,0,.25)',
    maxWidth: 'calc(100vw - 40px)',
  });
  btn.style[side] = '20px';
  // 1.º botão do lado: 20px (idêntico ao de sempre); 2.º: 88px; etc.
  var slot = showFloat ? W.__stack[side]++ : 0;
  btn.style.bottom = 20 + slot * 68 + 'px';
  if (showFloat) W.__n++;

  var overlay = null;
  var iframe = null;
  var isOpen = false;

  function open() {
    if (overlay) {
      overlay.style.display = 'block';
      lock(true);
      return;
    }
    overlay = document.createElement('div');
    css(overlay, {
      position: 'fixed',
      inset: '0',
      zIndex: String(Z + 1),
      background: 'rgba(0,0,0,.55)',
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });

    var panel = document.createElement('div');
    css(panel, {
      position: 'absolute',
      inset: '0',
      margin: 'auto',
      width: '100%',
      maxWidth: '480px',
      height: '100%',
      background: '#FAF6F0',
      boxShadow: '0 0 40px rgba(0,0,0,.35)',
      overflow: 'hidden',
    });

    iframe = document.createElement('iframe');
    iframe.src = storeUrl;
    iframe.title = conf.title;
    iframe.setAttribute('allow', 'clipboard-write');
    css(iframe, { width: '100%', height: '100%', border: 'none', display: 'block' });

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Fechar');
    closeBtn.innerHTML = '&#10005;';
    css(closeBtn, {
      position: 'absolute',
      top: '10px',
      right: '12px',
      zIndex: String(Z + 2),
      width: '38px',
      height: '38px',
      borderRadius: '999px',
      border: 'none',
      background: 'rgba(0,0,0,.55)',
      color: '#fff',
      font: '18px system-ui',
      cursor: 'pointer',
      lineHeight: '38px',
      padding: '0',
    });
    closeBtn.addEventListener('click', close);

    panel.appendChild(iframe);
    panel.appendChild(closeBtn);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    lock(true);
  }

  function close() {
    if (overlay) overlay.style.display = 'none';
    lock(false);
  }

  /** Bloqueio de scroll por CONTADOR partilhado: abrir duas vezes seguidas não conta
   *  duas, e fechar um popup não desbloqueia o scroll se outro continuar aberto. */
  function lock(on) {
    if (on === isOpen) return;
    isOpen = on;
    W.__open = Math.max(0, W.__open + (on ? 1 : -1));
    document.documentElement.style.overflow = W.__open > 0 ? 'hidden' : '';
  }

  btn.addEventListener('click', open);
  document.addEventListener('keydown', function (e) {
    // cada instância só reage ao SEU popup: com os dois scripts na página, o Escape
    // não pode fechar o popup do vizinho que nem sequer está aberto.
    if (e.key === 'Escape' && isOpen) close();
  });

  // ----- API global + gatilho por atributo -----
  // Namespace por modo: window.MenoooWidget.order / .reservas. A primeira instância
  // de cada modo é a dona (uma 2.ª cópia colada do mesmo script não rouba o
  // namespace nem duplica o listener do gatilho => nunca dois popups empilhados).
  // .open/.close ficam como alias da PRIMEIRA instância carregada, seja de que modo
  // for — é o contrato que os sites já colados usam hoje.
  var owner = !W[mode];
  if (owner) W[mode] = { open: open, close: close };
  if (!W.open) {
    W.open = open;
    W.close = close;
  }

  if (owner) {
    document.addEventListener('click', function (e) {
      var el = e.target;
      // filtra SÓ o gatilho deste modo: data-menooo-order não abre as reservas.
      var trigger = el && el.closest ? el.closest(conf.trigger) : null;
      if (trigger) {
        e.preventDefault();
        open();
      }
    });
  }

  function mount() {
    document.body.appendChild(btn);
  }
  if (showFloat) {
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
  }

  function css(el, styles) {
    for (var k in styles) el.style[k] = styles[k];
  }
})();
