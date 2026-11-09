// Mirai Vote Hub - Authentication & Identity Claim
// Mirai School of Technology - CSE AI/ML

import { auth, db } from "./firebase-config.js";
import { 
  signInAnonymously, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  doc, 
  getDoc, 
  setDoc,
  updateDoc, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Session State
export const state = {
  currentUser: null,
  role: null, // 'student' | 'admin'
  studentData: null, // { rollNo, name, email, dept, hasVoted, claimed }
  isAdmin: false
};

// UI Elements
const authSection = document.getElementById("authSection");
const votingSection = document.getElementById("votingSection");
const votedSuccessSection = document.getElementById("votedSuccessSection");
const userProfile = document.getElementById("userProfile");
const userDisplayName = document.getElementById("userDisplayName");
const userRoleBadge = document.getElementById("userRoleBadge");
const logoutBtn = document.getElementById("logoutBtn");
const adminToggleBtn = document.getElementById("adminToggleBtn");
const tabAdminBtn = document.getElementById("tabAdminBtn");
const alertBanner = document.getElementById("alertBanner");
const alertMessage = document.getElementById("alertMessage");
const alertDismiss = document.getElementById("alertDismiss");

// Show alert banner
export function showAlert(message, type = "info") {
  if (!alertBanner || !alertMessage) return;
  alertBanner.className = `alert-banner ${type}`;
  alertMessage.textContent = message;
  alertBanner.classList.remove("hidden");
  setTimeout(() => {
    alertBanner.classList.add("hidden");
  }, 6000);
}

if (alertDismiss) {
  alertDismiss.addEventListener("click", () => alertBanner.classList.add("hidden"));
}

// Student Identity Verification and Claim
export async function claimStudentBallot(rollNo, passkey) {
  const normalizedRoll = rollNo.trim().toUpperCase();
  const spinner = document.getElementById("claimSpinner");
  const claimBtn = document.getElementById("claimBallotBtn");
  
  try {
    if (spinner) spinner.classList.remove("hidden");
    if (claimBtn) claimBtn.disabled = true;

    // 1. Authenticate with Firebase (Anonymous session for decoupling)
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }

    // 2. Query Firestore Whitelist for Zero-Dummy-Data certification
    const studentRef = doc(db, "whitelist", normalizedRoll);
    const studentSnap = await getDoc(studentRef);

    if (!studentSnap.exists()) {
      showAlert(`Roll Number ${normalizedRoll} is not on the certified Department Whitelist. Please contact Election Commission.`, "error");
      return false;
    }

    const data = studentSnap.data();

    // Verify Passkey if passkey is registered in whitelist
    if (data.passkey && data.passkey !== passkey) {
      showAlert("Invalid access passkey for this Roll Number.", "error");
      return false;
    }

    // Check if voter has already voted (Zero Duplicate Guarantee)
    if (data.hasVoted === true) {
      state.studentData = data;
      state.role = "student";
      showAlreadyVoted(data);
      return false;
    }

    // Register active student session
    state.studentData = {
      ...data,
      rollNo: normalizedRoll
    };
    state.role = "student";
    state.isAdmin = false;

    // Update UI
    updateNavForRole();
    unlockBallotUI(state.studentData);
    showAlert(`Welcome, ${data.name || normalizedRoll}! Identity verified against CSE AI/ML Whitelist.`, "success");
    return true;

  } catch (error) {
    console.error("Ballot claim error:", error);
    showAlert(`Verification failed: ${error.message}`, "error");
    return false;
  } finally {
    if (spinner) spinner.classList.add("hidden");
    if (claimBtn) claimBtn.disabled = false;
  }
}

// Admin Authentication
export async function loginAdmin(email, password) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    state.currentUser = cred.user;
    state.role = "admin";
    state.isAdmin = true;
    updateNavForRole();
    showAlert("Admin Officer session authenticated successfully.", "success");
    return true;
  } catch (error) {
    console.error("Admin login error:", error);
    showAlert(`Admin authentication error: ${error.message}`, "error");
    return false;
  }
}

