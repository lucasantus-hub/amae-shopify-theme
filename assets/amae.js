/* ============================================================
   AMAE — JS v2 · Stripe checkout
   ============================================================ */
(function () {
  'use strict';

  const STRIPE_URL = 'https://buy.stripe.com/3cIdRa0qY7UmgymfFq6Na04';

  const $ = (q, el = document) => el.querySelector(q);
  const $$ = (q, el = document) => Array.from(el.querySelectorAll(q));

  /* ── State ── */
  const state = {
    marco: 'negro',
    from: '', name: '', msg: '', email: '',
    galleryUrls: Array(6).fill(null),
    videoUrl: null
  };

  /* ── Product page: gallery thumbnails ── */
  window.amaeSetImg = function (el, label) {
    $$('.amae-gallery-thumb').forEach(t => t.classList.remove('is-active'));
    el.classList.add('is-active');
    const lbl = $('#galLabel');
    if (lbl) lbl.textContent = label;
  };

  /* ── Product page: frame selector (top) ── */
  $$('.amae-frame-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      $$('.amae-frame-opt').forEach(o => o.classList.remove('is-selected'));
      opt.classList.add('is-selected');
      const lbl = $('#frameLabel');
      if (lbl) lbl.textContent = opt.dataset.name;
    });
  });

  /* ── Product page: quantity ── */
  let qty = 1;
  window.amaeQty = function (d) {
    qty = Math.max(1, qty + d);
    const el = $('#amaeQtyVal');
    if (el) el.textContent = qty;
  };

  /* ── Scroll: "Diseñar mi cuadro" and "Añadir al carrito" ── */
  function scrollToDisenar() {
    const target = $('#disenar');
    if (target) window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' });
    // Marca intención para abandono
    if (typeof window.amaeMarkIntent === 'function') window.amaeMarkIntent('browse');
  }
  const btnDisenar = $('#btnDisenar');
  if (btnDisenar) btnDisenar.addEventListener('click', scrollToDisenar);
  const btnCart = $('#btnCart');
  if (btnCart) btnCart.addEventListener('click', scrollToDisenar);

  /* ── Nav smooth scroll ── */
  $$('.amae-nav-links a, .amae-cart').forEach(a => {
    a.addEventListener('click', e => {
      const href = a.getAttribute('href');
      if (href && href.startsWith('#')) {
        const t = document.querySelector(href);
        if (t) { e.preventDefault(); window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' }); }
      }
    });
  });

  /* ── Configurator: frame picker ── */
  const frameMap = { negro: 'Marco Negro', blanco: 'Marco Blanco', madera: 'Marco Madera' };

  $$('.amae-form-frame').forEach(ff => {
    ff.addEventListener('click', () => {
      $$('.amae-form-frame').forEach(f => f.classList.remove('is-sel'));
      ff.classList.add('is-sel');
      state.marco = ff.dataset.color;
      updatePhysical();
      updateSumItem();
      markStep(1, true);
      pingNfc();
    });
  });

  function updatePhysical() {
    $$('.physical').forEach(p => {
      p.classList.toggle('is-visible', p.dataset.physical === state.marco);
    });
  }

  function updateSumItem() {
    const el = $('#sumItem');
    if (el) el.textContent = 'Amae Frame · ' + (frameMap[state.marco] || 'Marco Negro');
  }

  /* ── Step 3: sender ── */
  const fldFrom = $('#fldFrom');
  const phoneFrom = $('#phoneFrom');
  if (fldFrom) fldFrom.addEventListener('input', () => {
    state.from = fldFrom.value.trim();
    if (phoneFrom) phoneFrom.textContent = state.from ? 'De parte de · ' + state.from : 'De parte de · tú';
    markStep(3, !!state.from);
    pingNfc(); revealPhone();
  });

  /* ── Step 4: texts ── */
  const fldName = $('#fldName');
  const fldMsg = $('#fldMsg');
  const phoneTitle = $('#phoneTitle');
  const phoneMsg = $('#phoneMsg');
  const msgCount = $('#msgCount');

  if (fldName) fldName.addEventListener('input', () => {
    state.name = fldName.value.trim();
    if (phoneTitle) {
      if (state.name) { phoneTitle.textContent = 'Para ' + state.name; phoneTitle.classList.remove('is-empty'); }
      else            { phoneTitle.textContent = 'Para ti'; phoneTitle.classList.add('is-empty'); }
    }
    markStep(4, !!state.name || !!state.msg);
    pingNfc();
  });
  if (fldMsg) fldMsg.addEventListener('input', () => {
    state.msg = fldMsg.value;
    if (phoneMsg) {
      if (state.msg.trim()) { phoneMsg.textContent = state.msg; phoneMsg.classList.remove('is-empty'); }
      else                  { phoneMsg.textContent = 'Un mensaje que sólo ella leerá…'; phoneMsg.classList.add('is-empty'); }
    }
    if (msgCount) msgCount.textContent = state.msg.length + ' / 400';
    markStep(4, !!state.name || !!state.msg);
    pingNfc();
  });

  /* ── Step 5: email ── */
  const fldEmail = $('#fldEmail');
  if (fldEmail) fldEmail.addEventListener('input', () => {
    state.email = fldEmail.value.trim();
    markStep(5, state.email && /.+@.+\..+/.test(state.email));
  });

  /* ── Step state ── */
  function markStep(n, complete) {
    const step = $(`.amae-step[data-step="${n}"]`);
    if (!step) return;
    step.classList.toggle('is-complete', !!complete);
    highlightActive();
  }
  function highlightActive() {
    $$('.amae-step').forEach(s => s.classList.remove('is-active'));
    const first = $$('.amae-step').find(s => !s.classList.contains('is-complete'));
    if (first) first.classList.add('is-active');
  }

  /* ── Submit → Stripe ── */
  const submitBtn = $('#amaeSubmit');
  const visStatus = $('#visStatus');
  if (submitBtn) {
    submitBtn.addEventListener('click', () => {
      // Notifica al módulo de analytics antes de salir
      if (typeof window.amaeMarkCompleted === 'function') window.amaeMarkCompleted();
      if (typeof window.amaeTrack === 'function') {
        window.amaeTrack('checkout_initiated', {
          frame_color:  state.marco,
          product_name: 'Amae Frame',
          value:        25.90,
          currency:     'EUR'
        });
      }
      // Pequeño delay para asegurar que el evento se envía antes del redirect
      setTimeout(() => { window.location.href = STRIPE_URL; }, 150);
    });
  }

  /* ── Phone reveal + NFC ping ── */
  const phone = $('#phone');
  const nfcRing = $('#nfcRing');
  let revealed = false;
  function revealPhone() {
    if (revealed) return;
    if (state.from || state.name || state.msg) {
      if (phone) { phone.classList.add('is-visible'); revealed = true; }
    }
  }
  function pingNfc() {
    if (!nfcRing) return;
    nfcRing.classList.remove('ping');
    void nfcRing.offsetWidth;
    nfcRing.classList.add('ping');
  }

  /* ── Init ── */
  markStep(1, true); // marco ya seleccionado por defecto
  highlightActive();
  updatePhysical();
  updateSumItem();

  const clockEl = $('#phoneTime');
  if (clockEl) {
    const t = new Date();
    clockEl.textContent = t.getHours() + ':' + String(t.getMinutes()).padStart(2, '0');
  }

})();
