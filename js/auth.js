// Mirai Vote Hub - Authentication, Access Control & Dynamic Eligibility Engine
// Mirai School of Technology

import { auth, db } from "./firebase-config.js";
import { 
  signInAnonymously, 
  signOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  doc, 
  getDoc, 
  setDoc,
  updateDoc, 
  collection,
  getDocs,
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { authenticateAdmin } from "./admin.js";
import { getCurrentElectionId } from "./voting.js";

// Session State
export const state = {
  currentUser: null,
  role: null, // 'student' | 'admin'
  studentData: null, // { rollNo, name, email, section, hasVoted, isRegistered }
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

// Dynamic Two-Step Auth Elements
let currentActiveElectionId = "section-a";
let pendingRollNumber = "";
let pendingWhitelistData = null;

window.addEventListener("electionSelected", (e) => {
  if (e.detail && e.detail.id) {
    currentActiveElectionId = e.detail.id;
  }
});

let alertTimer = null;

// Show alert banner
export function showAlert(message, type = "info") {
  if (!alertBanner || !alertMessage) return;
  alertBanner.className = `alert-banner ${type}`;
  alertMessage.textContent = message;
  alertBanner.classList.remove("hidden");
  alertBanner.style.display = "flex";

  if (alertTimer) clearTimeout(alertTimer);
  alertTimer = setTimeout(() => {
    alertBanner.classList.add("hidden");
    alertBanner.style.display = "none";
  }, 5000);
}

if (alertDismiss) {
  alertDismiss.addEventListener("click", () => {
    if (alertBanner) {
      alertBanner.classList.add("hidden");
      alertBanner.style.display = "none";
    }
  });
}

// Cryptographic SHA-256 Hash Function for Passkeys
export async function hashPasskey(passkey) {
  if (!passkey) return "";
  const encoder = new TextEncoder();
  const data = encoder.encode(passkey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// Dynamic Eligibility Checker for a Specific Election
export async function checkStudentEligibility(studentId, electionId = "section-a") {
  if (!studentId) return { eligible: false, hasVoted: false, status: "ineligible" };
  const normalizedId = studentId.trim().toUpperCase();

  try {
    // 1. Query election-specific whitelist subcollection: elections/{electionId}/whitelist/{studentId}
    const electionWhitelistRef = doc(db, "elections", electionId, "whitelist", normalizedId);
    const electionWhitelistSnap = await getDoc(electionWhitelistRef);

    if (electionWhitelistSnap.exists()) {
      const data = electionWhitelistSnap.data();
      const hasVoted = data.hasVoted === true;
      return {
        eligible: !hasVoted,
        hasVoted: hasVoted,
        status: hasVoted ? "already_voted" : "whitelisted",
        data: data
      };
    }

    // 2. Query root whitelist collection: whitelist/{studentId}
    const rootWhitelistRef = doc(db, "whitelist", normalizedId);
    const rootWhitelistSnap = await getDoc(rootWhitelistRef);

    if (rootWhitelistSnap.exists()) {
      const data = rootWhitelistSnap.data();
      const hasVoted = data.hasVoted === true;
      return {
        eligible: !hasVoted,
        hasVoted: hasVoted,
        status: hasVoted ? "already_voted" : "whitelisted",
        data: data
      };
    }

    // Not on whitelist
    return {
      eligible: false,
      hasVoted: false,
      status: "ineligible"
    };

  } catch (err) {
    console.error(`Eligibility check error for ${studentId} on ${electionId}:`, err);
    return { eligible: false, hasVoted: false, status: "error" };
  }
}

// Update Active Election Cards with Visual Eligibility Badges
export async function updateElectionCardsEligibility(studentId) {
  if (!studentId) return;
  const cards = document.querySelectorAll(".election-card");

  for (const card of cards) {
    const enterBtn = card.querySelector(".enter-election-btn");
    const electionId = enterBtn ? (enterBtn.dataset.electionId || "section-a") : "section-a";
    const metaContainer = card.querySelector(".election-meta-specs");

    const result = await checkStudentEligibility(studentId, electionId);

    // Remove existing eligibility indicator if any
    card.querySelectorAll(".election-eligibility-spec").forEach(el => el.remove());

    const specRow = document.createElement("div");
    specRow.className = "meta-spec-item election-eligibility-spec col-span-2";

    if (result.status === "whitelisted") {
      specRow.innerHTML = `
        <span class="spec-label">Your Voting Status</span>
        <span class="spec-value highlight-cyan">✓ Whitelisted &bull; Ballot Access Authorized</span>
      `;
      if (enterBtn) {
        enterBtn.disabled = false;
        enterBtn.innerHTML = `<span>Enter Voting Booth 🗳️</span>`;
      }
    } else if (result.status === "already_voted") {
      specRow.innerHTML = `
        <span class="spec-label">Your Voting Status</span>
        <span class="spec-value" style="color: var(--neon-emerald)">✓ Ballot Cast &bull; Decoupled &amp; Sealed</span>
      `;
      if (enterBtn) {
        enterBtn.disabled = false;
        enterBtn.innerHTML = `<span>View Sealed Receipt 📜</span>`;
      }
    } else {
      specRow.innerHTML = `
        <span class="spec-label">Your Voting Status</span>
        <span class="spec-value highlight-magenta">✕ Ineligible &bull; Not on Whitelist</span>
      `;
      if (enterBtn) {
        enterBtn.disabled = true;
        enterBtn.innerHTML = `<span>Access Ineligible 🔒</span>`;
      }
    }

    if (metaContainer) {
      metaContainer.appendChild(specRow);
    }
  }
}

// Reset Dynamic Two-Step Auth View back to Step 1
export function resetAuthFlow() {
  pendingRollNumber = "";
  pendingWhitelistData = null;

  const authCardTitle = document.getElementById("authCardTitle");
  const authCardSubtitle = document.getElementById("authCardSubtitle");
  const studentRollForm = document.getElementById("studentRollForm");
  const createPasskeyForm = document.getElementById("createPasskeyForm");
  const verifyPasskeyForm = document.getElementById("verifyPasskeyForm");

  if (studentRollForm) studentRollForm.classList.remove("hidden");
  if (createPasskeyForm) createPasskeyForm.classList.add("hidden");
  if (verifyPasskeyForm) verifyPasskeyForm.classList.add("hidden");

  if (authCardTitle) authCardTitle.textContent = "Student Identity Verification";
  if (authCardSubtitle) authCardSubtitle.textContent = "Enter your official university Roll Number or Student ID to access your digital ballot.";

  const studentRollInput = document.getElementById("studentRollInput");
  const newPassInput = document.getElementById("newPassInput");
  const confirmPassInput = document.getElementById("confirmPassInput");
  const studentPassInput = document.getElementById("studentPassInput");

  if (studentRollInput) studentRollInput.value = "";
  if (newPassInput) newPassInput.value = "";
  if (confirmPassInput) confirmPassInput.value = "";
  if (studentPassInput) studentPassInput.value = "";
}

// STEP 1: Verify Whitelist & Determine Case A (New) vs Case B (Returning)
export async function verifyStudentRoll(rollNo) {
  const normalizedRoll = (rollNo || "").trim().toUpperCase();
  const checkRollBtn = document.getElementById("checkRollBtn");
  const checkRollSpinner = document.getElementById("checkRollSpinner");

  if (!normalizedRoll) {
    showAlert("Please enter a valid Roll Number.", "error");
    return false;
  }

  try {
    if (checkRollSpinner) checkRollSpinner.classList.remove("hidden");
    if (checkRollBtn) checkRollBtn.disabled = true;

    // 1. Ensure Firebase anonymous session for communication
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }

    const targetElectionId = currentActiveElectionId || (typeof getCurrentElectionId === "function" ? getCurrentElectionId() : "section-a");

    // 2. Check Whitelist First: Verify elections/{electionId}/whitelist/{studentId} exists
    let wlData = null;
    const electionWlRef = doc(db, "elections", targetElectionId, "whitelist", normalizedRoll);
    const electionWlSnap = await getDoc(electionWlRef);

    if (electionWlSnap.exists()) {
      wlData = electionWlSnap.data();
    } else {
      // Fallback: check global root whitelist
      const rootWlRef = doc(db, "whitelist", normalizedRoll);
      const rootWlSnap = await getDoc(rootWlRef);
      if (rootWlSnap.exists()) {
        wlData = rootWlSnap.data();
      }
    }

    if (!wlData) {
      showAlert("Roll Number not whitelisted for this election.", "error");
      return false;
    }

    if (wlData.hasVoted === true) {
      showAlert("You have already cast your official ballot in this election.", "error");
      showAlreadyVoted({ rollNo: normalizedRoll, ...wlData });
      return false;
    }

    // Whitelisted & not voted yet!
    pendingRollNumber = normalizedRoll;
    pendingWhitelistData = wlData;

    // 3. Check User Credential Record: users/{studentId}
    const userRef = doc(db, "users", normalizedRoll);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.exists() ? userSnap.data() : null;
    const hasPasskey = Boolean(userData && (userData.passkey || userData.passkeyHash || userData.pin));

    const authCardTitle = document.getElementById("authCardTitle");
    const authCardSubtitle = document.getElementById("authCardSubtitle");
    const studentRollForm = document.getElementById("studentRollForm");
    const createPasskeyForm = document.getElementById("createPasskeyForm");
    const verifyPasskeyForm = document.getElementById("verifyPasskeyForm");

    if (!hasPasskey) {
      // Case A — New Student (No passkey saved yet):
      // Switch cleanly to "Create Your Personal Voting Passkey" mode
      if (studentRollForm) studentRollForm.classList.add("hidden");
      if (verifyPasskeyForm) verifyPasskeyForm.classList.add("hidden");
      if (createPasskeyForm) createPasskeyForm.classList.remove("hidden");

      if (authCardTitle) authCardTitle.textContent = "Create Your Personal Voting Passkey";
      if (authCardSubtitle) authCardSubtitle.textContent = "As a first-time voter, set a secure Passkey or PIN to protect your ballot.";

      const idRollEl = document.getElementById("identifiedRollCreate");
      if (idRollEl) idRollEl.textContent = normalizedRoll;

      const newPassInput = document.getElementById("newPassInput");
      const confirmPassInput = document.getElementById("confirmPassInput");
      if (newPassInput) { newPassInput.value = ""; newPassInput.focus(); }
      if (confirmPassInput) confirmPassInput.value = "";

      showAlert(`Roll Number '${normalizedRoll}' verified! Please create your personal passkey.`, "success");
    } else {
      // Case B — Returning Student (Has saved passkey):
      // Display "Enter Your Voting Passkey"
      if (studentRollForm) studentRollForm.classList.add("hidden");
      if (createPasskeyForm) createPasskeyForm.classList.add("hidden");
      if (verifyPasskeyForm) verifyPasskeyForm.classList.remove("hidden");

      if (authCardTitle) authCardTitle.textContent = "Enter Your Voting Passkey";
      if (authCardSubtitle) authCardSubtitle.textContent = "Enter your secret passkey / PIN to unlock the official ballot booth.";

      const idRollEl = document.getElementById("identifiedRollVerify");
      if (idRollEl) idRollEl.textContent = normalizedRoll;

      const studentPassInput = document.getElementById("studentPassInput");
      if (studentPassInput) { studentPassInput.value = ""; studentPassInput.focus(); }
    }

    return true;

  } catch (err) {
    console.error("Student roll verification error:", err);
    showAlert(`Verification failed: ${err.message}`, "error");
    return false;
  } finally {
    if (checkRollSpinner) checkRollSpinner.classList.add("hidden");
    if (checkRollBtn) checkRollBtn.disabled = false;
  }
}

// STEP 2A: Create Passkey / PIN for New Student
export async function createStudentPasskey(newPass, confirmPass) {
  const roll = pendingRollNumber;
  if (!roll) {
    showAlert("Session expired. Please enter your Roll Number again.", "error");
    resetAuthFlow();
    return false;
  }

  const pass = (newPass || "").trim();
  const confirm = (confirmPass || "").trim();

  if (pass.length < 4) {
    showAlert("Passkey must be at least 4 characters.", "error");
    return false;
  }

  if (pass !== confirm) {
    showAlert("Passkeys do not match. Please re-enter.", "error");
    return false;
  }

  const setPasskeyBtn = document.getElementById("setPasskeyBtn");
  const setPasskeySpinner = document.getElementById("setPasskeySpinner");

  try {
    if (setPasskeySpinner) setPasskeySpinner.classList.remove("hidden");
    if (setPasskeyBtn) setPasskeyBtn.disabled = true;

    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }

    const hashedInput = await hashPasskey(pass);
    const userRef = doc(db, "users", roll);

    // Save passkey credential record
    await setDoc(userRef, {
      rollNo: roll,
      passkey: pass,
      passkeyHash: hashedInput,
      isRegistered: true,
      createdAt: Date.now(),
      lastLoginAt: serverTimestamp()
    }, { merge: true });

    const wlData = pendingWhitelistData || {};

    // Establish student session
    state.studentData = {
      rollNo: roll,
      name: wlData.name || `Student ${roll}`,
      section: wlData.section || "Section A",
      hasVoted: false,
      votedAt: null,
      receiptHash: null,
      isRegistered: true
    };
    state.role = "student";
    state.isAdmin = false;

    // Persist session
    localStorage.setItem("mirai_vote_session", JSON.stringify({
      rollNo: state.studentData.rollNo,
      name: state.studentData.name,
      section: state.studentData.section,
      role: "student",
      timestamp: Date.now()
    }));

    updateNavForRole();
    await updateElectionCardsEligibility(roll);
    unlockBallotUI(state.studentData);
    showAlert(`Passkey created successfully! Welcome to the voting booth, ${state.studentData.name}.`, "success");
    return true;

  } catch (err) {
    console.error("Create passkey error:", err);
    showAlert(`Failed to set passkey: ${err.message}`, "error");
    return false;
  } finally {
    if (setPasskeySpinner) setPasskeySpinner.classList.add("hidden");
    if (setPasskeyBtn) setPasskeyBtn.disabled = false;
  }
}

// STEP 2B: Verify Passkey for Returning Student
export async function verifyStudentPasskey(passkey) {
  const roll = pendingRollNumber;
  if (!roll) {
    showAlert("Session expired. Please enter your Roll Number again.", "error");
    resetAuthFlow();
    return false;
  }

  const pass = (passkey || "").trim();
  if (!pass) {
    showAlert("Please enter your security passkey / PIN.", "error");
    return false;
  }

  const claimSpinner = document.getElementById("claimSpinner");
  const claimBtn = document.getElementById("claimBallotBtn");

  try {
    if (claimSpinner) claimSpinner.classList.remove("hidden");
    if (claimBtn) claimBtn.disabled = true;

    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }

    const userRef = doc(db, "users", roll);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      showAlert("User record not found. Please re-enter your Roll Number.", "error");
      resetAuthFlow();
      return false;
    }

    const userData = userSnap.data();
    const hashedInput = await hashPasskey(pass);

    const isMatch = (userData.passkeyHash && userData.passkeyHash === hashedInput) ||
                    (userData.passkey && userData.passkey === pass) ||
                    (userData.pin && userData.pin === pass);

    if (!isMatch) {
      showAlert("Invalid passkey for this Roll Number. Contact Election Admin to reset.", "error");
      return false;
    }

    // Update last login
    await updateDoc(userRef, { lastLoginAt: serverTimestamp() }).catch(() => {});

    const wlData = pendingWhitelistData || {};

    state.studentData = {
      rollNo: roll,
      name: wlData.name || `Student ${roll}`,
      section: wlData.section || "Section A",
      hasVoted: wlData.hasVoted === true,
      votedAt: wlData.votedAt || null,
      receiptHash: wlData.receiptHash || null,
      isRegistered: true
    };
    state.role = "student";
    state.isAdmin = false;

    localStorage.setItem("mirai_vote_session", JSON.stringify({
      rollNo: state.studentData.rollNo,
      name: state.studentData.name,
      section: state.studentData.section,
      role: "student",
      timestamp: Date.now()
    }));

    updateNavForRole();
    await updateElectionCardsEligibility(roll);

    if (state.studentData.hasVoted) {
      showAlreadyVoted(state.studentData);
    } else {
      unlockBallotUI(state.studentData);
      showAlert(`Welcome back, ${state.studentData.name}! Credentials verified.`, "success");
    }

    return true;

  } catch (err) {
    console.error("Passkey verification error:", err);
    showAlert(`Authentication failed: ${err.message}`, "error");
    return false;
  } finally {
    if (claimSpinner) claimSpinner.classList.add("hidden");
    if (claimBtn) claimBtn.disabled = false;
  }
}

