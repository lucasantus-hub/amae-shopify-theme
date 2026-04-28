/* ============================================================
   AMAE Analytics — v2.0
   Eventos rastreados:
     · page_view (automático GA4)
     · product_viewed
     · frame_selected
     · cta_clicked  (qué botón)
     · configurator_opened
     · configurator_step_completed (pasos 1-5)
     · checkout_initiated → Stripe
     · cart_abandoned
     · scroll_depth  (25 / 50 / 75 / 90 %)
     · time_milestone (30s / 60s / 120s / 300s)
     · section_viewed (cada sección visible)
     · email_contact_clicked
   ============================================================ */
(function () {
  'use strict';

  /* ── Configuración desde theme settings (inyectadas en layout/theme.liquid) ── */
  var GA4_ID           = window.amaeGA4Id              || null;
  var DEBUG            = window.amaeGA4Debug            || false;
  var TRACK_ABANDON    = window.amaeTrackAbandonment    !== false;
  var TRACK_SCROLL     = window.amaeTrackScroll         !== false;
  var TRACK_TIME       = window.amaeTrackTime           !== false;
  var ABANDON_THRESHOLD = (window.amaeAbandonmentThreshold || 10) * 1000; // ms
  var RESPECT_CONSENT  = window.amaeRespectConsent      !== false;

  /* ── Claves de sessionStorage / localStorage ── */
  var KEY_INTENT       = 'amae_cart_intent';      // intención de compra en esta sesión
  var KEY_INTENT_TIME  = 'amae_intent_ts';         // timestamp del momento de intención
  var KEY_FRAME        = 'amae_selected_frame';    // marco elegido
  var KEY_STEPS        = 'amae_steps_done';        // pasos del configurador completados
  var KEY_LAST_VISIT   = 'amae_last_visit';        // para detectar visitas de retorno

  /* ── Helpers ── */
  function log() {
    if (DEBUG) console.log('[Amae Analytics]', Array.from(arguments).join(' '));
  }

  function canTrack() {
    if (!GA4_ID) return false;
    if (!RESPECT_CONSENT) return true;
    return window.amaeConsentGranted === true;
  }

  function send(eventName, params) {
    if (!canTrack()) {
      log('(bloqueado — sin consentimiento)', eventName);
      return;
    }
    params = params || {};
    params.event_category = params.event_category || 'amae';
    if (typeof gtag === 'function') {
      gtag('event', eventName, params);
    }
    // También pushamos al dataLayer para GTM si se usa en el futuro
    if (window.dataLayer) {
      window.dataLayer.push({ event: 'amae_' + eventName, amae: params });
    }
    log('→', eventName, JSON.stringify(params));
  }

  /* ── Detect consent change in real time ── */
  document.addEventListener('shopify:consent-tracking-api:updated', function () {
    if (window.Shopify && window.Shopify.customerPrivacy) {
      window.amaeConsentGranted = window.Shopify.customerPrivacy.getTrackingConsent() === 'yes';
      log('Consentimiento actualizado:', window.amaeConsentGranted);
    }
  });

  /* ============================================================
     1. PRODUCT VIEWED — al cargar la página
     ============================================================ */
  function trackProductViewed() {
    var frame = sessionStorage.getItem(KEY_FRAME) || 'negro';
    send('product_viewed', {
      product_name: 'Amae Frame',
      frame_color:  frame,
      page_url:     location.href,
      referrer:     document.referrer || '(direct)'
    });

    // Detecta si es visita de retorno con intención abandonada
    var lastVisit = localStorage.getItem(KEY_LAST_VISIT);
    if (lastVisit) {
      var abandonedIntent = sessionStorage.getItem(KEY_INTENT);
      // si venía de otra sesión con intención pero nunca completó
      if (!abandonedIntent) {
        var prevData = null;
        try { prevData = JSON.parse(localStorage.getItem('amae_abandoned_session')); } catch(e){}
        if (prevData && prevData.intent && !prevData.completed) {
          send('return_after_abandonment', {
            minutes_since_abandon: Math.round((Date.now() - prevData.ts) / 60000),
            frame_color: prevData.frame || 'unknown',
            steps_done:  prevData.steps  || 0
          });
          localStorage.removeItem('amae_abandoned_session');
        }
      }
    }
    localStorage.setItem(KEY_LAST_VISIT, Date.now());
  }

  /* ============================================================
     2. SCROLL DEPTH
     ============================================================ */
  function initScrollTracking() {
    if (!TRACK_SCROLL) return;
    var milestones  = [25, 50, 75, 90];
    var fired       = {};
    var maxScrollPct = 0;

    function checkScroll() {
      var scrollTop    = window.scrollY || document.documentElement.scrollTop;
      var docHeight    = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight <= 0) return;
      var pct = Math.round((scrollTop / docHeight) * 100);
      if (pct > maxScrollPct) maxScrollPct = pct;

      milestones.forEach(function (m) {
        if (!fired[m] && pct >= m) {
          fired[m] = true;
          send('scroll_depth', { depth_percent: m, max_scroll: maxScrollPct });
        }
      });
    }

    var ticking = false;
    window.addEventListener('scroll', function () {
      if (!ticking) {
        requestAnimationFrame(function () { checkScroll(); ticking = false; });
        ticking = true;
      }
    }, { passive: true });
  }

  /* ============================================================
     3. TIME MILESTONES
     ============================================================ */
  function initTimeTracking() {
    if (!TRACK_TIME) return;
    var milestones = [30, 60, 120, 300]; // segundos
    var start = Date.now();
    var timers = [];

    milestones.forEach(function (sec) {
      timers.push(setTimeout(function () {
        var actualTime = Math.round((Date.now() - start) / 1000);
        send('time_milestone', {
          seconds:     sec,
          actual_time: actualTime,
          page_url:    location.href
        });
      }, sec * 1000));
    });

    // Cancela timers si el usuario sale antes de que disparen
    window.addEventListener('beforeunload', function () {
      timers.forEach(clearTimeout);
    });
  }

  /* ============================================================
     4. SECTION VISIBILITY (IntersectionObserver)
     ============================================================ */
  function initSectionTracking() {
    if (!('IntersectionObserver' in window)) return;

    var sections = [
      { id: 'top',         name: 'ficha_producto'   },
      { id: 'como',        name: 'como_funciona'    },
      { id: 'disenar',     name: 'configurador'     }
    ];

    // También observamos secciones por class
    var classSections = [
      { cls: '.amae-video-grid',    name: 'video'         },
      { cls: '.amae-garantia-grid', name: 'garantia'      },
      { cls: '.amae-resenas',       name: 'resenas'       }
    ];

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          send('section_viewed', {
            section_name: entry.target.dataset.analyticsSection || entry.target.id
          });
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.25 });

    sections.forEach(function (s) {
      var el = document.getElementById(s.id);
      if (el) {
        el.dataset.analyticsSection = s.name;
        observer.observe(el);
      }
    });
    classSections.forEach(function (s) {
      var el = document.querySelector(s.cls);
      if (el) {
        el.dataset.analyticsSection = s.name;
        observer.observe(el);
      }
    });
  }

  /* ============================================================
     5. CTA CLICK TRACKING (delegación en document)
     ============================================================ */
  function initClickTracking() {
    document.addEventListener('click', function (e) {
      var target = e.target.closest('[data-track], button, a');
      if (!target) return;

      // Botón "Diseñar mi cuadro" (producto)
      if (target.id === 'btnDisenar') {
        send('cta_clicked', { button: 'disenar_cuadro', location: 'product_page' });
        markCartIntent('browse');
        return;
      }
      // Botón "Añadir al carrito" (producto)
      if (target.id === 'btnCart') {
        send('cta_clicked', { button: 'añadir_carrito', location: 'product_page' });
        markCartIntent('cart');
        return;
      }
      // Botón "Finalizar y pagar" (configurador) → Stripe
      if (target.id === 'amaeSubmit') {
        send('checkout_initiated', {
          frame_color:  sessionStorage.getItem(KEY_FRAME) || 'negro',
          steps_done:   getStepsDone(),
          product_name: 'Amae Frame',
          value:        25.90,
          currency:     'EUR'
        });
        markCheckoutCompleted();
        return;
      }
      // Email de contacto
      if (target.classList.contains('amae-email-link') || (target.href && target.href.indexOf('amae.informacion@gmail.com') > -1)) {
        send('email_contact_clicked', { location: 'configurador' });
        return;
      }
      // Miniaturas de galería
      if (target.classList.contains('amae-gallery-thumb')) {
        send('gallery_thumb_clicked', { label: target.dataset.img || 'unknown' });
        return;
      }
      // Vídeos
      if (target.closest('.amae-video-card')) {
        var isLoop = target.closest('.amae-video-loop');
        send('video_clicked', { video_type: isLoop ? 'loop' : 'full' });
        return;
      }
    });
  }

  /* ============================================================
     6. FRAME SELECTION
     ============================================================ */
  function initFrameTracking() {
    // Escucha el selector de marco del configurador
    document.addEventListener('click', function (e) {
      var ff = e.target.closest('.amae-form-frame');
      if (!ff) return;
      var color = ff.dataset.color || 'desconocido';
      sessionStorage.setItem(KEY_FRAME, color);
      send('frame_selected', {
        frame_color: color,
        location:    'configurador'
      });
    });
    // Selector de marco en la ficha de producto (arriba)
    document.addEventListener('click', function (e) {
      var opt = e.target.closest('.amae-frame-opt');
      if (!opt) return;
      send('frame_selected', {
        frame_color: opt.dataset.color || 'desconocido',
        location:    'product_page'
      });
    });
  }

  /* ============================================================
     7. CONFIGURATOR STEP TRACKING
     ============================================================ */
  function initConfiguratorTracking() {
    // Observa cuando el configurador entra en pantalla
    if ('IntersectionObserver' in window) {
      var configObs = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) {
          send('configurator_opened', {
            frame_color: sessionStorage.getItem(KEY_FRAME) || 'negro'
          });
          markCartIntent('configurator');
          configObs.disconnect();
        }
      }, { threshold: 0.1 });
      var cfg = document.getElementById('disenar');
      if (cfg) configObs.observe(cfg);
    }

    // Observa completado de cada step (cuando gana clase is-complete)
    var stepsObserved = {};
    var stepObs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.type !== 'attributes' || m.attributeName !== 'class') return;
        var el  = m.target;
        var num = el.dataset.step;
        if (!num || stepsObserved[num]) return;
        if (el.classList.contains('is-complete')) {
          stepsObserved[num] = true;
          addStepDone(parseInt(num, 10));
          send('configurator_step_completed', {
            step:        parseInt(num, 10),
            step_name:   stepName(num),
            frame_color: sessionStorage.getItem(KEY_FRAME) || 'negro',
            total_steps_done: getStepsDone()
          });
        }
      });
    });

    document.querySelectorAll('.amae-step[data-step]').forEach(function (s) {
      stepObs.observe(s, { attributes: true });
    });
  }

  function stepName(n) {
    var names = { '1':'marco','2':'fotos_email','3':'de_parte_de','4':'textos','5':'email_notif' };
    return names[n] || 'paso_' + n;
  }
  function addStepDone(n) {
    var done = getStepsDone();
    if (done < n) {
      sessionStorage.setItem(KEY_STEPS, n);
    }
  }
  function getStepsDone() {
    return parseInt(sessionStorage.getItem(KEY_STEPS) || '0', 10);
  }

  /* ============================================================
     8. CART ABANDONMENT
     ============================================================ */
  var intentTimestamp = null;

  function markCartIntent(type) {
    if (!TRACK_ABANDON) return;
    if (!sessionStorage.getItem(KEY_INTENT)) {
      sessionStorage.setItem(KEY_INTENT, type);
      sessionStorage.setItem(KEY_INTENT_TIME, Date.now());
      intentTimestamp = Date.now();
      log('Intención marcada:', type);
    }
  }

  function markCheckoutCompleted() {
    sessionStorage.setItem(KEY_INTENT, 'completed');
    // Limpiamos cualquier abandono previo guardado
    localStorage.removeItem('amae_abandoned_session');
    log('Checkout completado — abandono cancelado');
  }

  function checkAbandon() {
    if (!TRACK_ABANDON) return;
    var intent    = sessionStorage.getItem(KEY_INTENT);
    var intentTs  = parseInt(sessionStorage.getItem(KEY_INTENT_TIME) || '0', 10);
    if (!intent || intent === 'completed') return;

    var elapsed = Date.now() - intentTs;
    if (elapsed < ABANDON_THRESHOLD) return; // muy poco tiempo, no cuenta

    var stepsDone = getStepsDone();
    var frame     = sessionStorage.getItem(KEY_FRAME) || 'negro';

    // Enviamos el evento de abandono
    send('cart_abandoned', {
      intent_type:   intent,
      seconds_spent: Math.round(elapsed / 1000),
      steps_done:    stepsDone,
      frame_color:   frame,
      last_page:     location.pathname
    });

    // Guardamos en localStorage para el evento de retorno en próxima visita
    try {
      localStorage.setItem('amae_abandoned_session', JSON.stringify({
        intent:    intent,
        ts:        intentTs,
        steps:     stepsDone,
        frame:     frame,
        completed: false
      }));
    } catch (e) {}

    log('Abandono registrado — intent:', intent, '— pasos:', stepsDone);
  }

  function initAbandonmentTracking() {
    if (!TRACK_ABANDON) return;

    // visibilitychange: detecta cambio de pestaña / cierre (más fiable que beforeunload)
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        checkAbandon();
      }
    });

    // beforeunload como fallback para navegadores que no soporten visibilitychange bien
    window.addEventListener('beforeunload', function () {
      checkAbandon();
    });

    // pagehide para iOS Safari (beforeunload no es fiable en iOS)
    window.addEventListener('pagehide', function () {
      checkAbandon();
    });
  }

  /* ============================================================
     9. QUANTITY TRACKING
     ============================================================ */
  function initQuantityTracking() {
    document.addEventListener('click', function (e) {
      if (!e.target.classList.contains('amae-qty-btn')) return;
      var val = document.getElementById('amaeQtyVal');
      if (!val) return;
      var qty = parseInt(val.textContent, 10) || 1;
      send('quantity_changed', { quantity: qty });
    });
  }

  /* ============================================================
     INIT — espera a que el DOM esté listo y al consentimiento
     ============================================================ */
  function init() {
    if (!GA4_ID) {
      log('GA4 ID no configurado. Ve a Shopify Admin → Tienda online → Personalizar tema → Analytics');
      return;
    }

    // Si el consentimiento aún no está definido esperamos hasta 1.5s
    var waited = 0;
    var waitInterval = setInterval(function () {
      waited += 100;
      var consentReady = window.amaeConsentGranted !== undefined;
      var timeOut      = waited >= 1500;

      if (consentReady || timeOut) {
        clearInterval(waitInterval);
        if (timeOut && window.amaeConsentGranted === undefined) {
          window.amaeConsentGranted = !RESPECT_CONSENT;
        }
        startTracking();
      }
    }, 100);
  }

  function startTracking() {
    log('Iniciando — GA4:', GA4_ID, '— consentimiento:', window.amaeConsentGranted);

    trackProductViewed();
    initScrollTracking();
    initTimeTracking();
    initSectionTracking();
    initClickTracking();
    initFrameTracking();
    initConfiguratorTracking();
    initAbandonmentTracking();
    initQuantityTracking();

    // Expone API pública para que amae.js pueda disparar eventos directamente
    window.amaeTrack = send;
    window.amaeMarkIntent = markCartIntent;
    window.amaeMarkCompleted = markCheckoutCompleted;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
