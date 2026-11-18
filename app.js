/* =====================================================================
   APEX GARAGE — interactions (vanilla JS, no dependencies)
   ===================================================================== */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------------------------------------------------------------------
   Data
   --------------------------------------------------------------------- */
const SYSTEMS = [
  {
    id: 'engine', name: 'Engine', hot: [695, 249],
    how: 'Air and fuel are squeezed inside each cylinder and lit by a spark. The burning gas pushes a piston down, and the crankshaft turns all that up-and-down shoving into rotation.',
    signs: 'Ticking or knocking, blue or white smoke, the oil light, a rough idle, or power that comes and goes.',
    do: 'Oil and filter changes, spark plugs, timing belts and chains, compression tests, full rebuilds.',
    interval: 'Oil every 10k mi / 12 mo'
  },
  {
    id: 'transmission', name: 'Transmission', hot: [580, 259],
    how: 'The gearbox trades speed for force. Low gears multiply torque to get you moving; high gears let the engine relax at speed. A driveshaft and differential carry the drive to the wheels and let them turn at different speeds through corners.',
    signs: 'Slipping, whining that rises with speed, clunky or crunchy changes, a burning smell, a clutch that bites high.',
    do: 'Gearbox and diff fluid changes, clutch replacement, CV joints, driveshafts.',
    interval: 'Fluid ~40–60k mi'
  },
  {
    id: 'brakes', name: 'Brakes', hot: [780, 300],
    how: 'Your foot pushes fluid through sealed lines. Hydraulics multiply that force so the calipers clamp pads onto spinning discs, turning the car\'s motion into heat.',
    signs: 'Squealing, grinding, a soft or long pedal, juddering through the wheel, the car pulling to one side.',
    do: 'Pads, discs, fluid flushes, caliper rebuilds, brake line replacement.',
    interval: 'Fluid every 2 years'
  },
  {
    id: 'suspension', name: 'Suspension', hot: [230, 222],
    how: 'Springs carry the car\'s weight; dampers control how fast it moves so the tyres stay pressed to the road. The geometry (camber, toe and caster) decides how each tyre meets the tarmac.',
    signs: 'Bouncing after bumps, knocks over potholes, uneven tyre wear, a car that wanders or leans hard in corners.',
    do: 'Shock absorbers, springs, bushes, ball joints, four-wheel laser alignment.',
    interval: 'Alignment check yearly'
  },
  {
    id: 'cooling', name: 'Cooling', hot: [876, 261],
    how: 'Only about a third of the fuel\'s energy moves the car; much of the rest becomes heat. Coolant circulates through the engine, soaks that heat up and dumps it through the radiator.',
    signs: 'A climbing temperature gauge, a sweet smell, puddles under the front, a heater that blows cold.',
    do: 'Coolant flushes, pressure tests, water pumps, thermostats, radiators and hoses.',
    interval: 'Coolant every 4–5 years'
  },
  {
    id: 'electrical', name: 'Electrics', hot: [125, 238],
    how: 'The battery starts the car. Once it\'s running, the alternator makes the power and recharges the battery. Dozens of control units talk over a network called CAN bus, and that\'s what our diagnostic kit plugs into.',
    signs: 'Slow cranking, flickering lights, random warning lights, a battery that keeps going flat.',
    do: 'Battery and charging tests, fault-code diagnostics, wiring repairs, module coding.',
    interval: 'Battery test every winter'
  },
  {
    id: 'exhaust', name: 'Exhaust', hot: [420, 297],
    how: 'Spent gas leaves through the manifold, then a catalytic converter that turns the worst pollutants into less harmful gases, then silencers that tame the noise.',
    signs: 'A sudden roar, rattles underneath, fumes in the cabin, a failed emissions test.',
    do: 'Leak repairs, catalytic converter and DPF diagnosis, sensor replacement, emissions checks.',
    interval: 'Checked every service'
  },
  {
    id: 'tyres', name: 'Tyres', hot: [184, 338],
    how: 'Each tyre touches the road through a patch about the size of your hand. Steering, braking and grip all happen through those four patches.',
    signs: 'Tread getting close to 3 mm, cracks or bulges in the sidewall, vibration at speed, a pressure warning.',
    do: 'Fitting, balancing, rotation, puncture repair, pressure sensor (TPMS) service.',
    interval: 'Pressures monthly'
  }
];