// Backward-compatible entrypoint
export async function claimStudentBallot(rollNo, passkey) {
  const ok = await verifyStudentRoll(rollNo);
  if (!ok) return false;
  if (passkey) {
    return await verifyStudentPasskey(passkey);
  }
  return true;
}

// Sign out handler
export async function performLogout() {
  await signOut(auth);
  localStorage.removeItem("mirai_vote_session");
  sessionStorage.removeItem("isAdminAuthenticated");
  state.currentUser = null;
  state.role = null;
  state.studentData = null;
  state.isAdmin = false;

  resetAuthFlow();

  // Reset UI
  document.getElementById("electionListView")?.classList.remove("hidden");
  document.getElementById("ballotView")?.classList.add("hidden");
  if (authSection) authSection.classList.add("hidden");
  if (votingSection) votingSection.classList.add("hidden");
  if (votedSuccessSection) votedSuccessSection.classList.add("hidden");
  if (userProfile) userProfile.classList.add("hidden");
  if (tabAdminBtn) tabAdminBtn.classList.add("hidden");

  const adminToggleBtn = document.getElementById("adminToggleBtn");
  if (adminToggleBtn) adminToggleBtn.classList.remove("hidden");

  // Reset eligibility indicators on cards
  document.querySelectorAll(".election-eligibility-spec").forEach(el => el.remove());
  document.querySelectorAll(".enter-election-btn").forEach(btn => {
    btn.disabled = false;
    btn.innerHTML = `<span>Enter Voting Booth 🗳️</span>`;
  });

  // Switch to active elections tab
  document.getElementById("tabElectionsBtn")?.click();
  showAlert("Session signed out.", "info");
}

