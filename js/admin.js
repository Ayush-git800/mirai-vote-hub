// Mirai Vote Hub - Admin & Election Commission Controller
export const ADMIN_USERNAME = "admin";
export const ADMIN_PASSKEY = "admin@123";
export const ADMIN_USER = ADMIN_USERNAME;
export const ADMIN_PIN = ADMIN_PASSKEY;

import { db } from "./firebase-config.js";
import { showAlert } from "./auth.js";
import { exportAuditCsv, generateWinnerCertificate } from "./results.js";
import {
  collection,
  doc,
  getDoc,
  setDoc,
  getDocs,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Whitelist Ingestion Elements
const whitelistFileInput = document.getElementById("whitelistFileInput");
const whitelistDropZone = document.getElementById("whitelistDropZone");
const whitelistBatchTextarea = document.getElementById("whitelistBatchTextarea");
const whitelistJsonText = document.getElementById("whitelistJsonText");
const processWhitelistBtn = document.getElementById("processWhitelistBtn");
const importWhitelistBtn = document.getElementById("importWhitelistBtn");
const whitelistImportStatus = document.getElementById("whitelistImportStatus");

// State & Reveal Elements
const lifecycleDraftBtn = document.getElementById("lifecycleDraftBtn");
const lifecycleActiveBtn = document.getElementById("lifecycleActiveBtn");
const lifecycleConcludedBtn = document.getElementById("lifecycleConcludedBtn");
const lifecyclePublishBtn = document.getElementById("lifecyclePublishBtn");
const stage1Btn = document.getElementById("stage1Btn");
const stage2Btn = document.getElementById("stage2Btn");
const purgeElectionDataBtn = document.getElementById("purgeElectionDataBtn");

// Candidate Management Elements
const adminCandidateRegistryForm = document.getElementById("adminCandidateRegistryForm");
const adminBoyCandidateList = document.getElementById("adminBoyCandidateList");
const adminGirlCandidateList = document.getElementById("adminGirlCandidateList");

// ============================================================================
// 1. Admin Authentication Engine (Bypasses Firebase Auth API Key Requirement)
// ============================================================================

export function authenticateAdmin(username, password) {
  const cleanUser = (username || "").trim();
  const cleanPin = (password || "").trim();

  // Deterministic validation: strictly verified against code-locked constants
  const isUserValid = cleanUser === ADMIN_USERNAME;
  const isPinValid = cleanPin === ADMIN_PASSKEY;

  if (isUserValid && isPinValid) {
    sessionStorage.setItem("isAdminAuthenticated", "true");

    // Close modal
    const adminModal = document.getElementById("adminLoginModal");
    if (adminModal) adminModal.classList.add("hidden");

    // Clear any alert banners
    const alertBanner = document.getElementById("alertBanner");
    if (alertBanner) {
      alertBanner.classList.add("hidden");
      alertBanner.style.display = "none";
    }

    // Reveal Admin Terminal Tab & View
    const tabAdminBtn = document.getElementById("tabAdminBtn");
    if (tabAdminBtn) tabAdminBtn.classList.remove("hidden");
    tabAdminBtn?.click();

    // Update Header Status & Profile (hide Admin Access button)
    const adminToggleBtn = document.getElementById("adminToggleBtn");
    if (adminToggleBtn) adminToggleBtn.classList.add("hidden");

    const userProfile = document.getElementById("userProfile");
    const userDisplayName = document.getElementById("userDisplayName");
    const userRoleBadge = document.getElementById("userRoleBadge");
    if (userProfile && userDisplayName && userRoleBadge) {
      userProfile.classList.remove("hidden");
      userDisplayName.textContent = "Admin Officer";
      userRoleBadge.textContent = "COMMISSION";
      userRoleBadge.style.color = "var(--neon-amber)";
    }

    showAlert("Admin Officer session authenticated successfully.", "success");
    return true;
  } else {
    showAlert("Invalid admin credentials. Please enter valid Officer ID and Security PIN.", "error");
    return false;
  }
}

export function logoutAdmin() {
  sessionStorage.removeItem("isAdminAuthenticated");

  // Hide admin tab
  const tabAdminBtn = document.getElementById("tabAdminBtn");
  if (tabAdminBtn) tabAdminBtn.classList.add("hidden");

  // Reset header profile and restore Admin Access button
  const userProfile = document.getElementById("userProfile");
  if (userProfile) userProfile.classList.add("hidden");

  const adminToggleBtn = document.getElementById("adminToggleBtn");
  if (adminToggleBtn) adminToggleBtn.classList.remove("hidden");

  // Return to active elections view
  document.getElementById("tabElectionsBtn")?.click();
  showAlert("Admin session signed out.", "info");
}

export function checkAdminSession() {
  if (sessionStorage.getItem("isAdminAuthenticated") === "true") {
    const tabAdminBtn = document.getElementById("tabAdminBtn");
    if (tabAdminBtn) tabAdminBtn.classList.remove("hidden");

    const adminToggleBtn = document.getElementById("adminToggleBtn");
    if (adminToggleBtn) adminToggleBtn.classList.add("hidden");

    const userProfile = document.getElementById("userProfile");
    const userDisplayName = document.getElementById("userDisplayName");
    const userRoleBadge = document.getElementById("userRoleBadge");
    if (userProfile && userDisplayName && userRoleBadge) {
      userProfile.classList.remove("hidden");
      userDisplayName.textContent = "Admin Officer";
      userRoleBadge.textContent = "COMMISSION";
      userRoleBadge.style.color = "var(--neon-amber)";
    }
    return true;
  }
  return false;
}

// ============================================================================
// 2. Election Creation & Section Management
// ============================================================================

export async function createElection(title, department, section, mode = "manual", durationMinutes = 60) {
  if (!title) throw new Error("Election title is required.");
  const safeSection = (section || "A").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const electionId = `section-${safeSection || "cohort"}`;

  try {
    const electionRef = doc(db, "elections", electionId);
    const electionData = {
      id: electionId,
      title: title,
      section: section || "Section A",
      status: "draft",
      revealStage: 1,
      votingMode: mode || "manual",
      durationMinutes: Number(durationMinutes) || 60,
      closesAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(electionRef, electionData, { merge: true });

    // Also update global election_meta config
    const metaRef = doc(db, "election_meta", "config");
    await setDoc(metaRef, {
      activeElectionId: electionId,
      title: title,
      section: section || "Section A",
      status: "draft",
      revealStage: 1,
      votingMode: mode || "manual",
      durationMinutes: Number(durationMinutes) || 60,
      closesAt: null,
      updatedAt: serverTimestamp()
    }, { merge: true });

    showAlert(`Election '${title}' created successfully (${mode === 'timed' ? `${durationMinutes}m Timed` : 'Manual'})!`, "success");
    return electionId;
  } catch (err) {
    console.error("Create election failed:", err);
    showAlert(`Failed to create election: ${err.message}`, "error");
    throw err;
  }
}

// ============================================================================
// 3. Batch Whitelist Importer (Handles whitespace, commas, line breaks, CSV, JSON)
// ============================================================================

export function parseWhitelistInput(rawText) {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  // JSON Array Parse attempt
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      return arr.map(item => {
        const roll = (item.rollNo || item.id || item.roll_no || "").trim().toUpperCase();
        return {
          rollNo: roll,
          name: item.name || `Student ${roll}`,
          email: item.email || `${roll.toLowerCase()}@mirai.ac.in`,
          section: item.section || "Section A",
          hasVoted: false
        };
      }).filter(v => v.rollNo.length >= 4);
    } catch (e) {
      // Fall through to delimiter parser
    }
  }

  // Token & Delimiter Parser (whitespace, commas, line breaks)
  const lines = trimmed.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  const voters = [];
  const seen = new Set();

  for (const line of lines) {
    if (line.includes(",")) {
      const cols = line.split(",").map(c => c.trim());
      const rawRoll = cols[0].toUpperCase();
      if (rawRoll.includes("ROLL") || rawRoll.includes("ID") || rawRoll.includes("NAME")) {
        continue;
      }
      const roll = rawRoll.replace(/[^A-Z0-9]/g, "");
      if (roll && roll.length >= 4 && !seen.has(roll)) {
        seen.add(roll);
        voters.push({
          rollNo: roll,
          name: cols[1] || `Student ${roll}`,
          email: cols[2] || `${roll.toLowerCase()}@mirai.ac.in`,
          section: "Section A",
          hasVoted: false
        });
      }
    } else {
      const tokens = line.split(/[\s,;]+/).map(t => t.trim().toUpperCase()).filter(Boolean);
      for (const tok of tokens) {
        const roll = tok.replace(/[^A-Z0-9]/g, "");
        if (roll && roll.length >= 4 && !seen.has(roll)) {
          seen.add(roll);
          voters.push({
            rollNo: roll,
            name: `Student ${roll}`,
            email: `${roll.toLowerCase()}@mirai.ac.in`,
            section: "Section A",
            hasVoted: false
          });
        }
      }
    }
  }

  return voters;
}

