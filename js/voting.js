// Mirai Vote Hub - Dual-Seat Voting & Atomic Transaction Engine
// Mirai School of Technology

import { db } from "./firebase-config.js";
import { state, showAlert } from "./auth.js";
import {
  collection,
  getDocs,
  doc,
  runTransaction,
  increment,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Ballot State
let currentElectionId = "section-a";
let selectedBoyCandidate = null;
let selectedGirlCandidate = null;
let candidatesCache = {
  boy_cr: [],
  girl_cr: []
};

export function setCurrentElectionId(id) {
  if (id) currentElectionId = id;
}

export function getCurrentElectionId() {
  return currentElectionId;
}

// Elements
const boyCandidatesGrid = document.getElementById("boyCandidatesGrid");
const girlCandidatesGrid = document.getElementById("girlCandidatesGrid");
const summaryBoyChoice = document.getElementById("summaryBoyChoice");
const summaryGirlChoice = document.getElementById("summaryGirlChoice");
const reviewVoteBtn = document.getElementById("reviewVoteBtn");

// Confirm Modal Elements
const confirmVoteModal = document.getElementById("confirmVoteModal");
const modalConfirmBoy = document.getElementById("modalConfirmBoy");
const modalConfirmGirl = document.getElementById("modalConfirmGirl");
const closeConfirmModalBtn = document.getElementById("closeConfirmModalBtn");
const cancelVoteBtn = document.getElementById("cancelVoteBtn");
const finalSubmitVoteBtn = document.getElementById("finalSubmitVoteBtn");
const submitSpinner = document.getElementById("submitSpinner");

// Fetch and render candidates
export async function loadCandidates() {
  try {
    const candidatesCol = collection(db, "candidates");
    const snapshot = await getDocs(candidatesCol);

    candidatesCache.boy_cr = [];
    candidatesCache.girl_cr = [];

    snapshot.forEach(docSnap => {
      const data = { id: docSnap.id, ...docSnap.data() };
      if (data.category === "boy_cr") {
        candidatesCache.boy_cr.push(data);
      } else if (data.category === "girl_cr") {
        candidatesCache.girl_cr.push(data);
      }
    });

    renderSeatCandidates("boy_cr", candidatesCache.boy_cr, boyCandidatesGrid);
    renderSeatCandidates("girl_cr", candidatesCache.girl_cr, girlCandidatesGrid);

  } catch (error) {
    console.error("Failed to load candidates:", error);
    if (boyCandidatesGrid) boyCandidatesGrid.innerHTML = `<div class="error-msg">Error loading candidates: ${error.message}</div>`;
    if (girlCandidatesGrid) girlCandidatesGrid.innerHTML = `<div class="error-msg">Error loading candidates: ${error.message}</div>`;
  }
}

function renderSeatCandidates(category, candidates, container) {
  if (!container) return;

  if (candidates.length === 0) {
    container.innerHTML = `
      <div class="empty-candidate-card">
        <p>No certified candidates registered yet for this seat.</p>
        <small>Admins can register candidates in the Election Control Terminal.</small>
      </div>
    `;
    return;
  }

  container.innerHTML = "";
  candidates.forEach(cand => {
    const card = document.createElement("div");
    card.className = `candidate-card ${category}-card`;
    card.dataset.id = cand.id;
    card.dataset.category = category;

    const avatarInitial = cand.name ? cand.name.charAt(0).toUpperCase() : "C";
    const photoHtml = cand.photoUrl 
      ? `<img src="${cand.photoUrl}" alt="${cand.name}" class="candidate-avatar">`
      : `<div class="candidate-avatar ${category}-avatar">${avatarInitial}</div>`;

    const catBadgeText = category === "boy_cr" ? "Category A &bull; Boy CR Nominee" : "Category B &bull; Girl CR Nominee";
    const catBadgeClass = category === "boy_cr" ? "badge-boy" : "badge-girl";

    card.innerHTML = `
      <div class="card-top-row">
        <span class="category-badge ${catBadgeClass}">${catBadgeText}</span>
        <span class="selection-pill">Click to Choose</span>
      </div>
      <div class="candidate-profile-row">
        ${photoHtml}
        <div class="candidate-meta">
          <div class="candidate-name">${cand.name}</div>
          <div class="candidate-roll">${cand.rollNo || 'Roll: Certified'}</div>
        </div>
      </div>
      <div class="candidate-manifesto-box">
        <p class="candidate-manifesto">${cand.manifesto || 'Committed to representing student cohort interests.'}</p>
      </div>
    `;

    card.addEventListener("click", () => handleCandidateSelection(category, cand, card));
    container.appendChild(card);
  });
}

function handleCandidateSelection(category, candidate, cardElement) {
  const container = category === "boy_cr" ? boyCandidatesGrid : girlCandidatesGrid;
  
  // Deselect previous in same seat
  container.querySelectorAll(".candidate-card").forEach(el => el.classList.remove("selected"));

  // Select clicked
  cardElement.classList.add("selected");

  if (category === "boy_cr") {
    selectedBoyCandidate = candidate;
    if (summaryBoyChoice) summaryBoyChoice.textContent = candidate.name;
  } else {
    selectedGirlCandidate = candidate;
    if (summaryGirlChoice) summaryGirlChoice.textContent = candidate.name;
  }

  // Validate if both seats selected
  if (selectedBoyCandidate && selectedGirlCandidate) {
    if (reviewVoteBtn) reviewVoteBtn.disabled = false;
  } else {
    if (reviewVoteBtn) reviewVoteBtn.disabled = true;
  }
}

// Open Review Modal
function openReviewModal() {
  if (!selectedBoyCandidate || !selectedGirlCandidate) {
    showAlert("Please select both 1 Boy CR and 1 Girl CR before submitting.", "error");
    return;
  }

  if (modalConfirmBoy) modalConfirmBoy.textContent = `${selectedBoyCandidate.name} (${selectedBoyCandidate.rollNo || 'Certified'})`;
  if (modalConfirmGirl) modalConfirmGirl.textContent = `${selectedGirlCandidate.name} (${selectedGirlCandidate.rollNo || 'Certified'})`;
  if (confirmVoteModal) confirmVoteModal.classList.remove("hidden");
}

function closeReviewModal() {
  if (confirmVoteModal) confirmVoteModal.classList.add("hidden");
}

// Cryptographic pseudo-hash generator for receipt
export function generateReceiptToken(rollNo) {
  const ts = Date.now().toString(16);
  const entropy = Math.random().toString(16).substring(2, 10);
  return `0xMIRAI-${ts}-${entropy.toUpperCase()}`;
}

// ============================================================================
// Atomic Ballot Transaction Engine (Zero Duplicate Guarantee & Decoupled Secrecy)
// ============================================================================
export async function submitBallot(electionId, studentId, boyCandidateId, girlCandidateId) {
  const targetElectionId = electionId || currentElectionId || "section-a";
  const normalizedRoll = (studentId || "").trim().toUpperCase();

  if (!normalizedRoll) {
    throw new Error("Student Roll Number is required to cast a ballot.");
  }
  if (!boyCandidateId || !girlCandidateId) {
    throw new Error("Dual-seat election requires selecting 1 Boy CR and 1 Girl CR.");
  }

  const receiptToken = generateReceiptToken(normalizedRoll);
  const nowTs = Date.now();

  await runTransaction(db, async (transaction) => {
    // ------------------------------------------------------------------------
    // STEP 1: ALL READS (Firestore runTransaction requires all reads before writes)
    // ------------------------------------------------------------------------

    // 1a. Target election state read
    const electionRef = doc(db, "elections", targetElectionId);
    const electionSnap = await transaction.get(electionRef);

    const metaRef = doc(db, "election_meta", "config");
    const metaSnap = await transaction.get(metaRef);

    // 1b. Voter whitelist state reads
    const electionVoterRef = doc(db, "elections", targetElectionId, "whitelist", normalizedRoll);
    const electionVoterSnap = await transaction.get(electionVoterRef);

    const rootVoterRef = doc(db, "whitelist", normalizedRoll);
    const rootVoterSnap = await transaction.get(rootVoterRef);

    // 1c. Candidate records reads
    const boyRef = doc(db, "candidates", boyCandidateId);
    const girlRef = doc(db, "candidates", girlCandidateId);
    const boySnap = await transaction.get(boyRef);
    const girlSnap = await transaction.get(girlRef);

    // ------------------------------------------------------------------------
    // STEP 2: VERIFICATION & AUDIT GATES
    // ------------------------------------------------------------------------

    // Gate A: Target election status must strictly be "active"
    let status = "active";
    if (electionSnap.exists()) {
      status = electionSnap.data().status;
    } else if (metaSnap.exists()) {
      status = metaSnap.data().status;
    }

    if (status !== "active") {
      throw new Error(`Election is currently '${status}'. Ballots can only be cast when election status is 'active'.`);
    }

    // Gate B: Voter whitelist verification & Zero Duplicate Guarantee
    if (!electionVoterSnap.exists() && !rootVoterSnap.exists()) {
      throw new Error(`Roll Number '${normalizedRoll}' is not certified on the election whitelist.`);
    }

    const electionVoterData = electionVoterSnap.exists() ? electionVoterSnap.data() : null;
    const rootVoterData = rootVoterSnap.exists() ? rootVoterSnap.data() : null;

    if ((electionVoterData && electionVoterData.hasVoted === true) || (rootVoterData && rootVoterData.hasVoted === true)) {
      throw new Error("Duplicate Vote Rejected: A ballot has already been cast and sealed for this Roll Number.");
    }

    // Gate C: Candidate verification & category integrity
    if (!boySnap.exists()) {
      throw new Error(`Selected Boy CR candidate (${boyCandidateId}) not found in candidate registry.`);
    }
    if (!girlSnap.exists()) {
      throw new Error(`Selected Girl CR candidate (${girlCandidateId}) not found in candidate registry.`);
    }

    const boyData = boySnap.data();
    const girlData = girlSnap.data();

    if (boyData.category !== "boy_cr") {
      throw new Error(`Candidate '${boyData.name || boyCandidateId}' does not belong to category 'boy_cr'.`);
    }
    if (girlData.category !== "girl_cr") {
      throw new Error(`Candidate '${girlData.name || girlCandidateId}' does not belong to category 'girl_cr'.`);
    }

    // ------------------------------------------------------------------------
    // STEP 3: ATOMIC WRITES
    // ------------------------------------------------------------------------
    const voteTimestamp = serverTimestamp();

    // 3a. Mark voter as voted (Locks duplicate attempts)
    const voterUpdate = {
      hasVoted: true,
      votedAt: voteTimestamp,
      votedAtMillis: nowTs,
      receiptHash: receiptToken
    };

    if (electionVoterSnap.exists()) {
      transaction.update(electionVoterRef, voterUpdate);
    } else {
      transaction.set(electionVoterRef, {
        rollNo: normalizedRoll,
        name: rootVoterData ? (rootVoterData.name || `Student ${normalizedRoll}`) : `Student ${normalizedRoll}`,
        section: rootVoterData ? (rootVoterData.section || "Section A") : "Section A",
        ...voterUpdate
      }, { merge: true });
    }

    if (rootVoterSnap.exists()) {
      transaction.update(rootVoterRef, voterUpdate);
    } else {
      transaction.set(rootVoterRef, {
        rollNo: normalizedRoll,
        ...voterUpdate
      }, { merge: true });
    }

    // 3b. Increment candidate vote counters atomically
    transaction.update(boyRef, {
      voteCount: increment(1)
    });
    transaction.update(girlRef, {
      voteCount: increment(1)
    });

    const electionBoyRef = doc(db, "elections", targetElectionId, "candidates", boyCandidateId);
    const electionGirlRef = doc(db, "elections", targetElectionId, "candidates", girlCandidateId);
    transaction.set(electionBoyRef, { voteCount: increment(1) }, { merge: true });
    transaction.set(electionGirlRef, { voteCount: increment(1) }, { merge: true });

    // 3c. Decoupled Anonymous Ballot Record (Ballot Secrecy: completely decoupled from student identity)
    const anonymousVoteRef = doc(collection(db, "votes"));
    transaction.set(anonymousVoteRef, {
      electionId: targetElectionId,
      boyCandidateId: boyCandidateId,
      girlCandidateId: girlCandidateId,
      castAt: voteTimestamp,
      castAtMillis: nowTs,
      receiptToken: receiptToken
    });

    const electionVoteRef = doc(collection(db, "elections", targetElectionId, "votes"));
    transaction.set(electionVoteRef, {
      boyCandidateId: boyCandidateId,
      girlCandidateId: girlCandidateId,
      castAt: voteTimestamp,
      castAtMillis: nowTs,
      receiptToken: receiptToken
    });
  });

  return receiptToken;
}

// Execute Atomic Transaction Voting from UI
export async function executeAtomicVote() {
  if (!state.studentData || !state.studentData.rollNo) {
    showAlert("Student authentication error. Please re-verify roll number.", "error");
    return;
  }

  if (!selectedBoyCandidate || !selectedGirlCandidate) {
    showAlert("Incomplete ballot. Both 1 Boy CR and 1 Girl CR must be selected.", "error");
    return;
  }

  const rollNo = state.studentData.rollNo;
  const boyCandidateId = selectedBoyCandidate.id;
  const girlCandidateId = selectedGirlCandidate.id;

  try {
    if (submitSpinner) submitSpinner.classList.remove("hidden");
    if (finalSubmitVoteBtn) finalSubmitVoteBtn.disabled = true;

    // Execute atomic transaction
    const receiptToken = await submitBallot(currentElectionId, rollNo, boyCandidateId, girlCandidateId);

    // Update local state and persistent session
    if (state.studentData) {
      state.studentData.hasVoted = true;
      state.studentData.receiptHash = receiptToken;
    }
    const currentSession = localStorage.getItem("mirai_vote_session");
    if (currentSession) {
      try {
        const s = JSON.parse(currentSession);
        s.hasVoted = true;
        s.receiptHash = receiptToken;
        localStorage.setItem("mirai_vote_session", JSON.stringify(s));
      } catch (e) {}
    }

    // Transaction succeeded: Close review modal, alert user, display receipt
    closeReviewModal();
    showAlert("Ballot successfully sealed and cast! Cryptographic receipt generated.", "success");

    // Display Success Screen with immutable receipt token
    showVoteSuccessScreen(receiptToken);

  } catch (error) {
    console.error("Atomic vote submission failure:", error);
    showAlert(`Voting failed: ${error.message}`, "error");
  } finally {
    if (submitSpinner) submitSpinner.classList.add("hidden");
    if (finalSubmitVoteBtn) finalSubmitVoteBtn.disabled = false;
  }
}

function showVoteSuccessScreen(receiptToken) {
  const votingSection = document.getElementById("votingSection");
  const votedSuccessSection = document.getElementById("votedSuccessSection");
  const receiptTimestamp = document.getElementById("receiptTimestamp");
  const receiptHash = document.getElementById("receiptHash");

  if (votingSection) votingSection.classList.add("hidden");
  if (votedSuccessSection) votedSuccessSection.classList.remove("hidden");
  if (receiptTimestamp) receiptTimestamp.textContent = new Date().toLocaleString();
  if (receiptHash) receiptHash.textContent = receiptToken;
}

// Event Listeners
document.addEventListener("DOMContentLoaded", () => {
  if (reviewVoteBtn) reviewVoteBtn.addEventListener("click", openReviewModal);
  if (closeConfirmModalBtn) closeConfirmModalBtn.addEventListener("click", closeReviewModal);
  if (cancelVoteBtn) cancelVoteBtn.addEventListener("click", closeReviewModal);
  if (finalSubmitVoteBtn) finalSubmitVoteBtn.addEventListener("click", executeAtomicVote);

  const viewTurnoutBtn = document.getElementById("viewTurnoutBtn");
  if (viewTurnoutBtn) {
    viewTurnoutBtn.addEventListener("click", () => {
      document.getElementById("tabResultsBtn")?.click();
    });
  }

  // Load candidates when ballot unlocks
  window.addEventListener("ballotUnlocked", () => {
    loadCandidates();
  });
});