const SERVICES = [
  { t: 'Servicing', meta: 'Interim · Full · Major', d: 'Manufacturer-schedule servicing that keeps your warranty intact, with a stamped book and a full inspection report.', tags: ['Oil & filters', 'Plugs', 'Fluids', '60-point check'] },
  { t: '<em>Diagnostics</em>', meta: 'From 1 hr', d: 'Warning light on? Strange noise? We read the fault codes, then test the actual parts to find the real cause.', tags: ['Fault codes', 'Live data', 'Road test', 'Smoke test'] },
  { t: 'Brakes', meta: 'Same day, most cars', d: 'Pads, discs, fluid and calipers. We measure everything and show you what\'s worn before we replace it.', tags: ['Pads & discs', 'Fluid flush', 'Calipers', 'Lines'] },
  { t: 'Suspension &amp; alignment', meta: 'Laser alignment', d: 'From knocking bushes to full coilover setups, finished with four-wheel alignment so your tyres last.', tags: ['Dampers', 'Springs', 'Bushes', 'Geometry'] },
  { t: 'Tyres', meta: 'All sizes', d: 'Fitted, balanced and set to the right pressure, with honest advice on which tyre suits your car and your driving.', tags: ['Fitting', 'Balancing', 'TPMS', 'Repairs'] },
  { t: 'Cooling &amp; <em>climate</em>', meta: 'Incl. air con', d: 'Overheating, leaks or warm air con. We pressure-test the system and fix the cause, not just the symptom.', tags: ['Coolant', 'Water pump', 'Radiator', 'A/C regas'] },
  { t: 'Clutch &amp; gearbox', meta: 'Manual & auto', d: 'Clutch replacements, gearbox fluid services and driveline repairs, including dual-mass flywheels.', tags: ['Clutch', 'Flywheel', 'Fluids', 'CV joints'] },
  { t: 'MOT preparation', meta: 'Pre-test check', d: 'We go through the test checklist first and fix what would fail, so the test itself is a formality.', tags: ['Lights', 'Emissions', 'Brakes', 'Structure'] },
  { t: 'Performance &amp; <em>restoration</em>', meta: 'By consultation', d: 'Engine rebuilds, tuning and frame-off restorations, with every stage photographed and logged.', tags: ['Rebuilds', 'Mapping', 'Big brakes', 'Restoration'] }
];

const INTERVALS = [
  { n: 'Oil & filter', every: 10000 },
  { n: 'Tyre rotation', every: 6000 },
  { n: 'Brake inspection', every: 12000 },
  { n: 'Air & pollen filters', every: 20000 },
  { n: 'Brake fluid', every: 24000, note: 'or 2 yrs' },
  { n: 'Spark plugs', every: 36000 },
  { n: 'Coolant', every: 60000, note: 'or 5 yrs' },
  { n: 'Gearbox fluid', every: 60000 },
  { n: 'Timing belt', every: 80000, note: 'if fitted' }
];