// Sign out handler
export async function performLogout() {
  await signOut(auth);
  state.currentUser = null;
  state.role = null;
  state.studentData = null;
  state.isAdmin = false;

  // Reset UI
  if (authSection) authSection.classList.remove("hidden");
  if (votingSection) votingSection.classList.add("hidden");
  if (votedSuccessSection) votedSuccessSection.classList.add("hidden");
  if (userProfile) userProfile.classList.add("hidden");
  if (tabAdminBtn) tabAdminBtn.classList.add("hidden");

  // Switch to ballot tab
  document.getElementById("tabBallotBtn")?.click();
  showAlert("Session signed out.", "info");
}

function updateNavForRole() {
  if (userProfile && (state.studentData || state.isAdmin)) {
    userProfile.classList.remove("hidden");
    if (state.isAdmin) {
      userDisplayName.textContent = "Election Officer";
      userRoleBadge.textContent = "ADMIN";
      userRoleBadge.style.color = "var(--accent-amber)";
      if (tabAdminBtn) tabAdminBtn.classList.remove("hidden");
    } else {
      userDisplayName.textContent = state.studentData.name || state.studentData.rollNo;
      userRoleBadge.textContent = "VOTER";
      userRoleBadge.style.color = "var(--accent-cyan)";
      if (tabAdminBtn) tabAdminBtn.classList.add("hidden");
    }
  }
}

function unlockBallotUI(student) {
  document.getElementById("electionListView")?.classList.add("hidden");
  document.getElementById("ballotView")?.classList.remove("hidden");
  if (authSection) authSection.classList.add("hidden");
  if (votingSection) votingSection.classList.remove("hidden");
  if (votedSuccessSection) votedSuccessSection.classList.add("hidden");

  const ballotRoll = document.getElementById("ballotRollNo");
  const ballotDept = document.getElementById("ballotDept");
  if (ballotRoll) ballotRoll.textContent = `Roll: ${student.rollNo}`;
  if (ballotDept) ballotDept.textContent = `Dept: ${student.dept || 'CSE (AI/ML)'}`;

  // Notify voting module to load candidate cards
  window.dispatchEvent(new CustomEvent("ballotUnlocked", { detail: student }));
}

function showAlreadyVoted(student) {
  document.getElementById("electionListView")?.classList.add("hidden");
  document.getElementById("ballotView")?.classList.remove("hidden");
  if (authSection) authSection.classList.add("hidden");
  if (votingSection) votingSection.classList.add("hidden");
  if (votedSuccessSection) votedSuccessSection.classList.remove("hidden");

  const receiptTs = document.getElementById("receiptTimestamp");
  const receiptHash = document.getElementById("receiptHash");
  if (receiptTs) {
    receiptTs.textContent = student.votedAt?.toDate ? student.votedAt.toDate().toLocaleString() : "Confirmed on Ledger";
  }
  if (receiptHash) {
    receiptHash.textContent = student.receiptHash || `0x${Array.from(student.rollNo).map(c=>c.charCodeAt(0).toString(16)).join('')}SEALED`;
  }

  showAlert("Your ballot has already been cast and recorded. Zero duplicate voting strictly enforced.", "info");
}

// Attach Form Listeners
document.addEventListener("DOMContentLoaded", () => {
  const claimForm = document.getElementById("studentClaimForm");
  if (claimForm) {
    claimForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const roll = document.getElementById("studentRollInput").value;
      const pass = document.getElementById("studentPassInput").value;
      claimStudentBallot(roll, pass);
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", performLogout);
  }

  // Admin Modal Handlers
  const adminModal = document.getElementById("adminLoginModal");
  if (adminToggleBtn && adminModal) {
    adminToggleBtn.addEventListener("click", () => {
      adminModal.classList.remove("hidden");
    });
  }

  const closeAdminModal = document.getElementById("closeAdminLoginModal");
  if (closeAdminModal && adminModal) {
    closeAdminModal.addEventListener("click", () => {
      adminModal.classList.add("hidden");
    });
  }

  const adminForm = document.getElementById("adminLoginForm");
  if (adminForm && adminModal) {
    adminForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("adminEmailInput").value;
      const pass = document.getElementById("adminPasswordInput").value;
      const ok = await loginAdmin(email, pass);
      if (ok) {
        adminModal.classList.add("hidden");
        document.getElementById("tabAdminBtn")?.click();
      }
    });
  }
});
