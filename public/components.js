// Shared Components - Header, Footer, and Theme Toggle
// Include this single script in all pages for consistent navigation
// This is the SINGLE SOURCE OF TRUTH for header, footer, and theme functionality

document.addEventListener('DOMContentLoaded', function() {
  // --- Header Component ---
  if (!document.querySelector('.header')) {
    const headerHTML = `
    <header class="header">
      <div class="container header-row">
        <a href="/" class="brand"><img src="/assets/logo.svg" alt="Logo" class="logo"/> <span style="color:var(--primary);">Downloader-World</span></a>
        <button id="mobile-menu-toggle" class="mobile-menu-toggle" aria-label="Toggle menu" aria-expanded="false">
          <span class="material-symbols-outlined icon" aria-hidden="true">menu</span>
        </button>
        <nav class="nav" id="main-nav">
          <a href="/#supported-platforms">Supported Platforms</a>
          <a href="/#how-it-works">How it Works</a>
          <a href="/terms.html">Terms</a>
          <a href="/privacy.html">Privacy</a>
          <a href="/about.html">About</a>
          <a href="/contact.html">Contact</a>
          <a href="/disclaimer.html">Disclaimer</a>
        </nav>
        <div class="actions">
          <button id="theme-toggle" class="theme-btn" aria-label="Toggle dark mode">
            <span class="material-symbols-outlined icon icon-moon" aria-hidden="true">dark_mode</span>
            <span class="material-symbols-outlined icon icon-sun" aria-hidden="true">light_mode</span>
          </button>
        </div>
      </div>
    </header>
    `;
    document.body.insertAdjacentHTML('afterbegin', headerHTML);
  }
  
  // --- Mobile Menu Toggle Functionality ---
  const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
  const mainNav = document.getElementById('main-nav');
  
  if (mobileMenuToggle && mainNav) {
    mobileMenuToggle.addEventListener('click', function() {
      const isOpen = mainNav.classList.toggle('open');
      mobileMenuToggle.setAttribute('aria-expanded', isOpen);
      mobileMenuToggle.classList.toggle('active');
    });
    
    // Close menu when clicking on a link
    mainNav.querySelectorAll('a').forEach(function(link) {
      link.addEventListener('click', function() {
        mainNav.classList.remove('open');
        mobileMenuToggle.classList.remove('active');
        mobileMenuToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }
  
  // --- Footer Component ---
  if (!document.querySelector('.footer')) {
    const footerHTML = `
    <footer class="footer">
      <div class="container footer-inner">
        <small>© 2026 Social Media Video Downloader. All rights reserved.</small>
        <div style="display:flex;gap:16px;flex-wrap:wrap;justify-content:center;">
          <a href="/privacy.html">Privacy</a>
          <a href="/terms.html">Terms</a>
          <a href="/disclaimer.html">Disclaimer</a>
          <a href="/about.html">About</a>
          <a href="/contact.html">Contact</a>
        </div>
      </div>
    </footer>
    `;
    document.body.insertAdjacentHTML('beforeend', footerHTML);
  }
  
  // --- Theme Toggle Functionality ---
  const root = document.documentElement;
  const themeToggleBtn = document.getElementById('theme-toggle');
  
  function applyInitialTheme() {
    const saved = localStorage.getItem('color-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if ((saved === 'dark') || (!saved && prefersDark)) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }
  
  applyInitialTheme();
  
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', function() {
      root.classList.toggle('dark');
      localStorage.setItem('color-theme', root.classList.contains('dark') ? 'dark' : 'light');
    });
  }
});