// Dashboard glyphs on a 32×32 grid, modelled on the ISO 2575 symbols drivers actually see.
const ICON = {
  oil: '<path d="M6 14h4.5l2-2.5h4.5l1.8 2.5h2.7L29 9.5l.8 1.3L21.2 22H6z" fill="currentColor" stroke="none"/><path d="M6.5 15H3v-3.5M13 11.5V8.5M10.5 8.5h5"/><path d="M29.4 15.6c0 1.4-.8 2.3-1.7 2.3s-1.7-.9-1.7-2.3 1.7-3.6 1.7-3.6 1.7 2.2 1.7 3.6z" fill="currentColor" stroke="none"/>',
  temp: '<rect x="13.8" y="3" width="4.4" height="15" rx="2.2"/><circle cx="16" cy="20.5" r="3.8" fill="currentColor" stroke="none"/><path d="M19.5 7h3.5M19.5 10.5h3.5M19.5 14h3.5"/><path d="M3 27c2.2-1.6 4.3-1.6 6.5 0s4.3 1.6 6.5 0 4.3-1.6 6.5 0 4.3 1.6 6.5 0"/>',
  battery: '<rect x="3.5" y="10" width="25" height="16" rx="2"/><path d="M7.5 10V7h4.5v3zM20 10V7h4.5v3z" fill="currentColor"/><path d="M8 18h5M19 18h5M21.5 15.5v5"/>',
  brake: '<circle cx="16" cy="16" r="8.5"/><path d="M16 11v6.5"/><circle cx="16" cy="21" r="1.4" fill="currentColor" stroke="none"/><path d="M6.5 8.5a11 11 0 0 0 0 15M25.5 8.5a11 11 0 0 1 0 15"/>',
  engine: '<path d="M7 11h4V9h8v2h3l2.5 3h2v-2H29v10h-2.5v-2h-2L21.5 24h-10L9 21H7z" fill="currentColor" fill-opacity=".18"/><path d="M7 14H3.5M3.5 11.5v7M13 6.5h4M15 6.5V9"/>',
  abs: '<circle cx="16" cy="16" r="8.5"/><text x="16" y="18.6" font-size="7.4" font-family="Inter Tight, Arial, sans-serif" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">ABS</text><path d="M6.5 8.5a11 11 0 0 0 0 15M25.5 8.5a11 11 0 0 1 0 15"/>',
  tpms: '<path d="M8.5 5.5C6 10 5.6 17 7.4 22.5h17.2C26.4 17 26 10 23.5 5.5"/><path d="M7.4 22.5v3.5M11.6 22.5v3.5M16 22.5v3.5M20.4 22.5v3.5M24.6 22.5v3.5"/><path d="M16 9.5v6.5"/><circle cx="16" cy="19" r="1.4" fill="currentColor" stroke="none"/>',
  service: '<g transform="translate(4 4)"><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z" fill="currentColor" stroke="none"/></g>'
};

const LIGHTS = [
  { id: 'oil', label: 'Oil', sev: 'stop', title: 'Low oil pressure', what: 'The engine isn\'t getting enough oil to protect its moving parts. Driving on can wreck it in minutes.', act: 'Pull over and switch off as soon as it\'s safe. Check the level once it\'s cool. Don\'t restart until it\'s topped up, and call us if the light stays on.' },
  { id: 'temp', label: 'Temp', sev: 'stop', title: 'Engine overheating', what: 'Coolant temperature is too high: a leak, a failed fan or water pump, or a stuck thermostat.', act: 'Stop, switch off and let it cool. Never open a hot radiator cap. Top up only when it\'s cold, then come straight to us.' },
  { id: 'battery', label: 'Charge', sev: 'stop', title: 'Charging fault', what: 'The alternator isn\'t charging the battery, usually because of the alternator itself or its drive belt. You\'re running on battery alone.', act: 'Turn off anything you don\'t need (heated seats, stereo) and drive straight to us or home. The car may cut out when the battery runs flat.' },
  { id: 'brake', label: 'Brake', sev: 'stop', title: 'Brake system warning', what: 'The handbrake is on, the brake fluid is low, or there\'s a fault in the system.', act: 'If the handbrake is fully off and the light stays on, don\'t drive it. Call us and we\'ll talk you through the next step.' },
  { id: 'engine', label: 'Engine', sev: 'soon', title: 'Engine management', what: 'The engine computer has logged a fault. It could be anything from a loose fuel cap to a failing sensor.', act: 'Steady light: book in this week. Flashing light: that\'s a misfire. Ease off and stop when safe, because it can destroy the catalytic converter.' },
  { id: 'abs', label: 'ABS', sev: 'soon', title: 'Anti-lock brakes off', what: 'The ABS has switched itself off. Your normal brakes still work, but the wheels can lock in an emergency stop.', act: 'Drive gently, leave extra stopping distance and book a diagnostic. It\'s often a wheel-speed sensor.' },
  { id: 'tpms', label: 'Tyres', sev: 'soon', title: 'Tyre pressure low', what: 'One or more tyres has lost pressure. That\'s bad for grip, fuel economy and the tyre itself.', act: 'Check all four pressures when the tyres are cold and inflate to the figure on the door sticker. If it comes back, it\'s probably a slow puncture.' },
  { id: 'service', label: 'Service', sev: 'info', title: 'Service due', what: 'Not a fault, just a reminder. The car has reached its time or mileage service interval.', act: 'Book a service in the next few weeks. We\'ll reset the reminder for you when it\'s done.' }
];
const SEV = { stop: ['Stop safely', 'var(--red)'], soon: ['Book in soon', 'var(--amber)'], info: ['Reminder', '#58E07A'] };