function updateNavForRole() {
  if (userProfile && (state.studentData || state.isAdmin)) {
    userProfile.classList.remove("hidden");
    if (state.isAdmin) {
      userDisplayName.textContent = "Admin Officer";
      userRoleBadge.textContent = "ADMIN";
      userRoleBadge.style.color = "var(--neon-amber)";
      if (tabAdminBtn) tabAdminBtn.classList.remove("hidden");
    } else {
      userDisplayName.textContent = state.studentData.name || state.studentData.rollNo;
      userRoleBadge.textContent = "VOTER";
      userRoleBadge.style.color = "var(--neon-cyan)";
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
  if (ballotDept) ballotDept.textContent = `Cohort: ${student.section || 'Section A'}`;

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
    receiptTs.textContent = student.votedAt?.toDate ? student.votedAt.toDate().toLocaleString() : (student.votedAt || "Confirmed on Ledger");
  }
  if (receiptHash) {
    receiptHash.textContent = student.receiptHash || `0x${Array.from(student.rollNo).map(c=>c.charCodeAt(0).toString(16)).join('')}SEALED`;
  }

  showAlert("Your ballot has already been cast and recorded. Zero duplicate voting strictly enforced.", "info");
}

// Restore Persistent Session on Load
export async function initSession() {
  try {
    const rawSession = localStorage.getItem("mirai_vote_session");
    if (!rawSession) return;

    const session = JSON.parse(rawSession);
    if (!session || !session.rollNo) return;

    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }

    // Refresh state from Firestore
    const rootWhitelistRef = doc(db, "whitelist", session.rollNo);
    const rootWhitelistSnap = await getDoc(rootWhitelistRef);
    const data = rootWhitelistSnap.exists() ? rootWhitelistSnap.data() : {};

    state.studentData = {
      rollNo: session.rollNo,
      name: data.name || session.name || `Student ${session.rollNo}`,
      section: data.section || session.section || "Section A",
      hasVoted: data.hasVoted === true,
      votedAt: data.votedAt || null,
      receiptHash: data.receiptHash || null,
      isRegistered: true
    };
    state.role = "student";
    state.isAdmin = false;

    updateNavForRole();
    await updateElectionCardsEligibility(session.rollNo);

  } catch (err) {
    console.warn("Session restore exception:", err);
  }
}

