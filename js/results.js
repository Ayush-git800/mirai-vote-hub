// Mirai Vote Hub - Live Telemetry & 2-Stage Reveal Results Engine
// Mirai School of Technology

import { db } from "./firebase-config.js";
import { setCurrentElectionId } from "./voting.js";
import { state, updateElectionCardsEligibility } from "./auth.js";
import {
  collection,
  doc,
  onSnapshot,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// State
let electionStage = 1; // 1 = Turnout Only, 2 = Full Results
let electionStatus = "active"; // "draft" | "active" | "ended" | "published" | "concluded"
let totalWhitelistCount = 0;
let totalVotesCast = 0;

// UI Elements
const turnoutPercentage = document.getElementById("turnoutPercentage");
const turnoutProgressBar = document.getElementById("turnoutProgressBar");
const statVotesCast = document.getElementById("statVotesCast");
const statTotalVoters = document.getElementById("statTotalVoters");
const statTurnoutRemaining = document.getElementById("statTurnoutRemaining");
const sealedResultsNotice = document.getElementById("sealedResultsNotice");
const unsealedResultsContainer = document.getElementById("unsealedResultsContainer");
const stageIndicatorPill = document.getElementById("stageIndicatorPill");
const currentStageText = document.getElementById("currentStageText");
const electionStatusLabel = document.getElementById("electionStatusLabel");
const boyResultsBody = document.getElementById("boyResultsBody");
const girlResultsBody = document.getElementById("girlResultsBody");
const boyWinnerPill = document.getElementById("boyWinnerPill");
const girlWinnerPill = document.getElementById("girlWinnerPill");
const sealedNoticeTitle = document.getElementById("sealedNoticeTitle");
const sealedNoticeDesc = document.getElementById("sealedNoticeDesc");

// ============================================================================
// 1. Two-Stage Audited Results & Telemetry Engine
// ============================================================================

export function initTelemetryAndResults() {
  const metaRef = doc(db, "election_meta", "config");

  onSnapshot(metaRef, (docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data();
      electionStage = data.revealStage || 1;
      electionStatus = data.status || "active";

      applyElectionStateAndStage(electionStatus, electionStage);
    } else {
      // Default baseline when config is not yet initialized
      applyElectionStateAndStage("active", 1);
    }
  }, (error) => {
    console.warn("Real-time election_meta subscription warning:", error);
    applyElectionStateAndStage("active", 1);
  });

  // Listen to Whitelist count & voted count
  subscribeToTurnout();

  // Listen to Candidates if Stage 2 is unlocked
  subscribeToCandidates();

  // Dynamic Real-time Election Cards
  subscribeToElections();
}

/**
 * Two-Stage Audited Results State Controller:
 * - Sealed Audit State: If status is "ended" (or "concluded" with revealStage 1),
 *   display "Ballot box sealed. Official audit underway." and keep vote counts hidden.
 * - Published State: If status is "published" (or revealStage 2),
 *   fetch final tallies, compute percentage share, display animated progress bars, highlight winners.
 * - Active State:
 *   Display live turnout telemetry, keeping candidate breakdown sealed.
 */