const BOOK = [
  { n: 'Full service', h: 3 },
  { n: 'Interim service', h: 1.5 },
  { n: 'Diagnostics', h: 1 },
  { n: 'Brakes', h: 2 },
  { n: 'Tyres & alignment', h: 1.5 },
  { n: 'Cooling / A/C', h: 2 },
  { n: 'Clutch & gearbox', h: 5 },
  { n: 'MOT preparation', h: 1 },
  { n: 'Performance / restoration', h: null }
];
const WORKSHOP_EMAIL = 'hello@example.com'; // TODO: replace with the workshop's real address

/* ---------------------------------------------------------------------
   Split text into masked words
   --------------------------------------------------------------------- */
function splitWords(el, startIndex = 0) {
  let i = startIndex;
  const nodes = [...el.childNodes];
  el.textContent = '';
  const wrap = (content) => {
    const w = document.createElement('span');
    w.className = 'w';
    const inner = document.createElement('span');
    inner.className = 'w__i';
    inner.style.setProperty('--i', i++);
    if (typeof content === 'string') inner.textContent = content; else inner.appendChild(content);
    w.appendChild(inner);
    return w;
  };
  nodes.forEach(node => {
    if (node.nodeType === 3) {
      node.textContent.split(/(\s+)/).forEach(part => {
        if (!part) return;
        if (/^\s+$/.test(part)) el.appendChild(document.createTextNode(' '));
        else el.appendChild(wrap(part));
      });
    } else {
      el.appendChild(wrap(node));
    }
  });
  return i;
}
let heroIdx = 0;
$$('[data-split]').forEach(el => {
  if (el.closest('#heroTitle')) heroIdx = splitWords(el, heroIdx + 2);
  else splitWords(el);
});

/* ---------------------------------------------------------------------
   Reveal on scroll
   --------------------------------------------------------------------- */
const io = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  });
}, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
$$('[data-reveal], [data-split]').forEach(el => { if (!el.closest('#heroTitle')) io.observe(el); });

/* ---------------------------------------------------------------------
   Loader → hero
   --------------------------------------------------------------------- */
(function loader() {
  const num = $('#loaderNum'), bar = $('#loaderBar');
  const dur = reduceMotion ? 200 : 1500;
  const t0 = performance.now();
  $$('#heroCar .draw').forEach(p => p.style.setProperty('--len', Math.ceil(p.getTotalLength())));

  const fontsReady = Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise(r => setTimeout(r, 2500))]);

  function tick(now) {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    num.textContent = String(Math.round(e * 100)).padStart(3, '0');
    bar.style.transform = `scaleX(${e})`;
    if (p < 1) requestAnimationFrame(tick);
    else fontsReady.then(finish);
  }
  function finish() {
    setTimeout(() => {
      $('#loader').classList.add('is-done');
      document.body.classList.remove('is-loading');
      setTimeout(() => {
        $$('#heroTitle [data-split]').forEach(el => el.classList.add('is-in'));
        $('.hero').classList.add('is-in');
        $$('.hero [data-reveal]').forEach(el => el.classList.add('is-in'));
        fitFooter();
      }, 350);
    }, 250);
  }
  requestAnimationFrame(tick);
})();

/* ---------------------------------------------------------------------
   Cursor
   --------------------------------------------------------------------- */
