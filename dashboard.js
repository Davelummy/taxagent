const dashboardToggle = document.getElementById("dashboard-toggle");
const dashboardSidebar = document.getElementById("dashboard-sidebar");

if (dashboardToggle && dashboardSidebar) {
  let userToggled = false;
  let dragMoved = false;
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  const mediaQuery = window.matchMedia("(max-width: 980px)");
  const setExpandedState = () => {
    const isCollapsed = dashboardSidebar.classList.contains("is-collapsed");
    dashboardToggle.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
  };

  const syncForViewport = () => {
    if (userToggled) return;
    if (mediaQuery.matches) {
      dashboardSidebar.classList.add("is-collapsed");
    } else {
      dashboardSidebar.classList.remove("is-collapsed");
      dashboardSidebar.style.left = "";
      dashboardSidebar.style.top = "";
      dashboardSidebar.style.bottom = "";
    }
    setExpandedState();
  };

  syncForViewport();

  dashboardToggle.addEventListener("click", (event) => {
    if (dragMoved) {
      dragMoved = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    userToggled = true;
    dashboardSidebar.classList.toggle("is-collapsed");
    setExpandedState();
  });

  mediaQuery.addEventListener("change", syncForViewport);

  const onPointerDown = (event) => {
    if (!dashboardSidebar.classList.contains("is-collapsed")) return;
    dragMoved = false;
    isDragging = true;
    const rect = dashboardSidebar.getBoundingClientRect();
    dragOffsetX = event.clientX - rect.left;
    dragOffsetY = event.clientY - rect.top;
    dashboardSidebar.classList.add("is-dragging");
    dashboardSidebar.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (!isDragging) return;
    const rect = dashboardSidebar.getBoundingClientRect();
    const deltaX = event.clientX - rect.left - dragOffsetX;
    const deltaY = event.clientY - rect.top - dragOffsetY;
    if (!dragMoved && (Math.abs(deltaX) > 6 || Math.abs(deltaY) > 6)) {
      dragMoved = true;
    }
    if (!dragMoved) return;
    const width = rect.width;
    const height = rect.height;
    const maxLeft = window.innerWidth - width - 8;
    const maxTop = window.innerHeight - height - 8;
    const left = Math.min(Math.max(event.clientX - dragOffsetX, 8), Math.max(maxLeft, 8));
    const top = Math.min(Math.max(event.clientY - dragOffsetY, 8), Math.max(maxTop, 8));
    dashboardSidebar.style.left = `${left}px`;
    dashboardSidebar.style.top = `${top}px`;
    dashboardSidebar.style.bottom = "auto";
    event.preventDefault();
  };

  const onPointerUp = (event) => {
    if (!isDragging) return;
    isDragging = false;
    dashboardSidebar.classList.remove("is-dragging");
    dashboardSidebar.releasePointerCapture(event.pointerId);
  };

  dashboardSidebar.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
}