export async function uploadWhitelist(electionId = "section-a", rawText) {
  const voters = parseWhitelistInput(rawText);
  if (!voters || voters.length === 0) {
    showAlert("No valid student IDs found in input.", "error");
    return 0;
  }

  try {
    if (processWhitelistBtn) processWhitelistBtn.disabled = true;
    if (whitelistImportStatus) {
      whitelistImportStatus.textContent = `Processing and committing ${voters.length} student records...`;
      whitelistImportStatus.className = "import-status processing";
    }

    const CHUNK_SIZE = 400;
    let committed = 0;

    for (let i = 0; i < voters.length; i += CHUNK_SIZE) {
      const chunk = voters.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);

      chunk.forEach(voter => {
        const rollKey = voter.rollNo;

        // Subcollection: elections/{electionId}/whitelist/{studentId}
        const electionWhitelistRef = doc(db, "elections", electionId, "whitelist", rollKey);
        batch.set(electionWhitelistRef, {
          rollNo: rollKey,
          name: voter.name,
          email: voter.email,
          section: voter.section || "Section A",
          hasVoted: false,
          updatedAt: serverTimestamp()
        }, { merge: true });

        // Root whitelist compatibility: whitelist/{studentId}
        const rootWhitelistRef = doc(db, "whitelist", rollKey);
        batch.set(rootWhitelistRef, {
          rollNo: rollKey,
          name: voter.name,
          email: voter.email,
          section: voter.section || "Section A",
          hasVoted: false,
          claimed: false,
          updatedAt: serverTimestamp()
        }, { merge: true });
      });

      await batch.commit();
      committed += chunk.length;

      if (whitelistImportStatus) {
        whitelistImportStatus.textContent = `Committed ${committed} / ${voters.length} whitelist records...`;
      }
    }

    showAlert(`Successfully imported ${committed} whitelisted voters into ${electionId}!`, "success");
    if (whitelistImportStatus) {
      whitelistImportStatus.textContent = `✅ Successfully certified ${committed} student IDs.`;
      whitelistImportStatus.className = "import-status success";
    }

    return committed;

  } catch (error) {
    console.error("Upload whitelist failure:", error);
    showAlert(`Whitelist import failed: ${error.message}`, "error");
    if (whitelistImportStatus) {
      whitelistImportStatus.textContent = `❌ Import Error: ${error.message}`;
      whitelistImportStatus.className = "import-status error";
    }
    throw error;
  } finally {
    if (processWhitelistBtn) processWhitelistBtn.disabled = false;
  }
}