(function cursor() {
  if (!matchMedia('(pointer: fine)').matches || reduceMotion) return;
  document.documentElement.classList.add('has-cursor');
  const c = $('#cursor');
  let x = innerWidth / 2, y = innerHeight / 2, cx = x, cy = y;
  addEventListener('pointermove', e => { x = e.clientX; y = e.clientY; c.classList.add('is-on'); });
  document.addEventListener('pointerleave', () => c.classList.remove('is-on'));
  document.addEventListener('pointerover', e => {
    c.classList.toggle('is-big', !!e.target.closest('a, button, .hot, input, label'));
  });
  (function loop() {
    cx = lerp(cx, x, 0.22); cy = lerp(cy, y, 0.22);
    c.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
    requestAnimationFrame(loop);
  })();
})();

/* ---------------------------------------------------------------------
   Nav: hide on scroll down, progress bar, active link, clock
   --------------------------------------------------------------------- */
(function nav() {
  const navEl = $('#nav'), prog = $('#progress');
  let last = scrollY, ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = scrollY;
      navEl.classList.toggle('is-hidden', y > last && y > 240);
      last = y;
      const max = document.documentElement.scrollHeight - innerHeight;
      prog.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
      ticking = false;
    });
  }, { passive: true });

  const links = $$('.nav__links a');
  const secObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      links.forEach(a => a.classList.toggle('is-active', a.getAttribute('href') === '#' + e.target.id));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  $$('main section[id]').forEach(s => secObs.observe(s));
  $('#year').textContent = new Date().getFullYear();
})();

/* Marquee: duplicate for a seamless loop */
(function marquee() {
  const m = $('#marquee');
  m.innerHTML += m.innerHTML;
})();

/* Swap helper: fade content out, update, fade in */
function swap(el, update) {
  if (reduceMotion) { update(); return; }
  el.classList.add('is-out');
  setTimeout(() => { update(); el.classList.remove('is-out'); }, 220);
}

/* ---------------------------------------------------------------------
   01 Anatomy
   --------------------------------------------------------------------- */
(function anatomy() {
  const list = $('#anatList');
  const OVERVIEW = {
    id: 'overview', name: 'Whole car',
    how: 'Eight systems keep a car moving, stopping, cool and comfortable. Pick one and the body turns to x-ray so you can see exactly where it lives.',
    signs: 'Anything new: a noise, a smell, a light, a vibration. Cars rarely fail without warning first.',
    do: 'A full inspection at every service, with photos of anything that needs attention.',
    interval: 'Full service every 12 months'
  };
  const ITEMS = [OVERVIEW, ...SYSTEMS];
  let current = null;

  ITEMS.forEach(s => {
    const li = document.createElement('li');
    li.innerHTML = `<button class="anat__btn" role="tab" data-sys="${s.id}"><span>${s.name}</span></button>`;
    list.appendChild(li);
  });

  function select(id) {
    if (id === current) return;
    current = id;
    const s = ITEMS.find(x => x.id === id);
    $$('.anat__btn').forEach(b => { const on = b.dataset.sys === id; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on); });
    const idx = SYSTEMS.indexOf(s) + 1;
    swap($('#anatHow'), () => {
      $('#anatHow h3').innerHTML = idx ? `<em>${String(idx).padStart(2, '0')}</em> ${s.name}` : `The <em>whole</em> car`;
      $('#anatHow p').textContent = s.how;
    });
    swap($('#anatSigns'), () => { $('#anatSigns').textContent = s.signs; });
    swap($('#anatDo'), () => {
      $('#anatDo p').textContent = s.do;
      $('#anatDo .tag').textContent = '↻ ' + s.interval;
    });
    // scenes.js listens and moves the 3D camera / x-ray
    window.anatomyCurrent = id;
    window.dispatchEvent(new CustomEvent('anatomy:select', { detail: id }));
  }
  window.anatomySelect = select;
  window.anatomySystems = SYSTEMS.map(s => ({ id: s.id, name: s.name }));

  list.addEventListener('click', e => { const b = e.target.closest('.anat__btn'); if (b) select(b.dataset.sys); });
  select('overview');
})();

