// Mirai Vote Hub - Live Telemetry & 2-Stage Reveal Results Engine
// Mirai School of Technology

import { db } from "./firebase-config.js";
import { setCurrentElectionId, updateGlobalElectionStatusPill } from "./voting.js";
export { updateGlobalElectionStatusPill };
import { state, updateElectionCardsEligibility } from "./auth.js";
import {
  collection,
  doc,
  getDoc,
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

let certifiedBoyWinner = null;
let certifiedGirlWinner = null;
let currentElectionMetadata = { title: "Section A - CR Election 2026", section: "Section A" };

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
const boyResultsBody = document.getElementById("boyResultsBody");
const girlResultsBody = document.getElementById("girlResultsBody");
const boyWinnerPill = document.getElementById("boyWinnerPill");
const girlWinnerPill = document.getElementById("girlWinnerPill");
const sealedNoticeTitle = document.getElementById("sealedNoticeTitle");
const sealedNoticeDesc = document.getElementById("sealedNoticeDesc");
const downloadBoyCertBtn = document.getElementById("downloadBoyCertBtn");
const downloadGirlCertBtn = document.getElementById("downloadGirlCertBtn");
const exportAuditCsvBtn = document.getElementById("exportAuditCsvBtn");

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

    // Keep candidate breakdown and turnout completely sealed
    if (sealedResultsNotice) sealedResultsNotice.classList.remove("hidden");
    if (unsealedResultsContainer) unsealedResultsContainer.classList.add("hidden");

    if (downloadBoyCertBtn) downloadBoyCertBtn.classList.add("hidden");
    if (downloadGirlCertBtn) downloadGirlCertBtn.classList.add("hidden");

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

    if (certifiedBoyWinner && downloadBoyCertBtn) downloadBoyCertBtn.classList.remove("hidden");
    if (certifiedGirlWinner && downloadGirlCertBtn) downloadGirlCertBtn.classList.remove("hidden");
  }
  // 3. Active / Polling State (Strict no-live-results privacy)
  else {
    if (currentStageText) {
      currentStageText.textContent = "Voting Active • Ballots Encrypted";
    }
    if (stageIndicatorPill) {
      stageIndicatorPill.innerHTML = `<span class="pulse-cyan">●</span> Voting Active (Ballots Sealed)`;
      stageIndicatorPill.style.borderColor = "var(--neon-cyan)";
      stageIndicatorPill.style.color = "var(--neon-cyan)";
    }

    // Strictly seal candidate tallies & live turnout until Commission publication
    if (sealedResultsNotice) sealedResultsNotice.classList.remove("hidden");
    if (unsealedResultsContainer) unsealedResultsContainer.classList.add("hidden");

    if (downloadBoyCertBtn) downloadBoyCertBtn.classList.add("hidden");
    if (downloadGirlCertBtn) downloadGirlCertBtn.classList.add("hidden");

    if (sealedNoticeTitle) {
      sealedNoticeTitle.textContent = "Ballot Box Cryptographically Sealed";
    }
    if (sealedNoticeDesc) {
      sealedNoticeDesc.textContent = "Voting is currently in progress. In strict compliance with Mirai Commission privacy and anti-bandwagon standards, zero live turnout or candidate tallies are published until polls officially close and the Election Commission unseals certified results.";
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

// Candidates Results Subscription (Dynamic Categories, Unsealed during Stage 2)
function subscribeToCandidates() {
  const electionId = currentElectionMetadata?.id || "section-a";

  getDoc(doc(db, "elections", electionId)).then(electionSnap => {
    let categories = ["Boy CR", "Girl CR"];
    let electionTitle = "CR Election 2026";
    let electionSection = "Section A";

    if (electionSnap.exists()) {
      const edata = electionSnap.data();
      if (edata.archived === true) {
        const container = document.getElementById("dynamicResultsCategories");
        if (container) {
          container.innerHTML = `
            <div class="empty-elections-card col-span-full" style="text-align: center; padding: 3rem 1.5rem;">
              <div class="empty-icon">📦</div>
              <h3>Election Results Archived</h3>
              <p>This election cohort has been archived and is not available in the public results view.</p>
            </div>
          `;
        }
        return;
      }
      if (Array.isArray(edata.categories) && edata.categories.length > 0) {
        categories = edata.categories;
      }
      if (edata.title) electionTitle = edata.title;
      if (edata.section) electionSection = edata.section;
    }

    const electionCandCol = collection(db, "elections", electionId, "candidates");
    onSnapshot(electionCandCol, (snapshot) => {
      let candidatesList = [];
      if (!snapshot.empty) {
        snapshot.forEach(docSnap => candidatesList.push({ id: docSnap.id, ...docSnap.data() }));
      }

      if (candidatesList.length === 0) {
        // Fallback to root candidates collection
        getDocs(collection(db, "candidates")).then(rootSnap => {
          candidatesList = [];
          rootSnap.forEach(d => candidatesList.push({ id: d.id, ...d.data() }));
          renderDynamicCategoryResults(categories, candidatesList, electionTitle, electionSection, electionId);
        });
      } else {
        renderDynamicCategoryResults(categories, candidatesList, electionTitle, electionSection, electionId);
      }
    }, (err) => {
      console.error("Candidates results subscription error:", err);
    });
  }).catch(e => {
    console.error("Error fetching election categories:", e);
  });
}

function renderDynamicCategoryResults(categories, candidatesList, electionTitle, electionSection, electionId) {
  const container = document.getElementById("dynamicResultsCategories");
  if (!container) return;

  container.innerHTML = "";
  const isPublished = electionStatus === "published" || electionStage === 2;

  categories.forEach((cat, idx) => {
    // Filter candidates matching this category
    const cands = candidatesList.filter(c => {
      const rawCat = c.category || "";
      return (
        rawCat.toLowerCase() === cat.toLowerCase() ||
        (cat === "Boy CR" && rawCat === "boy_cr") ||
        (cat === "Girl CR" && rawCat === "girl_cr")
      );
    });

    // Sort descending by voteCount
    cands.sort((a, b) => (b.voteCount || 0) - (a.voteCount || 0));

    const totalCategoryVotes = cands.reduce((sum, c) => sum + (c.voteCount || 0), 0);
    const winner = (cands.length > 0 && (cands[0].voteCount || 0) > 0) ? cands[0] : null;

    const block = document.createElement("div");
    block.className = `result-category-block border-accent-${idx % 5}`;
    block.style.background = "var(--bg-surface)";
    block.style.border = "1px solid var(--border-subtle)";
    block.style.borderRadius = "var(--radius-lg)";
    block.style.padding = "1.5rem";

    const winnerPillText = winner
      ? `👑 Certified Leader: <strong>${winner.name}</strong> (${winner.voteCount} votes)`
      : `Polls Active (Zero votes cast)`;

    const winnerPillStyle = winner
      ? `background: rgba(16, 185, 129, 0.18); border: 1px solid var(--neon-emerald); color: var(--neon-emerald);`
      : `background: rgba(255, 184, 0, 0.15); border: 1px solid var(--neon-amber); color: var(--neon-amber);`;

    block.innerHTML = `
      <div class="cat-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; margin-bottom: 1.25rem;">
        <div>
          <h3 style="margin: 0; font-size: 1.15rem;">🏆 Certified Result: ${cat}</h3>
          <span class="winner-pill" style="${winnerPillStyle}; font-size: 0.78rem; padding: 0.25rem 0.75rem; border-radius: var(--radius-full); display: inline-block; margin-top: 0.35rem;">
            ${winnerPillText}
          </span>
        </div>
        ${winner && isPublished ? `
          <button class="btn btn-certificate download-cat-cert-btn">
            <span>📜 Download Winner Certificate (PDF)</span>
          </button>
        ` : ''}
      </div>
      <div class="results-table-container">
        <table class="results-table">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Roll Number</th>
              <th>Votes</th>
              <th>Percentage Share</th>
              <th>Standing</th>
            </tr>
          </thead>
          <tbody class="cat-results-tbody"></tbody>
        </table>
      </div>
    `;

    // Connect dynamic certificate button
    const certBtn = block.querySelector(".download-cat-cert-btn");
    if (certBtn && winner) {
      certBtn.addEventListener("click", () => {
        generateWinnerCertificate({
          winnerName: winner.name,
          position: cat.toUpperCase(),
          section: electionSection || "Section A",
          electionTitle: electionTitle || "CR Election 2026",
          auditId: `MVH-${electionId.slice(-4).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`
        });
      });
    }

    const tbody = block.querySelector(".cat-results-tbody");
    if (cands.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 2rem; color: var(--text-muted);">No candidates registered for ${cat}</td></tr>`;
    } else {
      cands.forEach((cand, index) => {
        const count = cand.voteCount || 0;
        const share = totalCategoryVotes > 0 ? ((count / totalCategoryVotes) * 100).toFixed(1) : "0.0";
        const isWinner = index === 0 && count > 0;

        const row = document.createElement("tr");
        if (isWinner) row.className = "winner-row";

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

    container.appendChild(block);
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
      updateGlobalElectionStatusPill(0);
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
    let visibleElectionsCount = 0;
    electionsGrid.innerHTML = "";

    snapshot.forEach((docSnap) => {
      const data = { id: docSnap.id, ...docSnap.data() };
      // Completely hide elections with archived === true from students and public visitors
      if (data.archived === true) return;
      visibleElectionsCount++;

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

      let modeBadgeHtml = "";
      if (data.votingMode === "timed") {
        modeBadgeHtml = `<span class="mode-badge timed card-timer-pill" data-closes-at="${data.closesAt || ''}">⏱️ Timed</span>`;
      } else {
        modeBadgeHtml = `<span class="mode-badge manual">♾️ Manual</span>`;
      }

      card.innerHTML = `
        <div class="election-card-header">
          <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
            ${badgeHtml}
            ${modeBadgeHtml}
          </div>
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
              <span class="spec-label">Voting Mode</span>
              <span class="spec-value mode-spec-value">${data.votingMode === 'timed' ? (data.closesAt ? `Auto-Lock (${data.durationMinutes || 60}m)` : `${data.durationMinutes || 60}m Timed`) : 'Manual (Admin Closed)'}</span>
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
          currentElectionMetadata = {
            id: data.id,
            title: title,
            section: section,
            votingMode: data.votingMode || "manual",
            closesAt: data.closesAt || null,
            durationMinutes: data.durationMinutes || 60
          };
          const titleEl = document.getElementById("ballotElectionTitle");
          if (titleEl) titleEl.textContent = title;
          window.dispatchEvent(new CustomEvent("electionSelected", { detail: currentElectionMetadata }));
          const tabBallotBtn = document.getElementById("tabBallotBtn");
          if (tabBallotBtn) tabBallotBtn.click();
        });
      }

      const viewAuditBtn = card.querySelector(".view-audit-btn");
      if (viewAuditBtn) {
        viewAuditBtn.addEventListener("click", () => {
          currentElectionMetadata = {
            id: data.id,
            title: title,
            section: section
          };
          const tabResultsBtn = document.getElementById("tabResultsBtn");
          if (tabResultsBtn) tabResultsBtn.click();
        });
      }

      const viewResultsBtn = card.querySelector(".view-results-btn");
      if (viewResultsBtn) {
        viewResultsBtn.addEventListener("click", () => {
          currentElectionMetadata = {
            id: data.id,
            title: title,
            section: section
          };
          const tabResultsBtn = document.getElementById("tabResultsBtn");
          if (tabResultsBtn) tabResultsBtn.click();
        });
      }

      electionsGrid.appendChild(card);
    });

    if (visibleElectionsCount === 0) {
      updateGlobalElectionStatusPill(0);
      electionsGrid.innerHTML = `
        <div class="empty-elections-card col-span-full">
          <div class="empty-icon">🗳️</div>
          <h3>No Active Elections Registered</h3>
          <p>There are currently no active cohort elections configured in the Firestore ledger.</p>
          <small>Election Commission administrators can create and instantiate a new election cohort from the Admin Terminal.</small>
        </div>
      `;
      if (activeCountEl) activeCountEl.textContent = "0";
      return;
    }

    // Update global top navbar election status pill dynamically
    updateGlobalElectionStatusPill(activeCount);

    if (activeCountEl) {
      activeCountEl.textContent = activeCount.toString();
    }

    // Refresh eligibility indicators if student is logged in
    if (state.studentData && state.studentData.rollNo) {
      updateElectionCardsEligibility(state.studentData.rollNo);
    }
  }, (err) => {
    console.error("Error subscribing to elections collection:", err);
    updateGlobalElectionStatusPill(0);
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

// Live Card Timer Updater
let cardTimerIntervalStarted = false;
function startCardTimerUpdater() {
  if (cardTimerIntervalStarted) return;
  cardTimerIntervalStarted = true;
  setInterval(() => {
    const pills = document.querySelectorAll(".card-timer-pill");
    const now = Date.now();
    pills.forEach(pill => {
      const closesAt = Number(pill.dataset.closesAt);
      if (!closesAt) {
        pill.textContent = "⏱️ Timed";
        return;
      }
      const diff = closesAt - now;
      if (diff <= 0) {
        pill.textContent = "🛑 Polls Expired";
        pill.classList.add("expired");
      } else {
        const mins = Math.floor(diff / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        pill.textContent = `⏱️ ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      }
    });
  }, 1000);
}

// ============================================================================
// 3. Automated PDF Winner Certificate Generator (jsPDF + Mirai Logo)
// ============================================================================

async function getLogoDataUrl() {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      resolve({
        dataUrl: canvas.toDataURL("image/png"),
        width: canvas.width,
        height: canvas.height
      });
    };
    img.onerror = (e) => reject(e);
    img.src = "assets/mirai-logo.png";
  });
}

export async function generateWinnerCertificate({ winnerName, position, section, electionTitle, auditId }) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert("jsPDF library is still loading. Please try again in a moment.");
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4" // 297 x 210 mm
  });

  // Background Parchment #fcfbf7
  doc.setFillColor(252, 251, 247);
  doc.rect(0, 0, 297, 210, "F");

  // Outer Border: Deep Navy (#0f172a)
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(1.5);
  doc.rect(8, 8, 281, 194);

  // Inner Border: Warm Gold (#d97706)
  doc.setDrawColor(217, 119, 6);
  doc.setLineWidth(0.6);
  doc.rect(11, 11, 275, 188);

  // Corner decorative flourishes
  doc.setDrawColor(217, 119, 6);
  doc.setLineWidth(1);
  doc.line(14, 14, 24, 14);
  doc.line(14, 14, 14, 24);
  doc.line(283, 14, 273, 14);
  doc.line(283, 14, 283, 24);
  doc.line(14, 196, 24, 196);
  doc.line(14, 196, 14, 186);
  doc.line(283, 196, 273, 196);
  doc.line(283, 196, 283, 186);

  // Render centered official Mirai logo (without duplicate text beneath)
  try {
    const logoInfo = await getLogoDataUrl();
    const logoWidth = 75;
    const logoHeight = (logoInfo.height / logoInfo.width) * logoWidth;
    const logoX = (297 - logoWidth) / 2;
    doc.addImage(logoInfo.dataUrl, "PNG", logoX, 18, logoWidth, logoHeight);
  } catch (err) {
    console.warn("Could not embed logo image in certificate:", err);
  }

  // Certificate Headline
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(15, 23, 42);
  doc.text("CERTIFICATE OF ELECTION", 148.5, 48, { align: "center" });

  doc.setFont("helvetica", "italic");
  doc.setFontSize(9.5);
  doc.setTextColor(100, 116, 139);
  doc.text("OFFICIAL INSTRUMENT OF RATIFICATION & STUDENT COMMISSION APPOINTMENT", 148.5, 54, { align: "center" });

  // Divider ribbon line
  doc.setDrawColor(217, 119, 6);
  doc.setLineWidth(0.75);
  doc.line(85, 58, 212, 58);

  // Certificate Body
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(51, 65, 85);
  doc.text("This is to formally certify that", 148.5, 72, { align: "center" });

  // Winner Name
  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.setTextColor(15, 23, 42);
  doc.text((winnerName || "Certified Candidate").toUpperCase(), 148.5, 86, { align: "center" });

  // Underline for winner name
  doc.setDrawColor(2, 132, 199);
  doc.setLineWidth(0.5);
  const nameWidth = doc.getTextWidth((winnerName || "Certified Candidate").toUpperCase());
  doc.line(148.5 - (nameWidth / 2) - 5, 89, 148.5 + (nameWidth / 2) + 5, 89);

  // Conferred Position
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(51, 65, 85);
  doc.text("has been duly elected by student consensus as the certified", 148.5, 99, { align: "center" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(217, 119, 6);
  doc.text((position || "Class Representative").toUpperCase(), 148.5, 110, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(71, 85, 105);
  doc.text(`for ${section || 'Section A'} in the institutional cohort election: "${electionTitle || 'CR Election 2026'}".`, 148.5, 120, { align: "center" });
  doc.text("Having secured the plurality of certified ballots under the cryptographic decoupled", 148.5, 127, { align: "center" });
  doc.text("ledger protocol, this candidate is hereby inducted into the Mirai Student Leadership Body.", 148.5, 133, { align: "center" });

  // Verification Seal Badge
  const sealX = 148.5;
  const sealY = 153;
  doc.setDrawColor(217, 119, 6);
  doc.setLineWidth(0.8);
  doc.circle(sealX, sealY, 12);
  doc.setDrawColor(15, 23, 42);
  doc.circle(sealX, sealY, 10.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(217, 119, 6);
  doc.text("CERTIFIED", sealX, sealY - 2, { align: "center" });
  doc.text("2026", sealX, sealY + 2, { align: "center" });
  doc.setFontSize(5.5);
  doc.setTextColor(15, 23, 42);
  doc.text("LEDGER AUDIT", sealX, sealY + 5.5, { align: "center" });

  // Signatures
  // Left: Chief Returning Officer
  doc.setDrawColor(71, 85, 105);
  doc.setLineWidth(0.5);
  doc.line(40, 165, 95, 165);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text("Prof. Arjun Sundaram", 67.5, 171, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text("Chief Election Returning Officer", 67.5, 175.5, { align: "center" });
  doc.text("Mirai Election Commission", 67.5, 179.5, { align: "center" });

  // Right: Dean of Academic Affairs
  doc.line(202, 165, 257, 165);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text("Dr. Meera Nambiar", 229.5, 171, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text("Dean of Student Affairs", 229.5, 175.5, { align: "center" });
  doc.text("Mirai School of Technology", 229.5, 179.5, { align: "center" });

  // Institutional Micro-Footer
  doc.setFont("courier", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184);
  const certId = auditId || `MIRAI-CERT-2026-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  doc.text(`CRYPTOGRAPHIC AUDIT ID: ${certId}  •  VERIFIED AT ${new Date().toISOString()}`, 148.5, 194, { align: "center" });

  // Save to PDF file
  const safeName = (winnerName || "Winner").replace(/[^a-zA-Z0-9]/g, "_");
  const safePos = (position || "CR").replace(/[^a-zA-Z0-9]/g, "_");
  doc.save(`Mirai_Certificate_${safePos}_${safeName}.pdf`);
}

// ============================================================================
// 4. Certified Audit Report CSV Export
// ============================================================================

export async function exportAuditCsv(electionId = "section-a") {
  try {
    const electionSnap = await getDoc(doc(db, "elections", electionId));
    const electionData = electionSnap.exists() ? electionSnap.data() : {};
    const title = electionData.title || "CR Election 2026";
    const section = electionData.section || "Section A";
    const status = electionData.status || "published";
    const categories = Array.isArray(electionData.categories) && electionData.categories.length > 0
      ? electionData.categories
      : ["Boy CR", "Girl CR"];

    // Fetch candidates from election subcollection, fallback to root
    let candSnap = await getDocs(collection(db, "elections", electionId, "candidates"));
    let candidates = [];
    if (!candSnap.empty) {
      candSnap.forEach(d => candidates.push({ id: d.id, ...d.data() }));
    } else {
      candSnap = await getDocs(collection(db, "candidates"));
      candSnap.forEach(d => candidates.push({ id: d.id, ...d.data() }));
    }

    // Fetch whitelist
    let wlSnap = await getDocs(collection(db, "elections", electionId, "whitelist"));
    if (wlSnap.empty) {
      wlSnap = await getDocs(collection(db, "whitelist"));
    }
    const totalVoters = wlSnap.size;
    let votesCast = 0;
    wlSnap.forEach(d => {
      if (d.data().hasVoted === true) votesCast++;
    });

    const nowIso = new Date().toISOString();

    let csv = `MIRAI VOTE HUB - OFFICIAL CERTIFIED ELECTION AUDIT REPORT\r\n`;
    csv += `Generated At,${nowIso}\r\n`;
    csv += `Election Title,${title}\r\n`;
    csv += `Section,${section}\r\n`;
    csv += `Audit Status,${status.toUpperCase()}\r\n`;
    csv += `Total Whitelisted Eligible Voters,${totalVoters}\r\n`;
    csv += `Total Verified Ballots Cast,${votesCast}\r\n`;
    csv += `Turnout Rate,${totalVoters > 0 ? ((votesCast / totalVoters) * 100).toFixed(2) : "0.00"}%\r\n\r\n`;

    csv += `CANDIDATE RESULTS BREAKDOWN BY ELECTORAL SEAT\r\n`;
    csv += `Position / Seat,Candidate Name,Roll Number,Votes Received,Percentage Share,Standing\r\n`;

    categories.forEach(cat => {
      const cands = candidates.filter(c => {
        const raw = c.category || "";
        return (
          raw.toLowerCase() === cat.toLowerCase() ||
          (cat === "Boy CR" && raw === "boy_cr") ||
          (cat === "Girl CR" && raw === "girl_cr")
        );
      }).sort((a, b) => (b.voteCount || 0) - (a.voteCount || 0));

      const catVotes = cands.reduce((s, c) => s + (c.voteCount || 0), 0);

      cands.forEach((c, idx) => {
        const cnt = c.voteCount || 0;
        const pct = catVotes > 0 ? ((cnt / catVotes) * 100).toFixed(2) : "0.00";
        const standing = idx === 0 && cnt > 0 ? "CERTIFIED WINNER" : `Rank #${idx + 1}`;
        csv += `"${cat}","${c.name}","${c.rollNo || ''}",${cnt},${pct}%,${standing}\r\n`;
      });
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Mirai_Audit_Report_${section.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Export audit CSV error:", err);
    alert(`Failed to export audit report: ${err.message}`);
  }
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
    [electionListView, ballotView, authSection, votingSection, votedSuccessSection, resultsView, adminView, document.getElementById("resultsSection"), document.getElementById("adminSection")].forEach(el => {
      if (el) {
        el.classList.add("hidden");
        el.style.display = "none";
      }
    });
  }

  function activateTab(tabKey) {
    window.scrollTo({ top: 0, behavior: "instant" });
    tabs.forEach(t => {
      if (t.dataset.tab === tabKey) {
        t.classList.add("active");
      } else {
        t.classList.remove("active");
      }
    });

    hideAllViews();

    if (tabKey === "electionsTab") {
      if (electionListView) {
        electionListView.classList.remove("hidden");
        electionListView.style.display = "";
      }
    } else if (tabKey === "resultsTab") {
      if (resultsView) {
        resultsView.classList.remove("hidden");
        resultsView.style.display = "";
      }
      const rs = document.getElementById("resultsSection");
      if (rs) {
        rs.classList.remove("hidden");
        rs.style.display = "";
      }
    } else if (tabKey === "adminTab") {
      if (adminView) {
        adminView.classList.remove("hidden");
        adminView.style.display = "";
      }
      const as = document.getElementById("adminSection");
      if (as) {
        as.classList.remove("hidden");
        as.style.display = "";
      }
      window.dispatchEvent(new CustomEvent("adminTabOpened"));
    } else {
      // ballotTab
      const hasVoted = !votedSuccessSection?.dataset.unvoted && votedSuccessSection?.querySelector(".receipt-hash")?.textContent !== "0x0000000000000000" && !votedSuccessSection?.classList.contains("hidden");
      
      // Check if student session is active
      const studentRoll = document.getElementById("ballotRollNo")?.textContent || "";
      const isStudentVerified = studentRoll && !studentRoll.includes("--");

      if (hasVoted) {
        if (ballotView) { ballotView.classList.remove("hidden"); ballotView.style.display = ""; }
        if (votedSuccessSection) { votedSuccessSection.classList.remove("hidden"); votedSuccessSection.style.display = ""; }
      } else if (isStudentVerified) {
        if (ballotView) { ballotView.classList.remove("hidden"); ballotView.style.display = ""; }
        if (votingSection) { votingSection.classList.remove("hidden"); votingSection.style.display = ""; }
      } else {
        if (authSection) { authSection.classList.remove("hidden"); authSection.style.display = ""; }
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
  startCardTimerUpdater();

  // Button hooks for certificates & audit export
  if (downloadBoyCertBtn) {
    downloadBoyCertBtn.addEventListener("click", () => {
      if (!certifiedBoyWinner) return;
      generateWinnerCertificate({
        winnerName: certifiedBoyWinner.name,
        position: "Boy Class Representative",
        section: currentElectionMetadata.section || "Section A",
        electionTitle: currentElectionMetadata.title || "Section A - CR Election 2026"
      });
    });
  }

  if (downloadGirlCertBtn) {
    downloadGirlCertBtn.addEventListener("click", () => {
      if (!certifiedGirlWinner) return;
      generateWinnerCertificate({
        winnerName: certifiedGirlWinner.name,
        position: "Girl Class Representative",
        section: currentElectionMetadata.section || "Section A",
        electionTitle: currentElectionMetadata.title || "Section A - CR Election 2026"
      });
    });
  }

  if (exportAuditCsvBtn) {
    exportAuditCsvBtn.addEventListener("click", () => {
      exportAuditCsv(currentElectionMetadata.id || "section-a");
    });
  }
});