// ============================================================================
// 4. Candidate Registration & Management
// ============================================================================

export async function addCandidate(electionId = "section-a", { name, category, photoUrl, manifesto, rollNo }) {
  if (!name) throw new Error("Candidate name is required.");
  const safeRoll = (rollNo || name).trim().replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const candId = `${category}_${safeRoll}`;

  try {
    const candidateData = {
      id: candId,
      name: name.trim(),
      category: category,
      rollNo: (rollNo || "Certified").trim().toUpperCase(),
      manifesto: manifesto || "Committed to representing student cohort interests.",
      photoUrl: photoUrl || "",
      voteCount: 0,
      createdAt: serverTimestamp()
    };

    // Subcollection: elections/{electionId}/candidates/{candidateId}
    const electionCandRef = doc(db, "elections", electionId, "candidates", candId);
    await setDoc(electionCandRef, candidateData, { merge: true });

    // Root candidates: candidates/{candidateId}
    const rootCandRef = doc(db, "candidates", candId);
    await setDoc(rootCandRef, candidateData, { merge: true });

    showAlert(`Candidate ${name} registered for ${category === "boy_cr" ? "Boy CR" : "Girl CR"}!`, "success");
    loadAdminCandidates();
    return candId;

  } catch (err) {
    console.error("Add candidate error:", err);
    showAlert(`Failed to register candidate: ${err.message}`, "error");
    throw err;
  }
}

