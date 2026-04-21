(() => {
  "use strict";

  const sidebar = document.getElementById("sidebar");
  const toggle = document.getElementById("sidebarToggle");
  const navLinks = document.querySelectorAll(".nav-link");
  const sections = document.querySelectorAll("main .section");

  const closeSidebar = () => {
    sidebar.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("no-scroll");
  };

  const openSidebar = () => {
    sidebar.classList.add("is-open");
    toggle.setAttribute("aria-expanded", "true");
    document.body.classList.add("no-scroll");
  };

  toggle.addEventListener("click", () => {
    sidebar.classList.contains("is-open") ? closeSidebar() : openSidebar();
  });

  navLinks.forEach((link) => {
    link.addEventListener("click", () => {
      if (sidebar.classList.contains("is-open")) closeSidebar();
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sidebar.classList.contains("is-open")) {
      closeSidebar();
      toggle.focus();
    }
  });

  const emailLink = document.getElementById("emailLink");
  if (emailLink && navigator.clipboard && navigator.clipboard.writeText) {
    const label = emailLink.querySelector(".link-label");
    const originalText = label ? label.textContent : "email";
    let revertTimer = null;

    emailLink.addEventListener("click", (e) => {
      e.preventDefault();
      const email = emailLink.dataset.email;
      navigator.clipboard.writeText(email).then(
        () => {
          if (!label) return;
          clearTimeout(revertTimer);
          label.textContent = "copied!";
          emailLink.classList.add("is-copied");
          revertTimer = setTimeout(() => {
            label.textContent = originalText;
            emailLink.classList.remove("is-copied");
          }, 1500);
        },
        () => {
          window.location.href = emailLink.href;
        }
      );
    });
  }

  if ("IntersectionObserver" in window && sections.length) {
    const setActive = (id) => {
      navLinks.forEach((link) => {
        link.classList.toggle("is-active", link.dataset.section === id);
      });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible.length) setActive(visible[0].target.id);
      },
      { rootMargin: "-40% 0px -55% 0px", threshold: [0, 0.25, 0.5, 1] }
    );

    sections.forEach((s) => observer.observe(s));
  }
})();
