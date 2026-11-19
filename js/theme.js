// Mirai Vote Hub - Theme Engine (Light / Dark Mode Controller)

export function initThemeToggle() {
  const toggleBtn = document.getElementById("themeToggleBtn");
  const toggleIcon = toggleBtn?.querySelector(".theme-toggle-icon");

  function getActiveTheme() {
    return document.documentElement.getAttribute("data-theme") || localStorage.getItem("mirai-vote-theme") || "dark";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("mirai-vote-theme", theme);

    if (toggleIcon) {
      // In dark mode: Show sun icon (click to switch to light)
      // In light mode: Show moon icon (click to switch to dark)
      toggleIcon.textContent = theme === "dark" ? "☀️" : "🌙";
    }

    if (toggleBtn) {
      toggleBtn.setAttribute("title", `Switch to ${theme === "dark" ? "Light" : "Dark"} Mode`);
      toggleBtn.setAttribute("aria-label", `Switch to ${theme === "dark" ? "Light" : "Dark"} Mode`);
    }
  }

  // Sync initial button state
  const currentTheme = getActiveTheme();
  applyTheme(currentTheme);

  // Click handler
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const current = getActiveTheme();
      const next = current === "dark" ? "light" : "dark";
      applyTheme(next);
    });
  }
}

// Auto-initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initThemeToggle);
} else {
  initThemeToggle();
}