// ============================================================================
// 5. Election Lifecycle Controls
// Supports: "draft", "active", "ended", "published"
// ============================================================================

export async function setElectionStatus(electionId = "section-a", status) {
  const validStates = ["draft", "active", "ended", "published", "ready", "concluded"];
  if (!validStates.includes(status)) {
    throw new Error(`Invalid election status: ${status}`);
  }

  let canonicalStatus = status;
  let revealStage = 1;

  if (status === "published") {
    canonicalStatus = "concluded";
    revealStage = 2;
  } else if (status === "ended") {
    canonicalStatus = "concluded";
    revealStage = 1;
  } else if (status === "draft") {
    canonicalStatus = "ready";
    revealStage = 1;
  } else if (status === "active") {
    canonicalStatus = "active";
    revealStage = 1;
  }

  try {
    const electionRef = doc(db, "elections", electionId);
    const existingSnap = await getDoc(electionRef);
    const existingData = existingSnap.exists() ? existingSnap.data() : {};

    let closesAt = existingData.closesAt || null;
    if (status === "active" && existingData.votingMode === "timed") {
      const mins = Number(existingData.durationMinutes) || 60;
      closesAt = Date.now() + mins * 60 * 1000;
    }

    const updatePayload = {
      status: canonicalStatus,
      revealStage: revealStage,
      updatedAt: serverTimestamp()
    };
    if (closesAt) updatePayload.closesAt = closesAt;

    await setDoc(electionRef, updatePayload, { merge: true });

    const metaRef = doc(db, "election_meta", "config");
    await setDoc(metaRef, updatePayload, { merge: true });

    showAlert(`Election status transitioned to: ${status.toUpperCase()}`, "success");
    highlightLifecycleButtons(status);

    const statusLabel = document.getElementById("electionStatusLabel");
    if (statusLabel) {
      if (status === "active") statusLabel.textContent = "Election Active";
      else if (status === "draft" || status === "ready") statusLabel.textContent = "Election in Draft";
      else if (status === "ended" || status === "concluded") statusLabel.textContent = "Election Sealed";
      else if (status === "published") statusLabel.textContent = "Results Published";
    }

  } catch (err) {
    console.error("Set election status error:", err);
    showAlert(`Failed to set election status: ${err.message}`, "error");
    throw err;
  }
}

export async function updateRevealStage(stage) {
  try {
    const metaRef = doc(db, "election_meta", "config");
    await setDoc(metaRef, { revealStage: stage, updatedAt: serverTimestamp() }, { merge: true });
    showAlert(`Auditing Reveal set to Stage ${stage}`, "success");
    if (stage === 2) {
      highlightLifecycleButtons("published");
    } else {
      highlightLifecycleButtons("active");
    }
  } catch (err) {
    showAlert(`Failed to update reveal stage: ${err.message}`, "error");
  }
}

function highlightLifecycleButtons(status) {
  const btnMap = {
    draft: lifecycleDraftBtn,
    ready: lifecycleDraftBtn,
    active: lifecycleActiveBtn,
    ended: lifecycleConcludedBtn,
    concluded: lifecycleConcludedBtn,
    published: lifecyclePublishBtn
  };

  [lifecycleDraftBtn, lifecycleActiveBtn, lifecycleConcludedBtn, lifecyclePublishBtn].forEach(b => {
    b?.classList.remove("active");
  });

  if (btnMap[status]) {
    btnMap[status]?.classList.add("active");
  }
}

// ============================================================================
// 5B. Admin QoL: Archive, Delete & Management Ledger
// ============================================================================

export async function archiveElection(electionId) {
  try {
    const electionRef = doc(db, "elections", electionId);
    await setDoc(electionRef, { status: "archived", updatedAt: serverTimestamp() }, { merge: true });
    showAlert(`Election '${electionId}' has been archived.`, "info");
  } catch (err) {
    showAlert(`Failed to archive election: ${err.message}`, "error");
  }
}

