// Mirai Vote Hub - Dynamic Multi-Seat Voting & Atomic Transaction Engine
// Mirai School of Technology

import { db } from "./firebase-config.js";
import { state, showAlert } from "./auth.js";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  runTransaction,
  increment,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Ballot State
let currentElectionId = "section-a";
let currentElectionCategories = ["Boy CR", "Girl CR"];
let selectionsMap = {}; // { [category]: candidateId }
let selectedCandidatesData = {}; // { [category]: candidateObject }
let candidatesCache = {}; // { [category]: [candidate, ...] }
let ballotTimerInterval = null;

export function updateBallotCountdown(closesAt) {
  const badge = document.getElementById("ballotTimerBadge");
  if (!badge) return;

  if (ballotTimerInterval) {
    clearInterval(ballotTimerInterval);
    ballotTimerInterval = null;
  }

  if (!closesAt) {
    badge.innerHTML = "<span>⏳ Open Voting (Manual Mode)</span>";
    badge.className = "ballot-timer-badge";
    return;
  }

  function tick() {
    const diff = Number(closesAt) - Date.now();
    if (diff <= 0) {
      badge.innerHTML = "<span>🛑 Polls Closed (Time Expired)</span>";
      badge.className = "ballot-timer-badge expired";
      if (ballotTimerInterval) {
        clearInterval(ballotTimerInterval);
        ballotTimerInterval = null;
      }
      const reviewVoteBtn = document.getElementById("reviewVoteBtn");
      if (reviewVoteBtn) {
        reviewVoteBtn.disabled = true;
        reviewVoteBtn.textContent = "Polls Closed • Voting Concluded";
      }
      return;
    }

    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    badge.innerHTML = `<span>⏳ Ends in ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}</span>`;
    badge.className = "ballot-timer-badge";
  }

  tick();
  ballotTimerInterval = setInterval(tick, 1000);
}

export function setCurrentElectionId(id) {
  if (id) currentElectionId = id;
}

export function getCurrentElectionId() {
  return currentElectionId;
}

// ============================================================================
// Top Navbar Dynamic Election Status Pill Controller
// ============================================================================
export function updateGlobalElectionStatusPill(activeCount) {
  const pill = document.getElementById("globalElectionStatusPill") || document.getElementById("electionStatusPill");
  const label = document.getElementById("globalElectionStatusLabel") || document.getElementById("electionStatusLabel");
  const dot = document.getElementById("globalStatusDot") || pill?.querySelector(".status-dot");

  if (!pill || !label) return;

  if (activeCount > 0) {
    label.textContent = "Election Active";
    pill.classList.remove("neutral", "inactive");
    pill.classList.add("active");
    pill.style.borderColor = "rgba(16, 185, 129, 0.4)";
    pill.style.background = "rgba(16, 185, 129, 0.1)";
    label.style.color = "#10b981";

    if (dot) {
      dot.className = "status-dot pulsing";
      dot.style.background = "#10b981";
      dot.style.boxShadow = "0 0 10px rgba(16, 185, 129, 0.7)";
      dot.style.animation = "pulseGreen 1.8s infinite";
    }
  } else {
    label.textContent = "No Active Elections";
    pill.classList.remove("active");
    pill.classList.add("neutral");
    pill.style.borderColor = "rgba(100, 116, 139, 0.3)";
    pill.style.background = "rgba(100, 116, 139, 0.08)";
    label.style.color = "#64748b";

    if (dot) {
      dot.className = "status-dot";
      dot.style.background = "#64748b";
      dot.style.boxShadow = "none";
      dot.style.animation = "none";
    }
  }
}

// UI Elements
const reviewVoteBtn = document.getElementById("reviewVoteBtn");
const confirmVoteModal = document.getElementById("confirmVoteModal");
const closeConfirmModalBtn = document.getElementById("closeConfirmModalBtn");
const cancelVoteBtn = document.getElementById("cancelVoteBtn");
const finalSubmitVoteBtn = document.getElementById("finalSubmitVoteBtn");
const submitSpinner = document.getElementById("submitSpinner");

// ============================================================================
// Dynamic Multi-Seat Ballot Booth Rendering
// ============================================================================

export async function loadCandidates(electionId = currentElectionId) {
  await renderDynamicBallot(electionId);
}