/* ---------------------------------------------------------------------
   02 Four-stroke engine
   --------------------------------------------------------------------- */
(function engine() {
  const SCALE = 0.02; // animation runs at 2% of real speed so the eye can follow it
  const STROKES = [
    { n: 'Intake', d: 'The piston drops and the intake valve opens. Air and fuel get drawn into the cylinder.' },
    { n: 'Compression', d: 'Both valves shut. The piston rises and squeezes the mixture into roughly a tenth of the space.' },
    { n: 'Power', d: 'The spark plug fires. Burning gas expands and drives the piston down. This is the only stroke that makes power.' },
    { n: 'Exhaust', d: 'The exhaust valve opens and the rising piston pushes the spent gas out. Then the whole loop starts again.' }
  ];
  const el = {
    num: $('#strokeNum'), name: $('#strokeName'), desc: $('#strokeDesc'),
    roTrips: $('#roTrips'), roFires: $('#roFires'), roFires4: $('#roFires4'),
    rpm: $('#rpm'), rpmVal: $('#rpmVal'), toggle: $('#engToggle'), icon: $('#engIcon'),
    hand: $('#crankHand'), handVal: $('#crankVal')
  };
  const btns = $$('#strokes button');
  let phi = 0, rpm = +el.rpm.value, playing = !reduceMotion, visible = false, lastT = null, lastStroke = -1;

  // Shared with scenes.js, which renders the 3D cutaway from this state every frame.
  const state = window.engineState = { phi: 0, stroke: 0, sp: 0, spark: 0, inLift: 0, exLift: 0 };

  function render() {
    const s = Math.floor(phi / 180) % 4;
    const sp = (phi % 180) / 180;
    const lift = (a, b) => (phi >= a && phi < b) ? Math.sin(((phi - a) / (b - a)) * Math.PI) : 0;
    state.phi = phi; state.stroke = s; state.sp = sp;
    state.inLift = lift(0, 180);
    state.exLift = lift(540, 720);
    state.spark = phi >= 358 && phi < 390 ? 1 - (phi - 358) / 32 : 0;

    const deg = Math.round(phi) % 720;
    el.handVal.textContent = deg + '°';
    if (document.activeElement !== el.hand) el.hand.value = deg;
    el.hand.style.setProperty('--p', (deg / 719) * 100 + '%');

    btns.forEach((b, i) => {
      b.querySelector('i').style.transform = `scaleX(${i < s ? 1 : i === s ? sp : 0})`;
    });
    if (s !== lastStroke) {
      lastStroke = s;
      btns.forEach((b, i) => b.classList.toggle('is-active', i === s));
      el.num.textContent = s + 1;
      el.name.textContent = STROKES[s].n;
      el.desc.textContent = STROKES[s].d;
    }
  }

  function setRpm(v) {
    rpm = v;
    el.rpmVal.textContent = v.toLocaleString('en-GB');
    el.roTrips.textContent = (v / 30).toFixed(0);       // 2 strokes per revolution
    el.roFires.textContent = (v / 120).toFixed(1);       // 1 spark every 2 revolutions
    el.roFires4.textContent = (v / 30).toFixed(0);
    el.rpm.style.setProperty('--p', ((v - el.rpm.min) / (el.rpm.max - el.rpm.min)) * 100 + '%');
  }

  function loop(t) {
    if (!playing || !visible) { lastT = null; return; }
    if (lastT != null) {
      const dt = Math.min(0.05, (t - lastT) / 1000);
      phi = (phi + rpm * 6 * SCALE * dt) % 720;
      render();
    }
    lastT = t;
    requestAnimationFrame(loop);
  }
  const start = () => { if (playing && visible && lastT == null) requestAnimationFrame(loop); };

  function setPlaying(p) {
    playing = p;
    el.toggle.setAttribute('aria-label', p ? 'Pause engine' : 'Play engine');
    el.icon.innerHTML = p ? '<rect x="3" y="2" width="4" height="14"/><rect x="11" y="2" width="4" height="14"/>' : '<path d="M4 2l12 7-12 7z"/>';
    start();
  }

  el.rpm.addEventListener('input', () => setRpm(+el.rpm.value));
  el.toggle.addEventListener('click', () => setPlaying(!playing));
  btns.forEach(b => b.addEventListener('click', () => { phi = +b.dataset.s * 180 + 0.5; lastStroke = -1; render(); }));
  el.hand.addEventListener('input', () => {
    if (playing) setPlaying(false);
    phi = +el.hand.value;
    render();
  });

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; start(); }, { threshold: 0.1 }).observe($('#engine'));

  setRpm(rpm);
  setPlaying(playing);
  render();
})();

