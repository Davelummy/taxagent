const yearEl = document.getElementById("year");
if (yearEl) {
  yearEl.textContent = new Date().getFullYear();
}

const navs = document.querySelectorAll(".nav");
navs.forEach((nav) => {
  const toggleLabel = nav.querySelector(".nav-toggle");
  const toggleInput = nav.querySelector(".nav-toggle-input");
  if (!toggleLabel || !toggleInput) return;

  const syncExpanded = () => {
    toggleLabel.setAttribute("aria-expanded", toggleInput.checked ? "true" : "false");
  };
  syncExpanded();

  toggleInput.addEventListener("change", syncExpanded);
  nav.addEventListener("click", (event) => {
    if (event.target.closest(".nav-links a") || event.target.closest(".dashboard-links a")) {
      toggleInput.checked = false;
      syncExpanded();
    }
  });
});

const revealItems = document.querySelectorAll("[data-reveal]");
if (revealItems.length > 0) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.2 }
  );

  revealItems.forEach((item) => observer.observe(item));
}
