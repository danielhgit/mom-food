/* צלחת — "תראי לי איך": guided tasks on the real screens.
   The screen dims, only the real button is lit, one sentence explains it, and
   the tour moves on when SHE taps that button (not a "next" she can skip past).
   Research behind it: tutorials read up front are forgotten within seconds and
   make the app look harder; help at the moment of the action works, and older
   users learn best by doing it themselves with guidance (DECISIONS 49).
   Taps outside the lit button are swallowed while a tour runs. */
(function (root) {
  const $ = (s) => document.querySelector(s);
  const first = (sel) => {
    for (const el of document.querySelectorAll(sel)) { const r = el.getBoundingClientRect(); if (r.width && r.height) return el; }
    return null;
  };
  const toastStep = { el: '#toast.show', text: 'נרשם. אם טעית, לוחצים כאן על "ביטול". אם הכול בסדר, לא צריך לעשות כלום.', wait: 'next' };

  /* ---------------- the tasks ---------------- */
  const TOURS = [
    {
      id: 'log', icon: 'plus', title: 'לרשום מאכל', sub: 'מה שאכלת, בשלוש לחיצות', routes: ['', 'add'],
      steps: [
        { route: '#/', el: '#nav a.center', text: 'כדי לרשום אוכל, לוחצים על הכפתור הירוק.', wait: 'tap' },
        { el: '#aslot', text: 'כאן בוחרים לאיזו ארוחה. הארוחה של עכשיו כבר מסומנת.', wait: 'next' },
        { el: () => first('#home .tile[data-act="food"]'), skipIf: () => !first('#home .tile[data-act="food"]'),
          text: 'אלה המאכלים שלך. לוחצים על המאכל שאכלת.', wait: 'tap' },
        { el: '#q', skipIf: () => !!$('#modal.show'), text: 'כותבים כאן את שם המאכל.',
          advanceWhen: () => $('#q') && $('#q').value.trim().length >= 2 && first('#res [data-act="res"]') },
        { el: () => first('#res [data-act="res"]'), skipIf: () => !!$('#modal.show'), text: 'לוחצים על המאכל הנכון.', wait: 'tap' },
        { el: '#modalbody .stepper', text: 'כאן משנים כמות. פלוס מוסיף, מינוס מוריד.', wait: 'next' },
        { el: '#modalbody [data-act="save"]', text: 'כשהכמות נכונה, לוחצים כאן.', wait: 'tap' },
        toastStep,
        { done: 'זהו, ככה רושמים. בפעם הבאה המאכל יחכה לך למעלה ברשימה.' },
      ],
    },
    {
      id: 'meal', icon: 'book', title: 'לרשום ארוחה קבועה', sub: 'ארוחה שחוזרת, בלחיצה אחת', routes: ['add'],
      unavailable: () => (APP.meals.length ? null : 'עוד אין לך ארוחות קבועות. כשתאכלי כמעט אותו דבר כמה ימים, האפליקציה תציע לשמור ארוחה.'),
      steps: [
        { route: '#/add', el: () => first('#home .mealtile'), missing: 'אין ארוחה קבועה לארוחה הזו. אפשר לבחור ארוחה אחרת למעלה ולנסות שוב.',
          text: 'אלה הארוחות הקבועות שלך. לוחצים על הארוחה שאכלת.', wait: 'tap' },
        { el: '#clrows .tick', text: 'מה שלא אכלת הפעם, לוחצים על הסימון והוא יורד. הארוחה השמורה לא משתנה.', wait: 'next' },
        { el: '#modalbody [data-act="save"]', text: 'לוחצים כאן, וכל הארוחה נרשמת.', wait: 'tap' },
        toastStep,
        { done: 'זהו. ארוחה שלמה בשתי לחיצות.' },
      ],
    },
    {
      id: 'search', icon: 'search', title: 'מאכל שלא ברשימה', sub: 'לחפש מאכל חדש', routes: ['add'],
      steps: [
        { route: '#/add', el: '#q', text: 'כותבים כאן את שם המאכל.',
          advanceWhen: () => $('#q') && $('#q').value.trim().length >= 2 && ($('#res [data-act="mohq"]') || first('#res [data-act="res"]')) },
        { el: '#res [data-act="mohq"]', skipIf: () => !$('#res [data-act="mohq"]'),
          text: 'לא מצאת אצלך? לוחצים כאן, ומחפשים במאגר הגדול.', wait: 'either' },
        { el: () => first('#res [data-act="res"]'), missing: 'לא נמצא מאכל בשם הזה. אפשר לנסות מילה אחרת.',
          text: 'לוחצים על המאכל הכי מתאים.', wait: 'tap' },
        { el: '#modalbody .stepper', text: 'כאן משנים כמות. פלוס מוסיף, מינוס מוריד.', wait: 'next' },
        { el: '#modalbody [data-act="save"]', text: 'לוחצים כאן, והמאכל נרשם ונשמר אצלך לפעם הבאה.', wait: 'tap' },
        toastStep,
        { done: 'זהו. מעכשיו המאכל הזה נמצא במאכלים שלך.' },
      ],
    },
    {
      id: 'fix', icon: 'pen', title: 'לתקן או למחוק', sub: 'כשרשמת משהו לא נכון', routes: [''],
      steps: [
        { route: '#/', el: () => first('#view .entry'), missing: 'עוד לא רשמת היום כלום. אחרי שתרשמי, אפשר לחזור להדרכה הזו.',
          text: 'כדי לתקן, לוחצים על המאכל.', wait: 'tap' },
        { el: '#modalbody .stepper', text: 'כאן משנים כמות.', wait: 'next' },
        { el: () => { const b = $('#modalbody [data-act="x-move"]'); return b && b.closest('.seg'); },
          text: 'נרשם לארוחה הלא נכונה? בוחרים כאן את הארוחה הנכונה.', wait: 'next' },
        { el: '#modalbody [data-act="x-remove"]', text: 'לא אכלת את זה בכלל? מוחקים כאן.', wait: 'next' },
        { el: '#modalbody [data-act="save"]', text: 'אחרי ששינית כמות, לוחצים כאן לשמור.', wait: 'next' },
        { done: 'ככה מתקנים. אם אין מה לשנות, סוגרים את החלון.' },
      ],
    },
    {
      id: 'close', icon: 'moon', title: 'לסגור את היום', sub: 'בסוף היום, סיכום ומילה טובה', routes: [''],
      steps: [
        { route: '#/', el: '#view [data-act="close"]', missing: 'הכפתור לסגירת היום מופיע אחרי שרושמים משהו, וכל עוד היום פתוח.',
          text: 'בסוף היום, אחרי הארוחה האחרונה, לוחצים כאן.', wait: 'tap' },
        { el: '#modalbody .daynote', text: 'כאן יש סיכום קצר של היום ומילה טובה.', wait: 'next' },
        { el: '#modalbody [data-act="close"]', text: 'לוחצים כאן כדי לסגור את היום. אם עוד לא סיימת לאכול, סוגרים את החלון וחוזרים בערב.', wait: 'next' },
        { done: 'זהו. יום שנגמר מעל היעד זה בסדר, מה שקובע הוא הממוצע של השבוע.' },
      ],
    },
    {
      id: 'weigh', icon: 'scale', title: 'לרשום משקל', sub: 'ופעם בשבוע גם מותניים', routes: ['', 'progress'],
      steps: [
        { route: '#/progress', el: () => { const i = $('#pw'); return i && i.closest('.card'); },
          text: 'כאן רושמים משקל. הכי טוב בבוקר, לפני שאוכלים.', wait: 'next' },
        { el: '#pw', text: 'לוחצים כאן וכותבים את המשקל.', wait: 'next' },
        { el: '#pwaist', text: 'פעם בשבוע כותבים גם היקף מותניים, בגובה הטבור. בשאר הימים משאירים ריק.', wait: 'next' },
        { el: () => { const i = $('#pw'); return i && i.closest('.card').querySelector('[data-act="save"]'); },
          text: 'ולוחצים לשמור.', wait: 'tap' },
        { done: 'נשמר. המשקל קופץ מיום ליום וזה נורמלי, מה שחשוב הוא הממוצע של השבוע.' },
      ],
    },
    {
      id: 'request', icon: 'list', title: 'לכתוב בקשה לדניאל', sub: 'משהו לא עובד, או רעיון', routes: ['requests'],
      steps: [
        { route: '#/requests', el: '#view .seg', text: 'בוחרים: משהו לא עובד, או רעיון לשיפור.', wait: 'either' },
        { el: '#rtext', text: 'כותבים כאן במילים שלך מה קרה, או מה היה עוזר.', wait: 'next' },
        { el: '#view [data-act="mic"]', skipIf: () => !$('#view [data-act="mic"]'), text: 'לא בא לכתוב? לוחצים כאן ומדברים.', wait: 'next' },
        { el: '#view [data-act="add"]', text: 'לוחצים כאן לשמור. אפשר לשמור כמה בקשות.', wait: 'either' },
        { el: '#view [data-act="send"]', skipIf: () => !$('#view [data-act="send"]'), text: 'כשרוצים, לוחצים כאן ושולחים לדניאל בוואטסאפ.', wait: 'next' },
        { done: 'זהו. דניאל יקבל את ההודעה ויתקן.' },
      ],
    },
  ];

  /* ---------------- overlay ---------------- */
  let layer, spot, bubble, textEl, nextBtn;
  function build() {
    if (layer) return;
    layer = document.createElement('div');
    layer.id = 'tour';
    layer.hidden = true;
    layer.innerHTML = `<div class="tspot"></div>
      <div class="tbubble" role="dialog" aria-live="polite">
        <p class="ttext"></p>
        <div class="tbtns"><button class="btn tnext">הבנתי, הלאה</button><button class="linkbtn tstop">לצאת מההדרכה</button></div>
      </div>`;
    document.body.appendChild(layer);
    spot = layer.querySelector('.tspot');
    bubble = layer.querySelector('.tbubble');
    textEl = layer.querySelector('.ttext');
    nextBtn = layer.querySelector('.tnext');
    nextBtn.onclick = () => { if (!run) return; if (run.tip || run.step.done) end(true); else next(); };
    layer.querySelector('.tstop').onclick = () => end(false);
  }

  let run = null;     // { tour, i, step, el, raf, poll, lostAt, tip }
  const WAIT_MS = 8000;

  function resolve(step) {
    const el = typeof step.el === 'function' ? step.el() : first(step.el);
    return el && el.isConnected ? el : null;
  }

  function show(step, el) {
    layer.hidden = false;
    textEl.textContent = step.done || step.text;
    const wantsNext = !!step.done || step.wait === 'next' || step.wait === 'either';
    nextBtn.hidden = !wantsNext;
    nextBtn.textContent = step.done ? (run.tip ? 'הבנתי' : 'סיימתי') : 'הבנתי, הלאה';
    layer.querySelector('.tstop').hidden = !!step.done || run.tip;
    layer.classList.toggle('center', !el);
    // a tour that already showed something doesn't need its first-time tip later
    const tipId = { '#modalbody .stepper': 'qty', '#clrows .tick': 'untick' }[step.el];
    if (tipId && !run.tip && !(APP.ui.tipsSeen || []).includes(tipId)) saveUi({ tipsSeen: [...(APP.ui.tipsSeen || []), tipId] }).catch(() => {});
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      layer.classList.add('pulse');
      setTimeout(() => layer && layer.classList.remove('pulse'), 900);
    }
    place();
  }

  function place() {
    if (!run) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    let el = run.el;
    if (run.step.el && (!el || !el.isConnected)) {
      el = run.el = resolve(run.step);
      if (!el) {
        run.lostAt = run.lostAt || Date.now();
        if (Date.now() - run.lostAt > 1500) { end(false, 'ההדרכה נעצרה. אפשר להתחיל שוב מתי שרוצים.'); return; }
      } else run.lostAt = 0;
    }
    if (el) {
      const r = el.getBoundingClientRect();
      const pad = 6;
      Object.assign(spot.style, { top: r.top - pad + 'px', left: r.left - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
      const bh = bubble.offsetHeight, bw = Math.min(340, vw - 24);
      bubble.style.width = bw + 'px';
      const below = r.bottom + pad + 14;
      const above = r.top - pad - 14 - bh;
      let top = below + bh < vh - 8 ? below : above > 8 ? above : Math.max(8, vh - bh - 8);
      bubble.style.top = top + 'px';
      bubble.style.left = Math.round(Math.min(Math.max(12, r.left + r.width / 2 - bw / 2), vw - bw - 12)) + 'px';
    } else if (!run.step.el) {
      Object.assign(spot.style, { top: vh / 2 + 'px', left: vw / 2 + 'px', width: '0px', height: '0px' });
      const bw = Math.min(340, vw - 24);
      bubble.style.width = bw + 'px';
      bubble.style.top = Math.round(vh / 2 - bubble.offsetHeight / 2) + 'px';
      bubble.style.left = Math.round(vw / 2 - bw / 2) + 'px';
    }
    run.raf = requestAnimationFrame(place);
  }

  function stopTimers() {
    if (!run) return;
    cancelAnimationFrame(run.raf);
    clearInterval(run.poll);
  }

  function go(i) {
    stopTimers();
    const steps = run.tour.steps;
    while (i < steps.length && steps[i].skipIf && steps[i].skipIf()) i++;
    if (i >= steps.length) { end(true); return; }
    const step = steps[i];
    Object.assign(run, { i, step, el: null, lostAt: 0 });
    if (step.done) { show(step, null); return; }
    const here = (location.hash || '#/').split('?')[0];
    if (step.route && here !== step.route && !(step.route === '#/' && here === '#')) {
      if (window.modalOpen && modalOpen()) closeModal();
      root.go(step.route);
    }
    layer.hidden = true;
    const started = Date.now();
    run.poll = setInterval(() => {
      const el = resolve(step);
      if (el) {
        clearInterval(run.poll);
        run.el = el;
        show(step, el);
        if (step.advanceWhen) {
          run.poll = setInterval(() => { if (run && run.step === step && step.advanceWhen()) next(); }, 300);
        }
      } else if (Date.now() - started > WAIT_MS) {
        clearInterval(run.poll);
        end(false, step.missing || 'לא מצאתי את הכפתור במסך. אפשר לנסות שוב מתי שרוצים.');
      }
    }, 150);
  }
  function next() { if (run) go(run.i + 1); }

  /* Taps: inside the lit element or the bubble go through; everything else is
     swallowed, and the light pulses to show where to tap. */
  function guard(ev) {
    if (!run || layer.hidden) {
      if (run && !run.tip) { ev.preventDefault(); ev.stopPropagation(); }   // between steps: wait
      return;
    }
    if (bubble.contains(ev.target)) return;
    const el = run.el;
    const inside = el && el.contains(ev.target);
    const toastUndo = run.step.el === '#toast.show' && ev.target.closest && ev.target.closest('#toast');
    if (inside || toastUndo) {
      if (ev.type === 'click' && (run.step.wait === 'tap' || run.step.wait === 'either')) {
        const step = run.step;
        setTimeout(() => { if (run && run.step === step) next(); }, 350);
      }
      return;
    }
    if (run.tip) { end(true); return; }
    ev.preventDefault(); ev.stopPropagation();
    if (ev.type === 'click') { layer.classList.add('pulse'); setTimeout(() => layer && layer.classList.remove('pulse'), 900); }
  }

  function start(id) {
    const tour = TOURS.find((t) => t.id === id);
    if (!tour) return;
    const why = tour.unavailable && tour.unavailable();
    if (why) { toast(why); return; }
    build();
    if (run) end(false);
    if (window.modalOpen && modalOpen()) closeModal();
    run = { tour, i: 0, tip: false };
    document.addEventListener('click', guard, true);
    document.addEventListener('pointerdown', guard, true);
    setTimeout(() => run && run.tour === tour && go(0), 250);
  }

  function end(finished, message) {
    if (!run) return;
    const wasTip = run.tip, tipId = run.tipId;
    stopTimers();
    run = null;
    document.removeEventListener('click', guard, true);
    document.removeEventListener('pointerdown', guard, true);
    if (layer) layer.hidden = true;
    if ($('#toast.show') && !message) setTimeout(() => root.hideToast && hideToast(), 2500);
    if (message) toast(message);
    if (wasTip && tipId) saveUi({ tipsSeen: [...(APP.ui.tipsSeen || []), tipId] }).catch(() => {});
    if (!wasTip && finished) vibrate([15, 30, 15]);
  }

  /* A one-time hint the first time she meets something (a single lit element
     with "הבנתי"). Never during a tour; tapping anywhere else just closes it. */
  function tip(id, sel, text, delay = 450) {
    if (run || (APP.ui.tipsSeen || []).includes(id) || !APP.ui.onboarded) return;
    setTimeout(() => {
      if (run || (APP.ui.tipsSeen || []).includes(id)) return;
      const el = first(sel);
      if (!el) return;
      build();
      run = { tour: { steps: [] }, i: 0, tip: true, tipId: id, step: { el: sel, text, wait: 'next', done: null }, el, lostAt: 0 };
      document.addEventListener('click', guard, true);
      layer.hidden = false;
      textEl.textContent = text;
      nextBtn.hidden = false; nextBtn.textContent = 'הבנתי';
      layer.querySelector('.tstop').hidden = true;
      layer.classList.remove('center');
      place();
    }, delay);
  }

  const forRoute = (r) => TOURS.filter((t) => t.routes.includes(r));
  const active = () => !!run;
  const holdsToast = () => !!(run && run.step && run.step.el === '#toast.show');

  root.Tour = { TOURS, start, end: () => end(false), tip, forRoute, active, holdsToast };
})(window);