export async function deleteElection(electionId) {
  const confirmation = confirm(`CRITICAL ACTION: Permanently delete election cohort '${electionId}'?\nAll associated ledger settings will be removed.`);
  if (!confirmation) return;

  try {
    await deleteDoc(doc(db, "elections", electionId));
    showAlert(`Election '${electionId}' deleted successfully.`, "success");
  } catch (err) {
    showAlert(`Failed to delete election: ${err.message}`, "error");
  }
}

// ============================================================================
// 5C. Voter Audit & Roll Lookup with Emergency Reset
// ============================================================================

let currentLookedUpRoll = null;
let currentLookedUpElectionId = "section-a";

export async function lookupVoter(rollNo, electionId = "section-a") {
  const inputEl = document.getElementById("voterLookupInput") || document.getElementById("voterLookupRollInput");
  const cleanRoll = (rollNo || inputEl?.value || "").trim().toUpperCase();
  if (!cleanRoll) {
    showAlert("Please enter a valid Student Roll Number to verify.", "error");
    return;
  }

  const resultContainer = document.getElementById("voterLookupResult");
  const emergencyResetBtn = document.getElementById("emergencyResetVoterBtn");
  if (!resultContainer) return;

  resultContainer.classList.remove("hidden");
  resultContainer.innerHTML = `<span class="spinner"></span> Verifying student roll '${cleanRoll}' across certification ledger...`;

  try {
    currentLookedUpRoll = cleanRoll;
    currentLookedUpElectionId = electionId;

    // Check election whitelist
    const electionVoterRef = doc(db, "elections", electionId, "whitelist", cleanRoll);
    const electionVoterSnap = await getDoc(electionVoterRef);

    // Check root whitelist
    const rootVoterRef = doc(db, "whitelist", cleanRoll);
    const rootVoterSnap = await getDoc(rootVoterRef);

    if (!electionVoterSnap.exists() && !rootVoterSnap.exists()) {
      resultContainer.innerHTML = `
        <span class="voter-status-badge not-whitelisted">Not Whitelisted</span>
        <p style="margin: 0.35rem 0 0; color: var(--text-secondary); font-size: 0.88rem;">
          Roll Number <strong class="mono" style="color:var(--neon-rose);">${cleanRoll}</strong> is not certified on the election whitelist.
        </p>
      `;
      if (emergencyResetBtn) emergencyResetBtn.classList.add("hidden");
      return;
    }

    const data = electionVoterSnap.exists() ? electionVoterSnap.data() : rootVoterSnap.data();
    const hasVoted = data.hasVoted === true;

    if (!hasVoted) {
      resultContainer.innerHTML = `
        <span class="voter-status-badge pending">Whitelisted • Pending Vote</span>
        <div style="font-size: 0.88rem; color: var(--text-secondary); margin-top: 0.35rem; line-height: 1.5;">
          <div>Student Name: <strong style="color:var(--text-primary);">${data.name || 'Certified Voter'}</strong></div>
          <div>Roll Number: <span class="mono" style="color:var(--neon-cyan);">${data.rollNo || cleanRoll}</span></div>
          <div>Cohort: ${data.section || 'Section A'}</div>
          <div style="color: var(--neon-cyan); margin-top: 0.25rem;">● Certified eligible. Ballot not yet cast.</div>
        </div>
      `;
      if (emergencyResetBtn) emergencyResetBtn.classList.add("hidden");
    } else {
      const receiptToken = data.receiptHash || "0xMIRAI-SEALED-BALLOT";
      const votedTime = data.updatedAt ? new Date(data.updatedAt.toDate ? data.updatedAt.toDate() : data.updatedAt).toLocaleString() : "Audit Recorded";
      resultContainer.innerHTML = `
        <span class="voter-status-badge voted">Whitelisted • Voted</span>
        <div style="font-size: 0.88rem; color: var(--text-secondary); margin-top: 0.35rem; line-height: 1.5;">
          <div>Student Name: <strong style="color:var(--text-primary);">${data.name || 'Certified Voter'}</strong></div>
          <div>Roll Number: <span class="mono" style="color:var(--neon-emerald); font-weight:700;">${data.rollNo || cleanRoll}</span></div>
          <div>Ballot Receipt: <span class="mono highlight-cyan" style="word-break: break-all;">${receiptToken}</span></div>
          <div>Timestamp: <span>${votedTime}</span></div>
        </div>
      `;
      if (emergencyResetBtn) emergencyResetBtn.classList.remove("hidden");
    }
  } catch (err) {
    console.error("Voter lookup failure:", err);
    resultContainer.innerHTML = `<div class="error-msg">Lookup error: ${err.message}</div>`;
    if (emergencyResetBtn) emergencyResetBtn.classList.add("hidden");
  }
}