function applyElectionStateAndStage(status, stage) {
  const isEndedOrConcluded = status === "ended" || (status === "concluded" && stage === 1);
  const isPublished = status === "published" || stage === 2;

  // Header status pill
  if (electionStatusLabel) {
    if (isPublished) {
      electionStatusLabel.textContent = "Results Published";
      electionStatusLabel.className = "status-indicator live";
    } else if (isEndedOrConcluded) {
      electionStatusLabel.textContent = "Election Sealed";
      electionStatusLabel.className = "status-indicator";
    } else if (status === "draft" || status === "ready") {
      electionStatusLabel.textContent = "Election Draft";
      electionStatusLabel.className = "status-indicator";
    } else {
      electionStatusLabel.textContent = "Election Active";
      electionStatusLabel.className = "status-indicator live";
    }
  }

  // 1. Sealed Audit State ("ended" or "concluded" with stage 1)
  if (isEndedOrConcluded && !isPublished) {
    if (currentStageText) {
      currentStageText.textContent = "Audit Phase: Ballot Box Sealed";
    }
    if (stageIndicatorPill) {
      stageIndicatorPill.innerHTML = `<span class="pulse-amber">●</span> Stage 1: Official Sealed Audit`;
      stageIndicatorPill.style.borderColor = "var(--neon-amber)";
      stageIndicatorPill.style.color = "var(--neon-amber)";
    }

    // Keep candidate breakdown sealed
    if (sealedResultsNotice) sealedResultsNotice.classList.remove("hidden");
    if (unsealedResultsContainer) unsealedResultsContainer.classList.add("hidden");

    if (sealedNoticeTitle) {
      sealedNoticeTitle.textContent = "Ballot box sealed. Official audit underway.";
    }
    if (sealedNoticeDesc) {
      sealedNoticeDesc.textContent = "All voting has concluded. The cryptographic ledger is sealed while the Election Commission conducts integrity verification and certified audit checks before the official reveal.";
    }
  }
  // 2. Published State ("published" or revealStage 2)
  else if (isPublished) {
    if (currentStageText) {
      currentStageText.textContent = "Stage 2: Official Certified Results Unsealed";
    }
    if (stageIndicatorPill) {
      stageIndicatorPill.innerHTML = `<span class="pulse-emerald">●</span> Stage 2: Certified Reveal Unsealed`;
      stageIndicatorPill.style.borderColor = "var(--neon-emerald)";
      stageIndicatorPill.style.color = "var(--neon-emerald)";
    }

    // Unseal results container
    if (sealedResultsNotice) sealedResultsNotice.classList.add("hidden");
    if (unsealedResultsContainer) unsealedResultsContainer.classList.remove("hidden");
  }
  // 3. Active / Polling State
  else {
    if (currentStageText) {
      currentStageText.textContent = "Stage 1: Live Turnout Telemetry";
    }
    if (stageIndicatorPill) {
      stageIndicatorPill.innerHTML = `<span class="pulse-cyan">●</span> Stage 1: Live Turnout Telemetry`;
      stageIndicatorPill.style.borderColor = "var(--neon-cyan)";
      stageIndicatorPill.style.color = "var(--neon-cyan)";
    }

    if (sealedResultsNotice) sealedResultsNotice.classList.remove("hidden");
    if (unsealedResultsContainer) unsealedResultsContainer.classList.add("hidden");

    if (sealedNoticeTitle) {
      sealedNoticeTitle.textContent = "Candidate Vote Breakdown is Currently Sealed";
    }
    if (sealedNoticeDesc) {
      sealedNoticeDesc.textContent = "As per the Mirai Election Protocol, candidate tallies remain cryptographically sealed until polls close and the Election Commission unseals Stage 2 results.";
    }
  }
}

// Live Turnout Subscription
function subscribeToTurnout() {
  const whitelistCol = collection(db, "whitelist");

  onSnapshot(whitelistCol, (snapshot) => {
    totalWhitelistCount = snapshot.size;
    let votedCount = 0;

    snapshot.forEach(docSnap => {
      if (docSnap.data().hasVoted === true) {
        votedCount++;
      }
    });

    totalVotesCast = votedCount;
    updateTurnoutUI(totalVotesCast, totalWhitelistCount);
  }, (err) => {
    console.error("Turnout subscription error:", err);
  });
}

function updateTurnoutUI(voted, total) {
  const percent = total > 0 ? ((voted / total) * 100).toFixed(1) : "0.0";
  const remaining = Math.max(0, total - voted);

  if (turnoutPercentage) turnoutPercentage.textContent = `${percent}%`;
  if (turnoutProgressBar) turnoutProgressBar.style.width = `${percent}%`;
  if (statVotesCast) statVotesCast.textContent = voted.toString();
  if (statTotalVoters) statTotalVoters.textContent = total.toString();
  if (statTurnoutRemaining) statTurnoutRemaining.textContent = remaining.toString();
}

