/**
 * Menooo — widget de encomendas para o site do restaurante.
 * O dono cola no site dele:
 *   <script src="https://menooo.com/embed.js" data-slug="a-minha-loja" defer></script>
 * Cria um botão flutuante "Ver Menu & Encomendar" que abre a loja num popup.
 * Opções: data-label (texto), data-color (cor do botão), data-position
 * ("right" | "left"). Sem dependências; isolado do CSS do site.
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

  var label = script.getAttribute('data-label') || 'Ver Menu & Encomendar';
  var color = script.getAttribute('data-color') || '#E05A1E';
  var side = script.getAttribute('data-position') === 'left' ? 'left' : 'right';
  var storeUrl = base + '/' + encodeURIComponent(slug);
  var Z = 2147483000;

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
    bottom: '20px',
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

  var overlay = null;
  var iframe = null;

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
    iframe.title = 'Encomendar';
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

  function lock(on) {
    document.documentElement.style.overflow = on ? 'hidden' : '';
  }

  btn.addEventListener('click', open);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay && overlay.style.display !== 'none') close();
  });

  // API global + gatilho por atributo: qualquer botão/link do site do dono com
  // data-menooo-order (ou href="#menooo-order") abre o popup. Também
  // window.MenoooWidget.open() / .close().
  window.MenoooWidget = window.MenoooWidget || {};
  window.MenoooWidget.open = open;
  window.MenoooWidget.close = close;
  document.addEventListener('click', function (e) {
    var el = e.target;
    var trigger =
      el && el.closest ? el.closest('[data-menooo-order], a[href="#menooo-order"]') : null;
    if (trigger) {
      e.preventDefault();
      open();
    }
  });

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