export async function emergencyResetVoter(rollNo, electionId = "section-a") {
  const cleanRoll = (rollNo || currentLookedUpRoll || "").trim().toUpperCase();
  if (!cleanRoll) return;

  const confirmed = confirm(
    `EMERGENCY ACTION: Reset ballot status for Student ID: ${cleanRoll}?\n\nThis will void their marked participation flag and allow them to recast a ballot.`
  );
  if (!confirmed) return;

  try {
    const batch = writeBatch(db);

    const electionVoterRef = doc(db, "elections", electionId, "whitelist", cleanRoll);
    batch.update(electionVoterRef, {
      hasVoted: false,
      receiptHash: null,
      updatedAt: serverTimestamp()
    });

    const rootVoterRef = doc(db, "whitelist", cleanRoll);
    batch.update(rootVoterRef, {
      hasVoted: false,
      claimed: false,
      receiptHash: null,
      updatedAt: serverTimestamp()
    });

    await batch.commit();

    showAlert(`Emergency reset confirmed for Roll Number ${cleanRoll}.`, "success");
    lookupVoter(cleanRoll, electionId);
  } catch (err) {
    console.error("Emergency reset error:", err);
    showAlert(`Reset failed: ${err.message}`, "error");
  }
}

// ============================================================================
// 5D. Real-time Admin Elections Ledger
// ============================================================================

export function initAdminElectionsTable() {
  const tbody = document.getElementById("adminElectionsTableBody");
  if (!tbody) return;

  const electionsCol = collection(db, "elections");
  onSnapshot(electionsCol, (snapshot) => {
    tbody.innerHTML = "";
    if (snapshot.empty) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 2rem; color: var(--text-muted);">No elections registered yet. Create one above!</td></tr>`;
      return;
    }

    snapshot.forEach(docSnap => {
      const data = { id: docSnap.id, ...docSnap.data() };
      const row = document.createElement("tr");

      const modeBadge = data.votingMode === "timed"
        ? `<span class="mode-badge timed">⏱️ ${data.durationMinutes || 60}m Timed</span>`
        : `<span class="mode-badge manual">♾️ Manual</span>`;

      const statusBadge = `<span class="badge ${data.status === 'active' ? 'badge-primary' : data.status === 'published' ? 'badge-winner' : 'badge-secondary'}">${(data.status || 'draft').toUpperCase()}</span>`;

      row.innerHTML = `
        <td><strong>${data.title || data.id}</strong><br><small class="mono text-muted">${data.id}</small></td>
        <td>${data.section || 'Section A'}</td>
        <td>${modeBadge}</td>
        <td>${statusBadge}</td>
        <td>
          <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
            ${data.status !== 'active' ? `<button class="btn btn-cyber-primary btn-sm admin-act-btn" data-act="start" data-id="${data.id}">Start</button>` : `<button class="btn btn-cyber-outline btn-sm admin-act-btn" data-act="end" data-id="${data.id}">End</button>`}
            ${data.status === 'concluded' || data.status === 'ended' ? `<button class="btn btn-cyber-primary btn-sm admin-act-btn" data-act="publish" data-id="${data.id}">Publish</button>` : ''}
            <button class="btn btn-cyber-outline btn-sm admin-act-btn" data-act="archive" data-id="${data.id}">Archive</button>
            <button class="btn btn-danger btn-sm admin-act-btn" data-act="delete" data-id="${data.id}">&times;</button>
          </div>
        </td>
      `;

      row.querySelectorAll(".admin-act-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const act = btn.dataset.act;
          const id = btn.dataset.id;
          if (act === "start") setElectionStatus(id, "active");
          else if (act === "end") setElectionStatus(id, "ended");
          else if (act === "publish") setElectionStatus(id, "published");
          else if (act === "archive") archiveElection(id);
          else if (act === "delete") deleteElection(id);
        });
      });

      tbody.appendChild(row);
    });
  }, (err) => {
    console.error("Admin elections ledger error:", err);
  });
}