/* ---------------------------------------------------------------------
   03 Services accordion
   --------------------------------------------------------------------- */
(function services() {
  const ul = $('#svcList');
  SERVICES.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'svc__row';
    const id = 'svc-' + i;
    li.innerHTML = `
      <button class="svc__head" aria-expanded="false" aria-controls="${id}">
        <span class="svc__title">${s.t}</span>
        <span class="svc__plus" aria-hidden="true"></span>
      </button>
      <div class="svc__body" id="${id}"><div class="svc__inner"><div class="svc__content">
        <p>${s.d}</p>
        <div class="svc__tags">${s.tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>
      </div></div></div>`;
    ul.appendChild(li);
  });
  ul.addEventListener('click', e => {
    const head = e.target.closest('.svc__head');
    if (!head) return;
    const row = head.parentElement;
    const open = !row.classList.contains('is-open');
    $$('.svc__row.is-open', ul).forEach(r => { r.classList.remove('is-open'); $('.svc__head', r).setAttribute('aria-expanded', 'false'); });
    row.classList.toggle('is-open', open);
    head.setAttribute('aria-expanded', open);
  });
})();

/* ---------------------------------------------------------------------
   04 Maintenance clock
   --------------------------------------------------------------------- */
(function clock() {
  const odo = $('#odo'), input = $('#miles'), list = $('#dueList');
  const DIGITS = 6;
  const cols = [];
  for (let i = 0; i < DIGITS; i++) {
    const d = document.createElement('span');
    d.className = 'odo__d';
    const col = document.createElement('span');
    col.className = 'odo__col';
    col.innerHTML = Array.from({ length: 10 }, (_, n) => `<span>${n}</span>`).join('');
    d.appendChild(col); odo.appendChild(d); cols.push(col);
  }
  const unit = document.createElement('span');
  unit.className = 'odo__unit'; unit.textContent = 'MILES';
  odo.appendChild(unit);

  list.innerHTML = INTERVALS.map(it => `
    <li><span class="due__name">${it.n}</span><span class="due__left"></span><span class="due__bar"><i></i></span></li>`).join('');
  const rows = $$('li', list);

  function update() {
    const m = +input.value;
    input.style.setProperty('--p', (m / input.max) * 100 + '%');
    String(m).padStart(DIGITS, '0').split('').forEach((d, i) => { cols[i].style.transform = `translateY(-${d}em)`; });
    INTERVALS.forEach((it, i) => {
      const into = m % it.every;
      const next = m - into + it.every;
      const left = next - m;
      const row = rows[i];
      const due = m > 0 && (into === 0 || left <= 1000);
      const soon = !due && left <= it.every * 0.2;
      row.classList.toggle('is-due', due);
      row.classList.toggle('is-soon', soon);
      row.querySelector('i').style.setProperty('--p', m === 0 ? 0 : (into === 0 ? 1 : into / it.every));
      const note = it.note ? ` · ${it.note}` : '';
      row.querySelector('.due__left').textContent = due
        ? `Due now · ${(into === 0 ? m : next).toLocaleString('en-GB')} mi`
        : `In ${left.toLocaleString('en-GB')} mi${note}`;
    });
  }
  input.addEventListener('input', update);
  update();
})();

/* ---------------------------------------------------------------------
   05 Warning lights
   --------------------------------------------------------------------- */
