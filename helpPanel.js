/* ─────────────────────────────────────────────────────────────
   helpPanel.js  –  Mathgabs shared help / info dropdown panel
   ───────────────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────────────
   Mobile viewport height fix — sets body height to the true
   visible area (window.innerHeight) so flex:1 on <main> always
   pushes the footer flush to the bottom on every mobile browser.
   ───────────────────────────────────────────────────────────── */
(function setMobileViewportHeight() {
  function apply() {
    if (window.innerWidth > 900) return;   // desktop: leave CSS alone
    document.body.style.height = window.innerHeight + 'px';
  }

  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => {
    // Brief delay so innerHeight has updated after rotation
    setTimeout(apply, 150);
  });
})();

(function () {
  /* ── Panel HTML ───────────────────────────────────────────── */
  const PANEL_HTML = `
<div id="help-panel-overlay" onclick="closeHelpPanel(event)">
  <div id="help-panel">

    <div id="help-panel-header">
      <span id="help-panel-title"><i class="fa-solid fa-circle-info"></i> &nbsp;Help &amp; Info</span>
      <button id="help-panel-close" onclick="toggleHelpPanel()">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>

    <!-- Getting Started -->
    <div class="hp-section">
      <button class="hp-tab" onclick="hpToggle(this)">
        <i class="fa-solid fa-rocket"></i> Getting Started
        <i class="fa-solid fa-chevron-down hp-chevron"></i>
      </button>
      <div class="hp-body">
        <ol class="hp-steps">
          <li><strong>Home page</strong> – Browse all available tools from the home page. Each card links to a tool.</li>
          <li><strong>ODE Solver</strong> – Navigate to <em>ODE</em> in the nav-bar. Type your differential equation in the input field using standard notation (e.g. <code>y' = -2y + sin(x)</code>).</li>
          <li><strong>Set initial conditions</strong> – Enter the initial value(s) (e.g. <code>y(0) = 1</code>) in the IVP fields.</li>
          <li><strong>Choose a method</strong> – Select a numerical method from the dropdown (Euler, RK4, RK45 …). Higher-order methods give more accurate results.</li>
          <li><strong>Set step size &amp; range</strong> – Enter the step size <code>h</code> and the interval <code>[x₀, xₙ]</code> over which to solve.</li>
          <li><strong>Solve</strong> – Click the <em>Solve</em> button. Results appear as a table and a plot.</li>
          <li><strong>Plots tool</strong> – Navigate to <em>Plots</em> to graph any function interactively.</li>
          <li><strong>Support</strong> – Click the ❤ icon in the nav-bar to visit the support &amp; contact page.</li>
        </ol>
      </div>
    </div>

    <!-- Documentation -->
    <div class="hp-section">
      <button class="hp-tab" onclick="hpToggle(this)">
        <i class="fa-solid fa-book-open"></i> Documentation
        <i class="fa-solid fa-chevron-down hp-chevron"></i>
      </button>
      <div class="hp-body">
        <div class="hp-doc-block">
          <h4>Euler's Method</h4>
          <p>The simplest explicit one-step method. Given <code>y' = f(x,y)</code>:</p>
          <code class="hp-formula">yₙ₊₁ = yₙ + h · f(xₙ, yₙ)</code>
          <p>First-order accurate — error ∝ h. Best for quick estimates on smooth problems.</p>
        </div>
        <div class="hp-doc-block">
          <h4>Runge–Kutta 4 (RK4)</h4>
          <p>A classic four-stage method. Computes four intermediate slopes and combines them:</p>
          <code class="hp-formula">k₁ = f(xₙ, yₙ)<br>k₂ = f(xₙ+h/2, yₙ+h·k₁/2)<br>k₃ = f(xₙ+h/2, yₙ+h·k₂/2)<br>k₄ = f(xₙ+h, yₙ+h·k₃)<br>yₙ₊₁ = yₙ + h(k₁+2k₂+2k₃+k₄)/6</code>
          <p>Fourth-order accurate — error ∝ h⁴. The gold standard for most IVPs.</p>
        </div>
        <div class="hp-doc-block">
          <h4>RK45 (Dormand–Prince)</h4>
          <p>An adaptive step-size method that pairs a 4th-order and 5th-order RK estimate to control local error automatically. The step <code>h</code> is shrunk or grown each iteration:</p>
          <code class="hp-formula">h_new = h · (tol / err)^(1/5)</code>
          <p>Ideal for stiff or rapidly varying solutions where a fixed step would be either too slow or too inaccurate.</p>
        </div>
        <div class="hp-doc-block">
          <h4>Adams–Bashforth (2-step)</h4>
          <p>A linear multi-step predictor that re-uses previously computed derivatives:</p>
          <code class="hp-formula">yₙ₊₁ = yₙ + h(3f(xₙ,yₙ) − f(xₙ₋₁,yₙ₋₁))/2</code>
          <p>Second-order accurate, very efficient once started (uses RK4 for the first step).</p>
        </div>
        <div class="hp-doc-block">
          <h4>Heun's Method (Improved Euler)</h4>
          <p>A predictor–corrector method: predict with Euler, then correct with the average slope:</p>
          <code class="hp-formula">ỹₙ₊₁ = yₙ + h·f(xₙ,yₙ)<br>yₙ₊₁ = yₙ + h(f(xₙ,yₙ) + f(xₙ₊₁,ỹₙ₊₁))/2</code>
          <p>Second-order accurate — a good middle ground between Euler and RK4.</p>
        </div>
      </div>
    </div>

    <!-- Terms of Service -->
    <div class="hp-section">
      <button class="hp-tab" onclick="hpToggle(this)">
        <i class="fa-solid fa-scale-balanced"></i> Terms of Service
        <i class="fa-solid fa-chevron-down hp-chevron"></i>
      </button>
      <div class="hp-body">
        <p class="hp-tos-date">Last updated: June 2026</p>
        <div class="hp-tos-item"><strong>1. Free to Use</strong><p>All tools on Mathgabs are provided free of charge for personal, educational, and non-commercial use. No account or registration is required.</p></div>
        <div class="hp-tos-item"><strong>2. No Warranty</strong><p>Mathgabs is provided "as is". Numerical results are approximations — always verify critical calculations independently. We make no guarantee of accuracy for any specific use case.</p></div>
        <div class="hp-tos-item"><strong>3. No Data Collection</strong><p>We do not collect, store, or share any personal data. Calculations are performed entirely in your browser and are never transmitted to our servers.</p></div>
        <div class="hp-tos-item"><strong>4. Intellectual Property</strong><p>All content, code, and design on Mathgabs is the intellectual property of AB / AB Research Corp. You may not reproduce or redistribute site code without written permission.</p></div>
        <div class="hp-tos-item"><strong>5. Acceptable Use</strong><p>You agree not to misuse these tools for illegal purposes, attempt to reverse-engineer the source, or use automated scripts to overload the service.</p></div>
        <div class="hp-tos-item"><strong>6. Changes</strong><p>We reserve the right to modify these terms at any time. Continued use of the site constitutes acceptance of the updated terms.</p></div>
        <div class="hp-tos-item"><strong>7. Contact</strong><p>For any legal queries, contact us at <a href="mailto:masshiggsboson@gmail.com">masshiggsboson@gmail.com</a>.</p></div>
      </div>
    </div>

    <!-- Support Links -->
    <div class="hp-section">
      <button class="hp-tab" onclick="hpToggle(this)">
        <i class="fa-solid fa-heart"></i> Support Links
        <i class="fa-solid fa-chevron-down hp-chevron"></i>
      </button>
      <div class="hp-body">
        <div class="hp-support-links">
          <a href="https://patreon.com/AnonyAB" class="hp-link patreon" target="_blank"><i class="fa-brands fa-patreon"></i> Patreon</a>
          <a href="https://ko-fi.com/anonymousdevilliers" class="hp-link kofi" target="_blank"><i class="fa-solid fa-mug-hot"></i> Ko-fi</a>
          <a href="https://devilliers0.gumroad.com/" class="hp-link gumroad" target="_blank"><i class="fa-solid fa-bag-shopping"></i> Gumroad</a>
          <a href="https://www.youtube.com/@Math-gabs" class="hp-link youtube" target="_blank"><i class="fa-brands fa-youtube"></i> YouTube</a>
          <a href="support.html" class="hp-link contact"><i class="fa-solid fa-envelope"></i> Contact &amp; Bugs</a>
        </div>
      </div>
    </div>

  </div>
</div>`;

  /* ── Inject on DOM ready ──────────────────────────────────── */
  function init() {
    // Inject panel
    const wrapper = document.createElement('div');
    wrapper.innerHTML = PANEL_HTML.trim();
    document.body.appendChild(wrapper.firstChild);

    // Wire up search button
    const btn = document.querySelector('.search-icon');
    if (btn) btn.addEventListener('click', toggleHelpPanel);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ── Public API ───────────────────────────────────────────── */
  window.toggleHelpPanel = function () {
    const overlay = document.getElementById('help-panel-overlay');
    const panel = document.getElementById('help-panel');
    if (!overlay) return;
    const open = overlay.classList.toggle('hp-open');
    panel.classList.toggle('hp-panel-open', open);
  };

  window.closeHelpPanel = function (e) {
    // Close only when clicking the dark overlay, not the panel itself
    if (e.target.id === 'help-panel-overlay') {
      const overlay = document.getElementById('help-panel-overlay');
      overlay.classList.remove('hp-open');
      document.getElementById('help-panel').classList.remove('hp-panel-open');
    }
  };

  window.hpToggle = function (btn) {
    const section = btn.closest('.hp-section');
    const body = section.querySelector('.hp-body');
    const isOpen = section.classList.contains('hp-section-open');

    // Close all open sections first
    document.querySelectorAll('.hp-section.hp-section-open').forEach(s => {
      s.classList.remove('hp-section-open');
      s.querySelector('.hp-body').style.maxHeight = null;
    });

    if (!isOpen) {
      section.classList.add('hp-section-open');
      body.style.maxHeight = body.scrollHeight + 'px';
    }
  };
})();

/* ─────────────────────────────────────────────────────────────
   Mobile Nav — active item in bar (left), social links (right),
   tap active item → dropdown overlay; tap social link → closes
   dropdown but active bar item always stays visible (CSS-driven)
   ───────────────────────────────────────────────────────────── */
(function initMobileNav() {
  function setup() {
    if (window.innerWidth > 768) return;

    const navBar = document.querySelector('.nav-bar');
    if (!navBar) return;

    const mainUl = navBar.querySelector('ul:not(#social-links)');
    if (!mainUl) return;

    // If this page has no .active in the main nav (e.g. games.html where
    // active is on the social icon), fall back to marking first li active
    // so CSS always renders something in the bar.
    if (!mainUl.querySelector('li.active')) {
      const first = mainUl.querySelector('li');
      if (first) first.classList.add('active');
    }

    const activeItem = mainUl.querySelector('li.active');
    if (!activeItem) return;

    // Guard against double-init
    if (navBar.dataset.mobileNavInit) return;
    navBar.dataset.mobileNavInit = '1';

    // Tap active item when CLOSED → open dropdown (don't navigate)
    // Tap active item when OPEN  → navigate normally
    activeItem.addEventListener('click', (e) => {
      if (!navBar.classList.contains('nav-open')) {
        e.preventDefault();
        e.stopPropagation();
        navBar.classList.add('nav-open');
      }
      // already open: let the anchor navigate
    });

    // Close dropdown when click lands OUTSIDE the main nav UL.
    // Social links ARE outside mainUl, so clicking them closes the
    // dropdown — but the active bar item is always shown by CSS (not JS),
    // so it never "disappears" from the bar.
    document.addEventListener('click', (e) => {
      if (!mainUl.contains(e.target)) {
        navBar.classList.remove('nav-open');
      }
    }, true); // capture phase so it fires before link navigation
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }

  // Restore desktop state on resize
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      const navBar = document.querySelector('.nav-bar');
      if (navBar) navBar.classList.remove('nav-open');
    }
  });
})();

/* ─────────────────────────────────────────────────────────────
   Logo click → navigate home (works on every page)
   ───────────────────────────────────────────────────────────── */
(function () {
  function bindLogo() {
    const logo = document.getElementById('gabs_icon');
    if (!logo) return;
    logo.style.cursor = 'pointer';
    logo.addEventListener('click', () => {
      window.location.href = 'index.html';
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindLogo);
  } else {
    bindLogo();
  }
})();