// Attach Form Listeners
document.addEventListener("DOMContentLoaded", () => {
  initSession();

  // Step 1: Roll Number Entry Form
  const rollForm = document.getElementById("studentRollForm");
  if (rollForm) {
    rollForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const roll = document.getElementById("studentRollInput")?.value;
      verifyStudentRoll(roll);
    });
  }

  // Step 2A: Create Passkey Form (New Student)
  const createForm = document.getElementById("createPasskeyForm");
  if (createForm) {
    createForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const newPass = document.getElementById("newPassInput")?.value;
      const confirmPass = document.getElementById("confirmPassInput")?.value;
      createStudentPasskey(newPass, confirmPass);
    });
  }

  // Step 2B: Verify Passkey Form (Returning Student)
  const verifyForm = document.getElementById("verifyPasskeyForm");
  if (verifyForm) {
    verifyForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const pass = document.getElementById("studentPassInput")?.value;
      verifyStudentPasskey(pass);
    });
  }

  // Change Roll Number buttons
  document.querySelectorAll(".btn-change-roll").forEach(btn => {
    btn.addEventListener("click", () => {
      resetAuthFlow();
      document.getElementById("studentRollInput")?.focus();
    });
  });

  // Legacy student claim form support if present
  const claimForm = document.getElementById("studentClaimForm");
  if (claimForm) {
    claimForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const roll = document.getElementById("studentRollInput")?.value;
      const pass = document.getElementById("studentPassInput")?.value;
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
});
