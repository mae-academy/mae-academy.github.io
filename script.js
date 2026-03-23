document.addEventListener("DOMContentLoaded", () => {
    // ---- Helpers ----
    const prefersReduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Mobile menu hint: jump to sections quickly
    const jumpBtn = document.getElementById("jumpMenu");
    if (jumpBtn) {
      jumpBtn.addEventListener("click", () => {
        const target = document.querySelector("#tracks");
        if (target) target.scrollIntoView({ behavior: "smooth" });
      });
    }

    // Hero buttons
    const btnCourses = document.getElementById("btnCourses");
    if (btnCourses) {
      btnCourses.addEventListener("click", () => {
        const target = document.querySelector("#tracks");
        if (target) target.scrollIntoView({ behavior: "smooth" });
      });
    }

    // NOTE: .reveal observer is centralized in /js/global.js — do not duplicate here

    // Animated counters
    const counters = document.querySelectorAll(".count");
    let started = false;

    function animateCount(el, target, duration = 1100) {
      const start = performance.now();
      const from = 0;

      function frame(now) {
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        const val = Math.floor(from + (target - from) * eased);
        el.textContent = val.toLocaleString("en");
        if (p < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }

    const hero = document.querySelector(".hero");
    if (hero && "IntersectionObserver" in window) {
      const io2 = new IntersectionObserver((entries, obs) => {
        for (const e of entries) {
          if (e.isIntersecting && !started) {
            started = true;
            counters.forEach(c => animateCount(c, Number(c.dataset.target || 0)));
            obs.disconnect();
          }
        }
      }, { threshold: 0.35 });
      io2.observe(hero);
    } else {
      // fallback
      counters.forEach(c => animateCount(c, Number(c.dataset.target || 0)));
    }

    // Testimonials slider (add null-guards)
    const slides = document.getElementById("slides");
    const dotsWrap = document.getElementById("dots");
    const prevBtn = document.getElementById("prev");
    const nextBtn = document.getElementById("next");

    if (slides && dotsWrap && prevBtn && nextBtn) {
      const total = slides.children.length;
      let idx = 0;

      function renderDots() {
        dotsWrap.innerHTML = "";
        for (let i = 0; i < total; i++) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "dotbtn" + (i === idx ? " active" : "");
          b.addEventListener("click", () => go(i));
          dotsWrap.appendChild(b);
        }
      }

      function go(i) {
        idx = (i + total) % total;
        slides.style.transform = `translateX(-${idx * 100}%)`;
        renderDots();
      }

      prevBtn.addEventListener("click", () => go(idx - 1));
      nextBtn.addEventListener("click", () => go(idx + 1));
      go(0);

      // Auto advance (don’t animate if reduced motion)
      setInterval(() => {
        if (!prefersReduce()) go(idx + 1);
      }, 6500);
    }

    // FAQ accordion (guard)
    document.querySelectorAll(".faqItem").forEach(item => {
      const q = item.querySelector(".faqQ");
      if (!q) return;
      q.addEventListener("click", () => item.classList.toggle("open"));
    });

    // Demo form submit (guard)
    const contactForm = document.getElementById("contactForm");
    if (contactForm) {
      contactForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const msg = document.getElementById("formMsg");
        if (!msg) return;

        const formData = new FormData(contactForm);
        const payload = {
          name: formData.get("name"),
          email: formData.get("email"),
          subject: formData.get("subject"),
          message: formData.get("message")
        };

        msg.style.color = "var(--text)";
        msg.textContent = "Sending...";

        try {
          const response = await fetch("/api/send_mail.php", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
          });

          const result = await response.json();

          if (response.ok && result.success) {
            msg.style.color = "var(--success, #08b58d)";
            msg.textContent = "Message sent successfully ✅";
            e.target.reset();
          } else {
            msg.style.color = "var(--danger, #ff3b30)";
            msg.textContent = result.error || "Failed to send message.";
          }
        } catch (error) {
          msg.style.color = "var(--danger, #ff3b30)";
          msg.textContent = "Network error. Please try again.";
        }

        setTimeout(() => {
          if (msg.textContent.includes("successfully")) {
            msg.textContent = "";
          }
        }, 4500);
      });
    }



    // Year (guard)
    const yearEl = document.getElementById("year");
    if (yearEl) yearEl.textContent = new Date().getFullYear();
});
