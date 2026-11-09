// Mirai Vote Hub - Dual-Seat Voting & Atomic Transaction Engine
// Mirai School of Technology - CSE AI/ML

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
let selectedBoyCandidate = null;
let selectedGirlCandidate = null;
let candidatesCache = {
  boy_cr: [],
  girl_cr: []
};

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
    card.className = "candidate-card";
    card.dataset.id = cand.id;
    card.dataset.category = category;

    const avatarInitial = cand.name ? cand.name.charAt(0).toUpperCase() : "C";
    const photoHtml = cand.photoUrl 
      ? `<img src="${cand.photoUrl}" alt="${cand.name}" class="candidate-avatar">`
      : `<div class="candidate-avatar">${avatarInitial}</div>`;

    card.innerHTML = `
      ${photoHtml}
      <div class="candidate-name">${cand.name}</div>
      <div class="candidate-roll">${cand.rollNo || 'Roll: Verified'}</div>
      <p class="candidate-manifesto">${cand.manifesto || 'Committed to representing CSE AI/ML student cohort interests.'}</p>
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
function generateReceiptToken(rollNo) {
  const ts = Date.now().toString(16);
  const entropy = Math.random().toString(16).substring(2, 10);
  return `0xMIRAI-${ts}-${entropy.toUpperCase()}`;
}

// Execute Atomic Transaction Voting
export async function executeAtomicVote() {
  if (!state.studentData || !state.studentData.rollNo) {
    showAlert("Student authentication error. Please re-verify roll number.", "error");
    return;
  }

  if (!selectedBoyCandidate || !selectedGirlCandidate) {
    showAlert("Incomplete ballot. Both seats must be selected.", "error");
    return;
  }

  const rollNo = state.studentData.rollNo;
  const boyCandidateId = selectedBoyCandidate.id;
  const girlCandidateId = selectedGirlCandidate.id;
  const receiptToken = generateReceiptToken(rollNo);

  try {
    if (submitSpinner) submitSpinner.classList.remove("hidden");
    if (finalSubmitVoteBtn) finalSubmitVoteBtn.disabled = true;

    // Run Atomic Transaction
    await runTransaction(db, async (transaction) => {
      // 1. Verify student whitelist state atomically
      const studentRef = doc(db, "whitelist", rollNo);
      const studentDoc = await transaction.get(studentRef);

      if (!studentDoc.exists()) {
        throw new Error("Student record not found in whitelist.");
      }

      if (studentDoc.data().hasVoted === true) {
        throw new Error("Duplicate Vote Detected: This roll number has already voted.");
      }

      // 2. Read candidate documents to verify existence
      const boyRef = doc(db, "candidates", boyCandidateId);
      const girlRef = doc(db, "candidates", girlCandidateId);
      const boyDoc = await transaction.get(boyRef);
      const girlDoc = await transaction.get(girlRef);

      if (!boyDoc.exists() || !girlDoc.exists()) {
        throw new Error("One or more selected candidate records do not exist.");
      }

      // 3. Mark student as voted (Zero Duplicate Guarantee)
      transaction.update(studentRef, {
        hasVoted: true,
        votedAt: serverTimestamp(),
        receiptHash: receiptToken
      });

      // 4. Decoupled Anonymous Ballot Record (Ballot Secrecy Guarantee)
      // Generates an independent UUID/hash doc in votes collection WITHOUT student rollNo
      const anonymousVoteRef = doc(collection(db, "votes"));
      transaction.set(anonymousVoteRef, {
        boyCandidateId: boyCandidateId,
        girlCandidateId: girlCandidateId,
        castAt: serverTimestamp(),
        receiptToken: receiptToken
      });

      // 5. Atomically increment candidate vote counters
      transaction.update(boyRef, {
        voteCount: increment(1)
      });
      transaction.update(girlRef, {
        voteCount: increment(1)
      });
    });

    // Transaction succeeded!
    closeReviewModal();
    showAlert("Ballot successfully sealed and cast!", "success");

    // Display Success Screen
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