export async function deleteCandidate(candidateId, electionId = "section-a") {
  if (!confirm(`Are you sure you want to remove candidate (${candidateId})?`)) return;
  try {
    await deleteDoc(doc(db, "elections", electionId, "candidates", candidateId)).catch(() => {});
    await deleteDoc(doc(db, "candidates", candidateId));
    showAlert("Candidate deleted.", "info");
    loadAdminCandidates();
  } catch (error) {
    showAlert(`Delete failed: ${error.message}`, "error");
  }
}

async function loadAdminCandidates(electionId = "section-a") {
  try {
    const snapshot = await getDocs(collection(db, "candidates"));
    if (adminBoyCandidateList) adminBoyCandidateList.innerHTML = "";
    if (adminGirlCandidateList) adminGirlCandidateList.innerHTML = "";

    snapshot.forEach(docSnap => {
      const data = { id: docSnap.id, ...docSnap.data() };
      const row = document.createElement("div");
      row.className = "admin-candidate-row";
      row.innerHTML = `
        <div>
          <strong>${data.name}</strong> 
          <span class="mono">(${data.rollNo || data.id})</span>
        </div>
        <button class="btn btn-danger btn-sm" data-id="${data.id}">&times; Remove</button>
      `;

      row.querySelector("button").addEventListener("click", () => deleteCandidate(data.id, electionId));

      if (data.category === "boy_cr" && adminBoyCandidateList) {
        adminBoyCandidateList.appendChild(row);
      } else if (data.category === "girl_cr" && adminGirlCandidateList) {
        adminGirlCandidateList.appendChild(row);
      }
    });
  } catch (err) {
    console.error("Load admin candidates error:", err);
  }
}

async function purgeElectionVotes() {
  const code = prompt("CRITICAL ACTION: Type 'RESET-MIRAI' to reset all cast votes and whitelist vote flags:");
  if (code !== "RESET-MIRAI") {
    showAlert("Reset aborted.", "info");
    return;
  }

  try {
    showAlert("Purging vote records and resetting whitelist...", "info");

    const whitelistSnap = await getDocs(collection(db, "whitelist"));
    const batch = writeBatch(db);
    whitelistSnap.forEach(d => {
      batch.update(doc(db, "whitelist", d.id), {
        hasVoted: false,
        claimed: false,
        receiptHash: null,
        votedAt: null
      });
    });

    const candSnap = await getDocs(collection(db, "candidates"));
    candSnap.forEach(c => {
      batch.update(doc(db, "candidates", c.id), { voteCount: 0 });
    });

    await batch.commit();

    const votesSnap = await getDocs(collection(db, "votes"));
    for (const v of votesSnap.docs) {
      await deleteDoc(doc(db, "votes", v.id));
    }

    showAlert("Election ledger successfully reset to Zero baseline.", "success");
  } catch (error) {
    showAlert(`Reset failed: ${error.message}`, "error");
  }
}