export async function renderDynamicBallot(electionId = currentElectionId) {
  const container = document.getElementById("ballotCategoriesContainer");
  if (!container) return;

  container.innerHTML = `<div class="loading-placeholder"><span class="spinner"></span> Loading certified electoral categories...</div>`;

  try {
    currentElectionId = electionId;

    // 1. Fetch Election Configuration
    let categories = ["Boy CR", "Girl CR"];
    const electionSnap = await getDoc(doc(db, "elections", electionId));
    if (electionSnap.exists()) {
      const edata = electionSnap.data();
      if (Array.isArray(edata.categories) && edata.categories.length > 0) {
        categories = edata.categories;
      }
    }
    currentElectionCategories = categories;

    // Reset student selections
    selectionsMap = {};
    selectedCandidatesData = {};
    candidatesCache = {};
    categories.forEach(cat => { candidatesCache[cat] = []; });

    // 2. Fetch candidates (Subcollection first, fallback to root)
    let candidatesSnap = await getDocs(collection(db, "elections", electionId, "candidates"));
    if (candidatesSnap.empty) {
      candidatesSnap = await getDocs(collection(db, "candidates"));
    }

    candidatesSnap.forEach(docSnap => {
      const data = { id: docSnap.id, ...docSnap.data() };
      const rawCat = data.category || "";

      // Normalize match with defined categories
      const matchedCat = categories.find(c => 
        c.toLowerCase() === rawCat.toLowerCase() ||
        (c === "Boy CR" && rawCat === "boy_cr") ||
        (c === "Girl CR" && rawCat === "girl_cr")
      );

      if (matchedCat) {
        if (!candidatesCache[matchedCat]) candidatesCache[matchedCat] = [];
        candidatesCache[matchedCat].push(data);
      }
    });

    // 3. Render Dynamic Columns for Each Category
    container.innerHTML = "";
    categories.forEach((cat, idx) => {
      const cands = candidatesCache[cat] || [];
      const col = document.createElement("div");
      col.className = `nominee-column border-accent-${idx % 5}`;
      col.id = `seatContainer_${idx}`;

      col.innerHTML = `
        <div class="column-header">
          <div class="column-title-group">
            <span class="category-indicator badge-accent-${idx % 5}">Seat #${idx + 1}</span>
            <h3>${cat} Nominees</h3>
          </div>
          <span class="seat-badge-neon cyan">Select Exactly 1</span>
        </div>
        <p class="column-subtitle">Review candidate manifestos and choose exactly one certified nominee for ${cat}.</p>
        <div class="candidates-grid" id="candidatesGrid_${idx}"></div>
      `;

      const grid = col.querySelector(`#candidatesGrid_${idx}`);
      if (cands.length === 0) {
        grid.innerHTML = `
          <div class="empty-candidate-card">
            <p>No certified candidates registered yet for ${cat}.</p>
            <small>Admins can add nominees in the Election Control Terminal.</small>
          </div>
        `;
      } else {
        cands.forEach(cand => {
          const card = createCandidateCard(cand, cat, idx);
          grid.appendChild(card);
        });
      }

      container.appendChild(col);
    });

    // Initialize Bottom Status Tracker
    updateBallotTrackerUI();

  } catch (error) {
    console.error("Failed to render dynamic ballot:", error);
    container.innerHTML = `<div class="error-msg">Error loading electoral seats: ${error.message}</div>`;
  }
}

