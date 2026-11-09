// Mirai Vote Hub - Live Telemetry & 2-Stage Reveal Results Engine
// Mirai School of Technology - CSE AI/ML

import { db } from "./firebase-config.js";
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

// Listen to Election Metadata & Reveal Control
export function initTelemetryAndResults() {
  const metaRef = doc(db, "election_meta", "config");

  onSnapshot(metaRef, (docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data();
      electionStage = data.revealStage || 1;
      
      if (electionStatusLabel && data.status) {
        electionStatusLabel.textContent = `Election ${data.status.toUpperCase()}`;
      }

      applyRevealStage(electionStage);
    } else {
      // Default to Stage 1 if config not yet initialized
      applyRevealStage(1);
    }
  }, (error) => {
    console.warn("Real-time election_meta subscription warning:", error);
    applyRevealStage(1);
  });

  // Listen to Whitelist count & voted count
  subscribeToTurnout();

  // Listen to Candidates if Stage 2 is unlocked
  subscribeToCandidates();
}

function applyRevealStage(stage) {
  if (stage === 1) {
    if (currentStageText) currentStageText.textContent = "Stage 1: Live Turnout Telemetry";
    if (sealedResultsNotice) sealedResultsNotice.classList.remove("hidden");
    if (unsealedResultsContainer) unsealedResultsContainer.classList.add("hidden");
  } else if (stage === 2) {
    if (currentStageText) currentStageText.textContent = "Stage 2: Official Certified Results Unsealed";
    if (sealedResultsNotice) sealedResultsNotice.classList.add("hidden");
    if (unsealedResultsContainer) unsealedResultsContainer.classList.remove("hidden");
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
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">No candidates registered for ${seatLabel}</td></tr>`;
    if (winnerPill) winnerPill.textContent = "No Candidates";
    return;
  }

  const totalCategoryVotes = candidates.reduce((sum, c) => sum + (c.voteCount || 0), 0);
  const highestVotes = candidates[0].voteCount || 0;

  // Set Winner Pill
  if (winnerPill) {
    if (highestVotes > 0) {
      winnerPill.textContent = `Leader: ${candidates[0].name} (${highestVotes} votes)`;
    } else {
      winnerPill.textContent = "Polls Active (Zero votes cast)";
    }
  }

  candidates.forEach((cand, index) => {
    const count = cand.voteCount || 0;
    const share = totalCategoryVotes > 0 ? ((count / totalCategoryVotes) * 100).toFixed(1) : "0.0";
    const isWinner = index === 0 && count > 0;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td><strong>${cand.name}</strong> ${isWinner ? '👑' : ''}</td>
      <td class="mono">${cand.rollNo || 'Certified'}</td>
      <td class="mono">${count}</td>
      <td>
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <span>${share}%</span>
          <div style="flex:1; height:6px; background:var(--bg-surface); border-radius:4px; overflow:hidden;">
            <div style="width:${share}%; height:100%; background:var(--accent-primary);"></div>
          </div>
        </div>
      </td>
      <td><span class="badge ${isWinner ? 'badge-success' : 'badge-secondary'}">Rank #${index + 1}</span></td>
    `;
    tbody.appendChild(row);
  });
}

// Global Tab Navigation Controller
function initTabNavigation() {
  const tabs = document.querySelectorAll(".nav-tab");
  const sections = {
    ballotTab: [document.getElementById("authSection"), document.getElementById("votingSection"), document.getElementById("votedSuccessSection")],
    resultsTab: [document.getElementById("resultsSection")],
    adminTab: [document.getElementById("adminSection")]
  };

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const targetKey = tab.dataset.tab;
      
      // Update tab styles
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      // Hide all main view sections
      document.getElementById("resultsSection")?.classList.add("hidden");
      document.getElementById("adminSection")?.classList.add("hidden");
      
      if (targetKey === "resultsTab") {
        document.getElementById("authSection")?.classList.add("hidden");
        document.getElementById("votingSection")?.classList.add("hidden");
        document.getElementById("votedSuccessSection")?.classList.add("hidden");
        document.getElementById("resultsSection")?.classList.remove("hidden");
      } else if (targetKey === "adminTab") {
        document.getElementById("authSection")?.classList.add("hidden");
        document.getElementById("votingSection")?.classList.add("hidden");
        document.getElementById("votedSuccessSection")?.classList.add("hidden");
        document.getElementById("adminSection")?.classList.remove("hidden");
        window.dispatchEvent(new CustomEvent("adminTabOpened"));
      } else {
        // Ballot Tab: Return to appropriate ballot state
        document.getElementById("resultsSection")?.classList.add("hidden");
        document.getElementById("adminSection")?.classList.add("hidden");
        
        // Auth or Voting or Success
        const hasVoted = !document.getElementById("votedSuccessSection")?.classList.contains("hidden");
        const inVoting = !document.getElementById("votingSection")?.classList.contains("hidden");

        if (hasVoted) {
          document.getElementById("votedSuccessSection")?.classList.remove("hidden");
        } else if (inVoting) {
          document.getElementById("votingSection")?.classList.remove("hidden");
        } else {
          document.getElementById("authSection")?.classList.remove("hidden");
        }
      }
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initTabNavigation();
  initTelemetryAndResults();
});