(function lights() {
  const dash = $('#dash');
  dash.innerHTML = LIGHTS.map(l => `
    <button class="dash__light" role="tab" data-id="${l.id}" data-sev="${l.sev}" aria-label="${l.title}">
      <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[l.id]}</svg>
    </button>`).join('');

  function select(id) {
    const l = LIGHTS.find(x => x.id === id);
    $$('.dash__light', dash).forEach(b => { const on = b.dataset.id === id; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on); });
    const sev = $('#lightSev');
    sev.style.setProperty('--c', SEV[l.sev][1]);
    sev.querySelector('span').textContent = SEV[l.sev][0];
    swap($('#lightBody'), () => { $('#lightBody h3').textContent = l.title; $('#lightBody p').textContent = l.what; });
    swap($('#lightDo'), () => { $('#lightDo').textContent = l.act; });
  }
  dash.addEventListener('click', e => { const b = e.target.closest('.dash__light'); if (b) select(b.dataset.id); });
  select('engine');
})();

/* ---------------------------------------------------------------------
   07 Booking job card (opens the visitor's email app — no backend)
   --------------------------------------------------------------------- */
(function book() {
  const chips = $('#chips'), listEl = $('#ticketList'), hoursEl = $('#ticketHours');
  const fine = $('#ticketFine'), fineDefault = fine.textContent;
  chips.innerHTML = BOOK.map((b, i) => `<button type="button" class="chip" aria-pressed="false" data-i="${i}">${b.n}</button>`).join('');
  const picked = new Set();

  function render() {
    const items = [...picked].map(i => BOOK[i]);
    const hrs = items.reduce((a, b) => a + (b.h || 0), 0);
    hoursEl.textContent = hrs % 1 ? hrs.toFixed(1) : hrs;
    listEl.innerHTML = items.length
      ? items.map(b => `<li><span>${b.n}</span><span>${b.h ? b.h + ' h' : 'Quote'}</span></li>`).join('')
      : '<li class="empty">Pick a service to start your job card.</li>';
  }
  chips.addEventListener('click', e => {
    const c = e.target.closest('.chip');
    if (!c) return;
    const i = +c.dataset.i;
    picked.has(i) ? picked.delete(i) : picked.add(i);
    c.setAttribute('aria-pressed', picked.has(i));
    render();
  });
  $('#fReg').addEventListener('input', e => { $('#ticketReg').textContent = e.target.value.toUpperCase() || '—'; });

  $('#bookForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#fName').value.trim(), phone = $('#fPhone').value.trim();
    if (!picked.size || !name || !phone) {
      fine.textContent = !picked.size ? 'Pick at least one service first.' : 'Add your name and phone so we can call you back.';
      fine.style.color = 'var(--signal)';
      return;
    }
    fine.textContent = fineDefault; fine.style.color = '';
    const reg = $('#fReg').value.trim().toUpperCase(), car = $('#fCar').value.trim();
    const body = [
      `Name: ${name}`, `Phone: ${phone}`, `Registration: ${reg || '-'}`, `Car: ${car || '-'}`, '',
      'Work requested:', ...[...picked].map(i => `- ${BOOK[i].n}`)
    ].join('\n');
    location.href = `mailto:${WORKSHOP_EMAIL}?subject=${encodeURIComponent('Booking request' + (reg ? ' — ' + reg : ''))}&body=${encodeURIComponent(body)}`;
    $('#ticket').classList.add('is-sent');
    $('#submitTxt').textContent = 'Job card ready ✓';
    fine.textContent = 'Your email app should open with the job card filled in. Hit send and we\'ll call you back.';
  });
  render();
})();

/* ---------------------------------------------------------------------
   Footer wordmark: fit to full width
   --------------------------------------------------------------------- */
function fitFooter() {
  const w = $('#footerWord');
  const cs = getComputedStyle(w.parentElement);
  const avail = w.parentElement.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  w.style.fontSize = '100px';
  const ratio = avail / w.getBoundingClientRect().width;
  w.style.fontSize = (100 * ratio * 0.995) + 'px';
}
addEventListener('resize', fitFooter);