// Candidates Results Subscription (Unsealed during Stage 2)
function subscribeToCandidates() {
  const candidatesCol = collection(db, "candidates");

  onSnapshot(candidatesCol, (snapshot) => {
    const boys = [];
    const girls = [];

    snapshot.forEach(docSnap => {
      const data = { id: docSnap.id, ...docSnap.data() };
      if (data.category === "boy_cr") {
        boys.push(data);
      } else if (data.category === "girl_cr") {
        girls.push(data);
      }
    });

    // Sort descending by voteCount
    boys.sort((a, b) => (b.voteCount || 0) - (a.voteCount || 0));
    girls.sort((a, b) => (b.voteCount || 0) - (a.voteCount || 0));

    renderResultsTable(boys, boyResultsBody, boyWinnerPill, "Boy CR");
    renderResultsTable(girls, girlResultsBody, girlWinnerPill, "Girl CR");
  }, (err) => {
    console.error("Candidates results subscription error:", err);
  });
}

function renderResultsTable(candidates, tbody, winnerPill, seatLabel) {
  if (!tbody) return;
  tbody.innerHTML = "";

  if (candidates.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 2rem; color: var(--text-muted);">No candidates registered for ${seatLabel}</td></tr>`;
    if (winnerPill) {
      winnerPill.textContent = "No Candidates";
      winnerPill.style.background = "rgba(255, 255, 255, 0.05)";
      winnerPill.style.borderColor = "var(--border-subtle)";
      winnerPill.style.color = "var(--text-muted)";
    }
    return;
  }

  const totalCategoryVotes = candidates.reduce((sum, c) => sum + (c.voteCount || 0), 0);
  const highestVotes = candidates[0].voteCount || 0;

  // Set Winner Pill
  if (winnerPill) {
    if (highestVotes > 0) {
      winnerPill.innerHTML = `👑 Certified Leader: <strong>${candidates[0].name}</strong> (${highestVotes} votes)`;
      winnerPill.style.background = "rgba(16, 185, 129, 0.18)";
      winnerPill.style.borderColor = "var(--neon-emerald)";
      winnerPill.style.color = "var(--neon-emerald)";
    } else {
      winnerPill.textContent = "Polls Active (Zero votes cast)";
      winnerPill.style.background = "rgba(255, 184, 0, 0.15)";
      winnerPill.style.borderColor = "var(--neon-amber)";
      winnerPill.style.color = "var(--neon-amber)";
    }
  }

  candidates.forEach((cand, index) => {
    const count = cand.voteCount || 0;
    const share = totalCategoryVotes > 0 ? ((count / totalCategoryVotes) * 100).toFixed(1) : "0.0";
    const isWinner = index === 0 && count > 0;

    const row = document.createElement("tr");
    if (isWinner) {
      row.className = "winner-row";
    }

    row.innerHTML = `
      <td>
        <div style="display:flex; align-items:center; gap:0.6rem;">
          ${isWinner ? '<span class="crown-badge" title="Certified Winner">👑</span>' : ''}
          <strong style="${isWinner ? 'color: var(--neon-cyan);' : ''}">${cand.name}</strong>
        </div>
      </td>
      <td class="mono">${cand.rollNo || 'Certified'}</td>
      <td class="mono font-bold" style="${isWinner ? 'color: var(--neon-cyan); font-weight:700;' : ''}">${count}</td>
      <td>
        <div class="result-bar-cell">
          <div class="result-bar-text">
            <span>${share}%</span>
          </div>
          <div class="result-bar-track">
            <div class="result-bar-fill ${isWinner ? 'winner-bar' : ''}" style="width: ${share}%;"></div>
          </div>
        </div>
      </td>
      <td>
        <span class="badge ${isWinner ? 'badge-winner' : 'badge-secondary'}">
          ${isWinner ? 'WINNER #1' : `Rank #${index + 1}`}
        </span>
      </td>
    `;
    tbody.appendChild(row);
  });
}

// ============================================================================
// 2. Dynamic Real-time Election Card Ingestion (Zero Dummy Data)
// ============================================================================

export function subscribeToElections() {
  const electionsGrid = document.getElementById("electionsGrid");
  const activeCountEl = document.getElementById("activeElectionsCount") || document.querySelector(".header-stats-pill .pill-number");
  if (!electionsGrid) return;

  const electionsCol = collection(db, "elections");

  onSnapshot(electionsCol, (snapshot) => {
    if (snapshot.empty) {
      electionsGrid.innerHTML = `
        <div class="empty-elections-card col-span-full">
          <div class="empty-icon">🗳️</div>
          <h3>No Active Elections Registered</h3>
          <p>There are currently no cohort elections configured in the Firestore ledger.</p>
          <small>Election Commission administrators can create and instantiate a new election cohort from the Admin Terminal.</small>
        </div>
      `;
      if (activeCountEl) activeCountEl.textContent = "0";
      return;
    }

    let activeCount = 0;
    electionsGrid.innerHTML = "";

    snapshot.forEach((docSnap) => {
      const data = { id: docSnap.id, ...docSnap.data() };
      const status = data.status || "draft";
      const section = data.section || "Cohort";
      const title = data.title || `${section} - CR Election 2026`;

      if (status === "active") activeCount++;

      let badgeHtml = "";
      let actionBtnHtml = "";

      if (status === "active") {
        badgeHtml = `<span class="election-badge live-pulse">● Voting Live</span>`;
        actionBtnHtml = `
          <button class="btn btn-cyber-primary btn-block enter-election-btn" data-election-id="${data.id}">
            <span>Enter Voting Booth 🗳️</span>
          </button>
        `;
      } else if (status === "ended" || status === "concluded") {
        badgeHtml = `<span class="election-badge scheduled">🔒 Ballot Box Sealed</span>`;
        actionBtnHtml = `
          <button class="btn btn-cyber-outline btn-block view-audit-btn" data-election-id="${data.id}">
            <span>Ballot Box Sealed (Audit in Progress) 📜</span>
          </button>
        `;
      } else if (status === "published") {
        badgeHtml = `<span class="election-badge" style="background: rgba(16, 185, 129, 0.2); color: var(--neon-emerald); border: 1px solid var(--neon-emerald); box-shadow: 0 0 10px rgba(16, 185, 129, 0.3);">🏆 Results Published</span>`;
        actionBtnHtml = `
          <button class="btn btn-cyber-primary btn-block view-results-btn" data-election-id="${data.id}" style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.25) 0%, rgba(5, 150, 105, 0.4) 100%); border-color: var(--neon-emerald); color: #fff;">
            <span>View Certified Results 📊</span>
          </button>
        `;
      } else {
        // draft or ready
        badgeHtml = `<span class="election-badge draft">Draft Phase</span>`;
        actionBtnHtml = `
          <button class="btn btn-cyber-outline btn-block" disabled>
            <span>Polls Open Soon ⏳</span>
          </button>
        `;
      }

      const card = document.createElement("div");
      card.className = `election-card ${status === "active" ? "active-card" : "ready-card"}`;
      card.dataset.electionId = data.id;

      card.innerHTML = `
        <div class="election-card-header">
          ${badgeHtml}
          <span class="election-seat-count">Dual-Seat Election</span>
        </div>

        <div class="election-card-body">
          <h3 class="election-title">${title}</h3>
          <p class="election-summary">Official cohort voting for 1 Boy Class Representative and 1 Girl Class Representative.</p>

          <div class="election-meta-specs">
            <div class="meta-spec-item">
              <span class="spec-label">Section</span>
              <span class="spec-value">${section} (2026–27)</span>
            </div>
            <div class="meta-spec-item">
              <span class="spec-label">Seats</span>
              <span class="spec-value highlight-cyan">2 Seats (Boy CR + Girl CR)</span>
            </div>
            <div class="meta-spec-item">
              <span class="spec-label">Integrity</span>
              <span class="spec-value">Atomic Concurrency Lock</span>
            </div>
            <div class="meta-spec-item">
              <span class="spec-label">Ballot Type</span>
              <span class="spec-value">Decoupled Anonymous</span>
            </div>
          </div>
        </div>

        <div class="election-card-footer">
          ${actionBtnHtml}
        </div>
      `;

      // Connect action buttons
      const enterBtn = card.querySelector(".enter-election-btn");
      if (enterBtn) {
        enterBtn.addEventListener("click", () => {
          setCurrentElectionId(data.id);
          const tabBallotBtn = document.getElementById("tabBallotBtn");
          if (tabBallotBtn) tabBallotBtn.click();
        });
      }

      const viewAuditBtn = card.querySelector(".view-audit-btn");
      if (viewAuditBtn) {
        viewAuditBtn.addEventListener("click", () => {
          const tabResultsBtn = document.getElementById("tabResultsBtn");
          if (tabResultsBtn) tabResultsBtn.click();
        });
      }

      const viewResultsBtn = card.querySelector(".view-results-btn");
      if (viewResultsBtn) {
        viewResultsBtn.addEventListener("click", () => {
          const tabResultsBtn = document.getElementById("tabResultsBtn");
          if (tabResultsBtn) tabResultsBtn.click();
        });
      }

      electionsGrid.appendChild(card);
    });

    if (activeCountEl) {
      activeCountEl.textContent = activeCount.toString();
    }

    // Refresh eligibility indicators if student is logged in
    if (state.studentData && state.studentData.rollNo) {
      updateElectionCardsEligibility(state.studentData.rollNo);
    }
  }, (err) => {
    console.error("Error subscribing to elections collection:", err);
    if (electionsGrid) {
      electionsGrid.innerHTML = `
        <div class="empty-elections-card col-span-full">
          <div class="empty-icon">⚠️</div>
          <h3>Ledger Connectivity Notice</h3>
          <p>Connecting to Firestore real-time ledger. If this persists, verify your security rules.</p>
        </div>
      `;
    }
  });
}

// ============================================================================
// 3. Global Tab Navigation Controller
// ============================================================================

export function initTabNavigation() {
  const tabs = document.querySelectorAll(".nav-tab");
  const electionListView = document.getElementById("electionListView");
  const ballotView = document.getElementById("ballotView");
  const authSection = document.getElementById("authSection");
  const votingSection = document.getElementById("votingSection");
  const votedSuccessSection = document.getElementById("votedSuccessSection");
  const resultsView = document.getElementById("resultsView") || document.getElementById("resultsSection");
  const adminView = document.getElementById("adminView") || document.getElementById("adminSection");

  function hideAllViews() {
    electionListView?.classList.add("hidden");
    ballotView?.classList.add("hidden");
    authSection?.classList.add("hidden");
    votingSection?.classList.add("hidden");
    votedSuccessSection?.classList.add("hidden");
    resultsView?.classList.add("hidden");
    adminView?.classList.add("hidden");
    document.getElementById("resultsSection")?.classList.add("hidden");
    document.getElementById("adminSection")?.classList.add("hidden");
  }

  function activateTab(tabKey) {
    tabs.forEach(t => {
      if (t.dataset.tab === tabKey) {
        t.classList.add("active");
      } else {
        t.classList.remove("active");
      }
    });

    hideAllViews();

    if (tabKey === "electionsTab") {
      electionListView?.classList.remove("hidden");
    } else if (tabKey === "resultsTab") {
      resultsView?.classList.remove("hidden");
      document.getElementById("resultsSection")?.classList.remove("hidden");
    } else if (tabKey === "adminTab") {
      adminView?.classList.remove("hidden");
      document.getElementById("adminSection")?.classList.remove("hidden");
      window.dispatchEvent(new CustomEvent("adminTabOpened"));
    } else {
      // ballotTab
      const hasVoted = !votedSuccessSection?.dataset.unvoted && votedSuccessSection?.querySelector(".receipt-hash")?.textContent !== "0x0000000000000000" && !votedSuccessSection?.classList.contains("hidden");
      
      // Check if student session is active
      const studentRoll = document.getElementById("ballotRollNo")?.textContent || "";
      const isStudentVerified = studentRoll && !studentRoll.includes("--");

      if (hasVoted) {
        ballotView?.classList.remove("hidden");
        votedSuccessSection?.classList.remove("hidden");
      } else if (isStudentVerified) {
        ballotView?.classList.remove("hidden");
        votingSection?.classList.remove("hidden");
      } else {
        authSection?.classList.remove("hidden");
      }
    }
  }

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      activateTab(tab.dataset.tab);
    });
  });

  // Brand click returns to Active Elections
  document.getElementById("navBrandIdentity")?.addEventListener("click", () => {
    activateTab("electionsTab");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initTabNavigation();
  initTelemetryAndResults();
});