function createCandidateCard(candidate, category, categoryIdx) {
  const card = document.createElement("div");
  card.className = "candidate-card";
  card.dataset.id = candidate.id;
  card.dataset.category = category;

  const initials = candidate.name
    .split(" ")
    .map(n => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const avatarContent = candidate.photoUrl
    ? `<img src="${candidate.photoUrl}" alt="${candidate.name}" class="avatar-img" onerror="this.onerror=null;this.parentElement.innerHTML='${initials}';" />`
    : initials;

  card.innerHTML = `
    <div class="candidate-header">
      <div class="candidate-avatar boy_cr-avatar">${avatarContent}</div>
      <div class="candidate-meta">
        <h4 class="candidate-name">${candidate.name}</h4>
        <span class="candidate-roll mono">${candidate.rollNo || candidate.id}</span>
      </div>
      <div class="selection-indicator">
        <span class="radio-circle"></span>
      </div>
    </div>
    <div class="candidate-body">
      <p class="candidate-manifesto">"${candidate.manifesto || 'Committed to representing student interests and cohort welfare.'}"</p>
    </div>
  `;

  card.addEventListener("click", () => {
    selectCandidate(category, candidate, card, categoryIdx);
  });

  return card;
}

function selectCandidate(category, candidate, cardElement, categoryIdx) {
  selectionsMap[category] = candidate.id;
  selectedCandidatesData[category] = candidate;

  // Unselect all other cards in this specific category grid
  const grid = document.getElementById(`candidatesGrid_${categoryIdx}`);
  if (grid) {
    grid.querySelectorAll(".candidate-card").forEach(c => c.classList.remove("selected"));
  }

  // Mark clicked card selected
  cardElement.classList.add("selected");

  // Update Status Tracker & Submit Button state
  updateBallotTrackerUI();
}

function updateBallotTrackerUI() {
  const tracker = document.getElementById("ballotStatusTracker");
  if (!tracker) return;

  tracker.innerHTML = "";

  currentElectionCategories.forEach((cat, idx) => {
    const isSelected = Boolean(selectionsMap[cat]);
    const cand = selectedCandidatesData[cat];

    const item = document.createElement("div");
    item.className = "status-track-item";
    item.innerHTML = `
      <span class="track-label">${cat}:</span>
      <span class="track-value ${isSelected ? 'highlight-cyan' : ''}" style="${isSelected ? '' : 'color:var(--text-muted);'}">
        ${isSelected ? cand.name : 'None selected'}
      </span>
    `;
    tracker.appendChild(item);

    if (idx < currentElectionCategories.length - 1) {
      const divider = document.createElement("div");
      divider.className = "status-track-divider";
      tracker.appendChild(divider);
    }
  });

  // Enable button only if every defined category has a selected candidate
  const isComplete = currentElectionCategories.every(cat => Boolean(selectionsMap[cat]));
  if (reviewVoteBtn) {
    reviewVoteBtn.disabled = !isComplete;
  }
}

// Open Review Modal
function openReviewModal() {
  const isComplete = currentElectionCategories.every(cat => Boolean(selectionsMap[cat]));
  if (!isComplete) {
    showAlert("Please select one candidate for every electoral seat before submitting.", "error");
    return;
  }

  const reviewContainer = document.getElementById("modalSelectionsReview");
  if (reviewContainer) {
    reviewContainer.innerHTML = "";
    currentElectionCategories.forEach((cat, idx) => {
      const cand = selectedCandidatesData[cat];
      const block = document.createElement("div");
      block.className = `review-block border-accent-${idx % 5}`;
      block.innerHTML = `
        <span class="review-label">${cat}:</span>
        <strong class="review-name highlight-cyan">${cand.name} <span class="mono" style="color:var(--text-muted);">(${cand.rollNo || cand.id})</span></strong>
      `;
      reviewContainer.appendChild(block);
    });
  }

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
// Atomic Ballot Transaction Engine (Multi-Seat Dynamic Secrecy Protocol)
// ============================================================================
export async function submitBallot(electionId, studentId, selectionsMapArg, extraArg) {
  const targetElectionId = electionId || currentElectionId || "section-a";
  const normalizedRoll = (studentId || "").trim().toUpperCase();

  if (!normalizedRoll) {
    throw new Error("Student Roll Number is required to cast a ballot.");
  }

  // Support both object map { [cat]: candId } and legacy args (electionId, studentId, boyId, girlId)
  let ballotSelections = {};
  if (typeof selectionsMapArg === "object" && selectionsMapArg !== null) {
    ballotSelections = selectionsMapArg;
  } else if (typeof selectionsMapArg === "string" && typeof extraArg === "string") {
    ballotSelections = {
      "Boy CR": selectionsMapArg,
      "Girl CR": extraArg
    };
  } else {
    ballotSelections = selectionsMap;
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

    // ------------------------------------------------------------------------
    // STEP 2: VERIFICATION & AUDIT GATES
    // ------------------------------------------------------------------------

    // Gate A: Target election status must strictly be "active"
    let status = "active";
    let votingMode = "manual";
    let closesAt = null;
    let categories = ["Boy CR", "Girl CR"];

    if (electionSnap.exists()) {
      const edata = electionSnap.data();
      status = edata.status;
      votingMode = edata.votingMode || "manual";
      closesAt = edata.closesAt || null;
      if (Array.isArray(edata.categories) && edata.categories.length > 0) {
        categories = edata.categories;
      }
    } else if (metaSnap.exists()) {
      const mdata = metaSnap.data();
      status = mdata.status;
      votingMode = mdata.votingMode || "manual";
      closesAt = mdata.closesAt || null;
      if (Array.isArray(mdata.categories) && mdata.categories.length > 0) {
        categories = mdata.categories;
      }
    }

    if (status !== "active") {
      throw new Error(`Election is currently '${status}'. Ballots can only be cast when election status is 'active'.`);
    }

    if (votingMode === "timed" && closesAt && Date.now() >= closesAt) {
      throw new Error("Election voting period has expired. The ballot box is sealed.");
    }

    // Gate B: Multi-seat ballot completeness check
    for (const cat of categories) {
      if (!ballotSelections[cat]) {
        throw new Error(`Incomplete ballot: missing selection for seat '${cat}'.`);
      }
    }

    // Gate C: Voter whitelist verification & Zero Duplicate Guarantee
    if (!electionVoterSnap.exists() && !rootVoterSnap.exists()) {
      throw new Error(`Roll Number '${normalizedRoll}' is not certified on the election whitelist.`);
    }

    const electionVoterData = electionVoterSnap.exists() ? electionVoterSnap.data() : null;
    const rootVoterData = rootVoterSnap.exists() ? rootVoterSnap.data() : null;

    if ((electionVoterData && electionVoterData.hasVoted === true) || (rootVoterData && rootVoterData.hasVoted === true)) {
      throw new Error("Duplicate Vote Rejected: A ballot has already been cast and sealed for this Roll Number.");
    }

    // Gate D: Read and verify candidate records for every declared category
    for (const cat of categories) {
      const candId = ballotSelections[cat];
      const elCandRef = doc(db, "elections", targetElectionId, "candidates", candId);
      const rootCandRef = doc(db, "candidates", candId);
      const elCandSnap = await transaction.get(elCandRef);
      const rootCandSnap = await transaction.get(rootCandRef);

      if (!elCandSnap.exists() && !rootCandSnap.exists()) {
        throw new Error(`Candidate '${candId}' selected for seat '${cat}' was not found on the official ballot roster.`);
      }

      const candData = elCandSnap.exists() ? elCandSnap.data() : rootCandSnap.data();
      if (candData.category && candData.category.trim().toLowerCase() !== cat.trim().toLowerCase()) {
        throw new Error(`Integrity violation: Candidate '${candData.name || candId}' is not registered for seat '${cat}'.`);
      }
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

    // 3b. Increment candidate vote counters atomically across all chosen seats
    for (const candId of candidateIds) {
      const elCandRef = doc(db, "elections", targetElectionId, "candidates", candId);
      transaction.set(elCandRef, { voteCount: increment(1) }, { merge: true });

      const rootCandRef = doc(db, "candidates", candId);
      transaction.set(rootCandRef, { voteCount: increment(1) }, { merge: true });
    }

    // 3c. Decoupled Anonymous Ballot Record (Ballot Secrecy Protocol)
    const anonymousVoteRef = doc(collection(db, "votes"));
    transaction.set(anonymousVoteRef, {
      electionId: targetElectionId,
      selections: ballotSelections,
      castAt: voteTimestamp,
      castAtMillis: nowTs,
      receiptToken: receiptToken
    });

    const electionVoteRef = doc(collection(db, "elections", targetElectionId, "votes"));
    transaction.set(electionVoteRef, {
      selections: ballotSelections,
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

  const isComplete = currentElectionCategories.every(cat => Boolean(selectionsMap[cat]));
  if (!isComplete) {
    showAlert("Incomplete ballot. You must choose one nominee for every seat.", "error");
    return;
  }

  const rollNo = state.studentData.rollNo;
  const origFinalText = finalSubmitVoteBtn ? finalSubmitVoteBtn.textContent : "Confirm & Cast Official Ballot";
  const origReviewText = reviewVoteBtn ? reviewVoteBtn.textContent : "Review & Cast Official Ballot";

  // Immediate double-tap protection on slow connections
  if (finalSubmitVoteBtn) {
    finalSubmitVoteBtn.disabled = true;
    finalSubmitVoteBtn.textContent = "Securing Ballot on Ledger...";
  }
  if (reviewVoteBtn) {
    reviewVoteBtn.disabled = true;
    reviewVoteBtn.textContent = "Securing Ballot on Ledger...";
  }
  if (submitSpinner) submitSpinner.classList.remove("hidden");

  try {
    // Execute atomic multi-seat transaction
    const receiptToken = await submitBallot(currentElectionId, rollNo, selectionsMap);

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
    let msg = error.message || "Failed to secure ballot on ledger.";
    if (
      error.code === "failed-precondition" ||
      error.code === "unavailable" ||
      msg.includes("contention") ||
      msg.includes("network") ||
      msg.includes("retry")
    ) {
      msg = "High ledger contention detected. Please click 'Confirm & Cast Official Ballot' again to retry.";
    }
    showAlert(`Voting failed: ${msg}`, "error");
  } finally {
    if (submitSpinner) submitSpinner.classList.add("hidden");
    if (finalSubmitVoteBtn) {
      finalSubmitVoteBtn.disabled = false;
      finalSubmitVoteBtn.textContent = origFinalText;
    }
    if (reviewVoteBtn) {
      reviewVoteBtn.disabled = false;
      reviewVoteBtn.textContent = origReviewText;
    }
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
    loadCandidates(currentElectionId);
  });

  // Dynamic election selected from card
  window.addEventListener("electionSelected", (e) => {
    const meta = e.detail;
    if (!meta) return;
    loadCandidates(meta.id);
    const titleEl = document.getElementById("ballotElectionTitle");
    if (titleEl && meta.title) titleEl.textContent = meta.title;
    if (meta.votingMode === "timed" && meta.closesAt) {
      updateBallotCountdown(meta.closesAt);
    } else {
      updateBallotCountdown(null);
    }
  });
});
