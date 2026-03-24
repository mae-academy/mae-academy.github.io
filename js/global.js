// =========================
// Global Page Transitions & Core Utilities
// =========================

function __initGlobalTransitions() {
  // Reveal page safely
  document.body.style.opacity = '1';

  // --------------------------------------------------
  // 1. SMOOTH SCROLL (Animated Section Navigation)
  // --------------------------------------------------
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href || !href.startsWith('#') || href === '#') return;

    const target = document.querySelector(href);
    if (!target) return;

    e.preventDefault();

    // -- PHASE 2: BUTTON FEEDBACK --
    link.classList.add('nav-clicked');
    setTimeout(() => link.classList.remove('nav-clicked'), 200);

    // -- PHASE 3: SMOOTH SCROLL WITH OFFSET --
    const headerH = document.querySelector("header, .topbar")?.offsetHeight || 0;
    const targetY = target.getBoundingClientRect().top + window.scrollY - headerH;

    window.scrollTo({
      top: targetY,
      behavior: 'smooth'
    });

    // -- PHASE 4: DETECT SCROLL END --
    let timeout;
    const onScroll = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        window.removeEventListener('scroll', onScroll);

        // ONLY NOW trigger animation
        target.classList.add('section-focus');

        setTimeout(() => {
          target.classList.remove('section-focus');
        }, 600);
      }, 120);
    };

    window.addEventListener('scroll', onScroll);
  });

  // --------------------------------------------------
  // 2. CENTRALIZED REVEAL OBSERVER (single instance)
  // --------------------------------------------------
  const revealEls = document.querySelectorAll(".reveal");

  if ("IntersectionObserver" in window) {
    if (revealEls.length > 0) {
      const revealObserver = new IntersectionObserver((entries, obs) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("isVisible");
            obs.unobserve(entry.target);
          }
        }
      }, { threshold: 0.14 });

      revealEls.forEach(el => revealObserver.observe(el));
    }
  } else {
    // Fallback: IntersectionObserver not supported — show everything
    revealEls.forEach(el => el.classList.add("isVisible"));
  }

  // --------------------------------------------------
  // 3. PAGE TRANSITIONS (robust — works on any hosting)
  // --------------------------------------------------
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;

    const rawHref = link.getAttribute('href') || '';
    if (!rawHref) return;

    // Skip: hash links, mailto/tel, javascript:, modified clicks, new-tab, download
    if (
      rawHref.startsWith('#') ||
      rawHref.startsWith('mailto:') ||
      rawHref.startsWith('tel:') ||
      rawHref.startsWith('javascript:') ||
      link.target ||
      link.hasAttribute('download') ||
      e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0
    ) return;

    // Resolve the full URL (handles relative paths on any host)
    let resolved;
    try {
      resolved = new URL(rawHref, window.location.href);
    } catch (_) {
      return; // malformed — let browser handle it
    }

    // Skip external links (different origin = external)
    if (resolved.origin !== window.location.origin) return;

    // Skip if it's the same page (same path + same search)
    if (resolved.pathname === window.location.pathname && resolved.search === window.location.search) return;

    // --- Valid internal link: trigger fade-out then navigate ---
    e.preventDefault();
    const destination = resolved.href;

    console.log('Internal navigation:', destination);

    document.body.style.opacity = '0';
    document.body.style.transform = 'scale(0.98)';

    setTimeout(() => {
      window.location.href = destination;
    }, 300);
  });

  // Guarantee fade-in on every page load (normal + bfcache)
  const fadeIn = () => {
    document.body.style.opacity = '1';
    document.body.style.transform = 'scale(1)';
  };
  window.addEventListener('pageshow', fadeIn);
  window.addEventListener('load', fadeIn);

  // --------------------------------------------------
  // 4. STICKY NAVBAR SHADOW (passive scroll)
  // --------------------------------------------------
  const headerEl = document.querySelector("header, .topbar");

  if (headerEl) {
    window.addEventListener("scroll", () => {
      if (window.scrollY > 10) {
        headerEl.classList.add("scrolled");
      } else {
        headerEl.classList.remove("scrolled");
      }
    }, { passive: true });
  }

  // --------------------------------------------------
  // 5. SCROLL SPY FOR NAVBAR (IntersectionObserver)
  // --------------------------------------------------
  const allSections = document.querySelectorAll("section[id], main[id]");
  const navLinks = document.querySelectorAll("header nav a[href^='#'], .topbar nav a[href^='#']");

  // Filter to only sections with valid (non-empty) IDs
  const sections = Array.from(allSections).filter(s => s.id && s.id.trim() !== '');

  if (sections.length > 0 && navLinks.length > 0) {
    const observerOptions = {
      rootMargin: "-80px 0px -60% 0px",
      threshold: 0.3
    };

    const sectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          navLinks.forEach(link => link.classList.remove("active"));
          const activeLink = document.querySelector(
            `header nav a[href="#${CSS.escape(entry.target.id)}"], .topbar nav a[href="#${CSS.escape(entry.target.id)}"]`
          );
          if (activeLink) {
            activeLink.classList.add("active");
          }
        }
      });
    }, observerOptions);

    sections.forEach(section => {
      sectionObserver.observe(section);
    });

    const activateInitial = () => {
      if (window.scrollY <= 80) {
        navLinks.forEach(link => link.classList.remove("active"));
        const firstSection = sections[0];
        if (firstSection) {
          const firstLink = document.querySelector(
            `header nav a[href="#${CSS.escape(firstSection.id)}"], .topbar nav a[href="#${CSS.escape(firstSection.id)}"]`
          );
          if (firstLink) firstLink.classList.add("active");
        }
      }
    };

    window.addEventListener("load", activateInitial);
    window.addEventListener("scroll", activateInitial, { passive: true });

    const firstSectionId = sections[0] ? sections[0].id : "top";
    document.querySelectorAll(`a[href="#${CSS.escape(firstSectionId)}"]`).forEach(link => {
      link.addEventListener("click", () => {
        navLinks.forEach(l => l.classList.remove("active"));
        const firstLink = document.querySelector(
          `header nav a[href="#${CSS.escape(firstSectionId)}"], .topbar nav a[href="#${CSS.escape(firstSectionId)}"]`
        );
        if (firstLink) firstLink.classList.add("active");
      });
    });
  }
}

// Ensure execution happens safely with global fail-safe
const __safeRestore = () => {
  document.body.style.opacity = '1';
  document.body.style.transform = 'scale(1)';
};

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  try {
    __initGlobalTransitions();
  } catch (err) {
    console.error("Global UX system failed:", err);
    __safeRestore();
  }
} else {
  window.addEventListener('DOMContentLoaded', () => {
    try {
      __initGlobalTransitions();
    } catch (err) {
      console.error("Global UX system failed:", err);
      __safeRestore();
    }
  });
  window.addEventListener('load', __safeRestore);
}

