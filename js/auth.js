// Mirai Vote Hub - Authentication, Access Control & Dynamic Eligibility Engine
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
  collection,
  getDocs,
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Session State
export const state = {
  currentUser: null,
  role: null, // 'student' | 'admin'
  studentData: null, // { rollNo, name, email, dept, hasVoted, isRegistered }
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
export async function checkStudentEligibility(studentId, electionId = "cse-aiml-a") {
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
    const electionId = enterBtn ? (enterBtn.dataset.electionId || "cse-aiml-a") : "cse-aiml-a";
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

// Account Claiming & Student Authentication
export async function claimStudentBallot(rollNo, passkey) {
  const normalizedRoll = rollNo.trim().toUpperCase();
  const spinner = document.getElementById("claimSpinner");
  const claimBtn = document.getElementById("claimBallotBtn");
  
  if (!normalizedRoll) {
    showAlert("Please enter a valid Roll Number.", "error");
    return false;
  }

  if (!passkey) {
    showAlert("Please enter a security passkey / PIN.", "error");
    return false;
  }

  try {
    if (spinner) spinner.classList.remove("hidden");
    if (claimBtn) claimBtn.disabled = true;

    // 1. Ensure Firebase anonymous session for decoupled communication
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }

    const hashedInput = await hashPasskey(passkey);

    // 2. Query users collection: users/{studentId}
    const userRef = doc(db, "users", normalizedRoll);
    const userSnap = await getDoc(userRef);

    let isNewRegistration = false;

    if (!userSnap.exists() || !userSnap.data().isRegistered) {
      // First-time claiming: Set passkey, hash it, and flag isRegistered: true
      isNewRegistration = true;
      await setDoc(userRef, {
        rollNo: normalizedRoll,
        passkeyHash: hashedInput,
        isRegistered: true,
        claimedAt: serverTimestamp(),
        lastLoginAt: serverTimestamp()
      }, { merge: true });

      showAlert(`Account claimed! Passkey registered for ${normalizedRoll}.`, "success");
    } else {
      // Existing registered student: verify credentials
      const userData = userSnap.data();
      const storedHash = userData.passkeyHash;

      // Check stored hash or legacy plaintext match
      if (storedHash && storedHash !== hashedInput) {
        showAlert("Invalid passkey for this registered Roll Number.", "error");
        return false;
      } else if (!storedHash && userData.passkey && userData.passkey !== passkey) {
        showAlert("Invalid passkey for this registered Roll Number.", "error");
        return false;
      }

      // Update last login
      await updateDoc(userRef, { lastLoginAt: serverTimestamp() }).catch(() => {});
    }

    // 3. Query Whitelist Record for Eligibility and Voter State
    const rootWhitelistRef = doc(db, "whitelist", normalizedRoll);
    const rootWhitelistSnap = await getDoc(rootWhitelistRef);
    const whitelistData = rootWhitelistSnap.exists() ? rootWhitelistSnap.data() : {};

    // 4. Construct Session State
    state.studentData = {
      rollNo: normalizedRoll,
      name: whitelistData.name || `Student ${normalizedRoll}`,
      dept: whitelistData.dept || "CSE (AI/ML)",
      hasVoted: whitelistData.hasVoted === true,
      votedAt: whitelistData.votedAt || null,
      receiptHash: whitelistData.receiptHash || null,
      isRegistered: true
    };
    state.role = "student";
    state.isAdmin = false;

    // 5. Persist Session via localStorage
    localStorage.setItem("mirai_vote_session", JSON.stringify({
      rollNo: state.studentData.rollNo,
      name: state.studentData.name,
      dept: state.studentData.dept,
      role: "student",
      timestamp: Date.now()
    }));

    // 6. Update UI & Eligibility across election cards
    updateNavForRole();
    await updateElectionCardsEligibility(normalizedRoll);

    // If already voted, present the sealed cryptographic confirmation view
    if (state.studentData.hasVoted) {
      showAlreadyVoted(state.studentData);
    } else {
      unlockBallotUI(state.studentData);
      if (!isNewRegistration) {
        showAlert(`Welcome back, ${state.studentData.name}! Credentials verified.`, "success");
      }
    }

    return true;

  } catch (error) {
    console.error("Ballot claim / login error:", error);
    showAlert(`Authentication failed: ${error.message}`, "error");
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
  localStorage.removeItem("mirai_vote_session");
  state.currentUser = null;
  state.role = null;
  state.studentData = null;
  state.isAdmin = false;

  // Reset UI
  document.getElementById("electionListView")?.classList.remove("hidden");
  document.getElementById("ballotView")?.classList.add("hidden");
  if (authSection) authSection.classList.add("hidden");
  if (votingSection) votingSection.classList.add("hidden");
  if (votedSuccessSection) votedSuccessSection.classList.add("hidden");
  if (userProfile) userProfile.classList.add("hidden");
  if (tabAdminBtn) tabAdminBtn.classList.add("hidden");

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
      userDisplayName.textContent = "Election Officer";
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
      dept: data.dept || session.dept || "CSE (AI/ML)",
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
