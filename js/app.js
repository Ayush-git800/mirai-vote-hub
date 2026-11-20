// Mirai Vote Hub - Master Application Orchestrator
// Binds UI, Admin Access Modal, and Theme controls synchronously before Firestore network calls

import { authenticateAdmin } from "./admin.js";
import { initThemeToggle } from "./theme.js";

// 1. Immediately bind Admin Access Modal and synchronous UI controls
export function bindImmediateUIControls() {
  const adminToggleBtn = document.getElementById("adminToggleBtn");
  const adminModal = document.getElementById("adminLoginModal");
  const closeAdminBtn = document.getElementById("closeAdminLoginModal");
  const adminForm = document.getElementById("adminLoginForm");
  const adminEmailInput = document.getElementById("adminEmailInput");
  const adminPassInput = document.getElementById("adminPasswordInput");

  // Admin Access Button - Opens login modal immediately
  if (adminToggleBtn && adminModal) {
    adminToggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      adminModal.classList.remove("hidden");
      adminModal.style.display = "flex";
      setTimeout(() => {
        if (adminEmailInput) adminEmailInput.focus();
      }, 50);
    });
  }

  // Close Admin Modal Button
  if (closeAdminBtn && adminModal) {
    closeAdminBtn.addEventListener("click", () => {
      adminModal.classList.add("hidden");
      adminModal.style.display = "none";
    });
  }

  // Close on modal backdrop click
  if (adminModal) {
    adminModal.addEventListener("click", (e) => {
      if (e.target === adminModal) {
        adminModal.classList.add("hidden");
        adminModal.style.display = "none";
      }
    });
  }

  // Admin Login Form Submission
  if (adminForm) {
    adminForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const user = adminEmailInput?.value || "";
      const pass = adminPassInput?.value || "";
      authenticateAdmin(user, pass);
    });
  }

  // Initialize theme toggle immediately
  initThemeToggle();
}

// 2. Global Startup Fallback Guard (Stops endless spinners if Firestore is idle/slow)
export function initStartupGuard() {
  const statusLabel = document.getElementById("globalElectionStatusLabel");
  const electionsGrid = document.getElementById("electionsGrid");

  // Fallback after 3.5s if Firestore initial snapshot hasn't resolved
  setTimeout(() => {
    const loadingEl = document.getElementById("electionsLoading");
    if (loadingEl && electionsGrid && electionsGrid.contains(loadingEl)) {
      if (statusLabel && (statusLabel.textContent === "Checking Status..." || !statusLabel.textContent)) {
        statusLabel.textContent = "Ledger Ready";
        statusLabel.style.color = "#64748b";
      }

      electionsGrid.innerHTML = `
        <div class="empty-elections-card col-span-full">
          <div class="empty-icon">🗳️</div>
          <h3>Campus Democracy Ledger</h3>
          <p>The election ledger is active. No cohort elections are currently open for voting.</p>
          <small>Election Commission officers can authenticate via 'Admin Access' to launch an election.</small>
        </div>
      `;
    }
  }, 3500);
}

// Run immediately or on DOMContentLoaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    bindImmediateUIControls();
    initStartupGuard();
  });
} else {
  bindImmediateUIControls();
  initStartupGuard();
}