// ============================================================================
// 6. Setup Event Listeners
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  // Check persisted admin session on load
  checkAdminSession();

  // Admin Login Modal form submission
  const adminForm = document.getElementById("adminLoginForm");
  if (adminForm) {
    adminForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const user = document.getElementById("adminEmailInput")?.value;
      const pass = document.getElementById("adminPasswordInput")?.value;
      authenticateAdmin(user, pass);
    });
  }

  // Admin Logout Button in Dashboard
  const adminLogoutBtn = document.getElementById("adminLogoutBtn");
  if (adminLogoutBtn) {
    adminLogoutBtn.addEventListener("click", logoutAdmin);
  }

  // Batch Whitelist Processing Button
  if (processWhitelistBtn && whitelistBatchTextarea) {
    processWhitelistBtn.addEventListener("click", () => {
      const raw = whitelistBatchTextarea.value.trim();
      if (!raw) {
        showAlert("Please paste student IDs or CSV roster into the box.", "error");
        return;
      }
      uploadWhitelist("section-a", raw);
    });
  }

  // File Drop Zone for CSV / JSON
  if (whitelistDropZone && whitelistFileInput) {
    whitelistDropZone.addEventListener("click", () => whitelistFileInput.click());
    whitelistFileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        const text = evt.target.result;
        uploadWhitelist("section-a", text);
      };
      reader.readAsText(file);
    });
  }

  // Create Election Form
  const createElectionForm = document.getElementById("createElectionForm");
  const newElectionMode = document.getElementById("newElectionMode");
  const electionDurationGroup = document.getElementById("electionDurationGroup");

  if (newElectionMode && electionDurationGroup) {
    newElectionMode.addEventListener("change", (e) => {
      if (e.target.value === "timed") {
        electionDurationGroup.classList.remove("hidden");
      } else {
        electionDurationGroup.classList.add("hidden");
      }
    });
  }

  if (createElectionForm) {
    createElectionForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = document.getElementById("newElectionTitle")?.value.trim();
      const section = document.getElementById("newElectionSection")?.value.trim();
      const mode = document.getElementById("newElectionMode")?.value || "manual";
      const duration = document.getElementById("newElectionDuration")?.value || 60;

      if (!title) {
        showAlert("Election title is required.", "error");
        return;
      }

      await createElection(title, "Mirai School of Technology", section, mode, duration);
      createElectionForm.reset();
      if (electionDurationGroup) electionDurationGroup.classList.add("hidden");
    });
  }

  // Voter Audit & Lookup
  const voterLookupBtn = document.getElementById("voterLookupBtn");
  const voterLookupInput = document.getElementById("voterLookupInput") || document.getElementById("voterLookupRollInput");
  const emergencyResetVoterBtn = document.getElementById("emergencyResetVoterBtn");

  if (voterLookupBtn && voterLookupInput) {
    voterLookupBtn.addEventListener("click", () => {
      const roll = voterLookupInput.value.trim();
      lookupVoter(roll);
    });
    voterLookupInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        voterLookupBtn.click();
      }
    });
  }

  if (emergencyResetVoterBtn) {
    emergencyResetVoterBtn.addEventListener("click", () => {
      emergencyResetVoter();
    });
  }

  // Admin Export CSV
  const adminExportCsvBtn = document.getElementById("adminExportCsvBtn");
  if (adminExportCsvBtn) {
    adminExportCsvBtn.addEventListener("click", () => {
      exportAuditCsv();
    });
  }

  // Preview Sample Certificate (PDF)
  const previewSampleCertBtn = document.getElementById("previewSampleCertBtn");
  if (previewSampleCertBtn) {
    previewSampleCertBtn.addEventListener("click", () => {
      generateWinnerCertificate({
        winnerName: "Aarav Sharma",
        position: "BOY CLASS REPRESENTATIVE (BOY CR)",
        section: "Section A",
        electionTitle: "CR Election 2026",
        auditId: "MVH-2026-SAMPLE"
      });
    });
  }

  // Navbar Sign Out Button hook for Admin
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      if (sessionStorage.getItem("isAdminAuthenticated") === "true") {
        logoutAdmin();
      }
    });
  }

  // Initialize Admin Elections Table
  initAdminElectionsTable();

  // Candidate Registry Form
  if (adminCandidateRegistryForm) {
    adminCandidateRegistryForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const cat = document.getElementById("adminCandCategory").value;
      const name = document.getElementById("adminCandName").value.trim();
      const roll = document.getElementById("adminCandRoll").value.trim();
      const manifesto = document.getElementById("adminCandManifesto").value.trim();
      const photo = document.getElementById("adminCandPhoto").value.trim();

      await addCandidate("section-a", {
        name: name,
        category: cat,
        rollNo: roll,
        manifesto: manifesto,
        photoUrl: photo
      });

      adminCandidateRegistryForm.reset();
    });
  }

  // Lifecycle state transition buttons
  if (lifecycleDraftBtn) lifecycleDraftBtn.addEventListener("click", () => setElectionStatus("section-a", "draft"));
  if (lifecycleActiveBtn) lifecycleActiveBtn.addEventListener("click", () => setElectionStatus("section-a", "active"));
  if (lifecycleConcludedBtn) lifecycleConcludedBtn.addEventListener("click", () => setElectionStatus("section-a", "ended"));
  if (lifecyclePublishBtn) lifecyclePublishBtn.addEventListener("click", () => setElectionStatus("section-a", "published"));

  if (stage1Btn) stage1Btn.addEventListener("click", () => updateRevealStage(1));
  if (purgeElectionDataBtn) purgeElectionDataBtn.addEventListener("click", purgeElectionVotes);

  // Tab activation listener
  window.addEventListener("adminTabOpened", () => {
    loadAdminCandidates();
  });
});
