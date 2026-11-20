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

// Active election being managed in modal
let activeManageElectionId = null;

// Dynamic categories for new election builder (default: ["Boy CR", "Girl CR"])
let creatorCategories = ["Boy CR", "Girl CR"];

// Dynamic categories for the modal
let modalCategories = ["Boy CR", "Girl CR"];

// In-memory staged candidates for new election architect
let stagedCandidates = [];

// ============================================================================
// 1. Admin Authentication Engine
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
// 2. Whitelist Parser Engine
// ============================================================================

export function parseWhitelistInput(rawText, section = "Section A") {
  const trimmed = (rawText || "").trim();
  if (!trimmed) return [];

  // JSON Array Parse attempt
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const seenJson = new Set();
      const voters = [];
      for (const item of arr) {
        const roll = (item.rollNo || item.id || item.roll_no || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (roll && roll.length >= 4 && !seenJson.has(roll)) {
          seenJson.add(roll);
          voters.push({
            rollNo: roll,
            name: item.name || `Student ${roll}`,
            email: item.email || `${roll.toLowerCase()}@mirai.ac.in`,
            section: section || item.section || "Section A",
            hasVoted: false
          });
        }
      }
      return voters;
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
          section: section || "Section A",
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
            section: section || "Section A",
            hasVoted: false
          });
        }
      }
    }
  }

  return voters;
}

// ============================================================================
// 3. Dynamic Category Builder (Creator & Staging)
// ============================================================================

export function renderCreatorCategories() {
  const container = document.getElementById("activeCategoriesList");
  const selectEl = document.getElementById("stagedCandCategory");
  if (!container) return;

  container.innerHTML = "";
  creatorCategories.forEach((cat, idx) => {
    const chip = document.createElement("div");
    chip.className = `active-category-chip accent-${idx % 5}`;
    chip.innerHTML = `
      <span>${cat}</span>
      ${creatorCategories.length > 1 ? `<button type="button" class="remove-cat-btn" data-cat="${cat}" title="Remove Seat">&times;</button>` : ''}
    `;
    const removeBtn = chip.querySelector(".remove-cat-btn");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => removeCreatorCategory(cat));
    }
    container.appendChild(chip);
  });

  // Update candidate registry dropdown
  if (selectEl) {
    const prevVal = selectEl.value;
    selectEl.innerHTML = "";
    creatorCategories.forEach(cat => {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      selectEl.appendChild(opt);
    });
    if (creatorCategories.includes(prevVal)) {
      selectEl.value = prevVal;
    }
  }

  // Update staged nominees preview grid
  renderStagedCandidates();
}

export function addCreatorCategory(catName) {
  const clean = (catName || "").trim();
  if (!clean) return;
  if (creatorCategories.some(c => c.toLowerCase() === clean.toLowerCase())) {
    showAlert(`Seat '${clean}' is already in this election.`, "info");
    return;
  }
  creatorCategories.push(clean);
  renderCreatorCategories();
  showAlert(`Added electoral seat: '${clean}'`, "success");
}

export function removeCreatorCategory(catName) {
  if (creatorCategories.length <= 1) {
    showAlert("An election must have at least one electoral seat/category.", "error");
    return;
  }
  creatorCategories = creatorCategories.filter(c => c !== catName);
  stagedCandidates = stagedCandidates.filter(c => c.category !== catName);
  renderCreatorCategories();
}

// ============================================================================
// 4. Staged Candidates Management
// ============================================================================

function renderStagedCandidates() {
  const container = document.getElementById("stagedCandidatesContainer");
  const countBadge = document.getElementById("stagedCandCountBadge");

  if (countBadge) {
    countBadge.textContent = `${stagedCandidates.length} Nominees Staged`;
    countBadge.className = stagedCandidates.length > 0 ? "badge badge-primary ml-auto" : "badge badge-secondary ml-auto";
  }

  if (!container) return;
  container.innerHTML = "";

  creatorCategories.forEach((cat, idx) => {
    const cands = stagedCandidates.filter(c => c.category === cat);
    const wrapper = document.createElement("div");
    wrapper.className = `candidate-table-wrapper border-accent-${idx % 5}`;
    wrapper.style.padding = "1rem";
    wrapper.style.background = "var(--bg-surface)";
    wrapper.style.borderRadius = "var(--radius-md)";
    wrapper.style.border = "1px solid var(--border-subtle)";

    wrapper.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
        <h4 style="margin: 0; font-size: 0.95rem; color: var(--text-primary);">${cat} Nominees (${cands.length})</h4>
        <span class="badge badge-accent-${idx % 5}" style="font-size: 0.7rem;">Seat #${idx + 1}</span>
      </div>
      <div class="admin-candidate-list" id="stagedList_${idx}"></div>
    `;

    const listEl = wrapper.querySelector(`#stagedList_${idx}`);
    if (cands.length === 0) {
      listEl.innerHTML = `<p class="text-muted" style="font-size:0.8rem; padding: 0.4rem 0;">No nominees staged for this seat yet.</p>`;
    } else {
      cands.forEach(c => {
        const item = document.createElement("div");
        item.className = "staged-cand-item";
        item.innerHTML = `
          <div>
            <strong>${c.name}</strong> 
            <span class="mono" style="color:var(--neon-cyan);">(${c.rollNo})</span>
          </div>
          <button type="button" class="btn btn-danger btn-sm staged-remove-btn" data-roll="${c.rollNo}" data-cat="${c.category}">&times; Remove</button>
        `;
        item.querySelector(".staged-remove-btn").addEventListener("click", () => {
          removeStagedCandidate(c.rollNo, c.category);
        });
        listEl.appendChild(item);
      });
    }

    container.appendChild(wrapper);
  });
}

function addStagedCandidate() {
  const catEl = document.getElementById("stagedCandCategory");
  const nameEl = document.getElementById("stagedCandName");
  const rollEl = document.getElementById("stagedCandRoll");
  const manifestoEl = document.getElementById("stagedCandManifesto");
  const photoEl = document.getElementById("stagedCandPhoto");

  const name = (nameEl?.value || "").trim();
  const roll = (rollEl?.value || "").trim().toUpperCase();
  const cat = catEl?.value || creatorCategories[0] || "Boy CR";
  const manifesto = (manifestoEl?.value || "").trim();
  const photo = (photoEl?.value || "").trim();

  if (!name) {
    showAlert("Please enter the candidate's name.", "error");
    return;
  }
  if (!roll) {
    showAlert("Please enter the candidate's roll number.", "error");
    return;
  }

  // Prevent duplicate roll in staging for the same category
  if (stagedCandidates.some(c => c.rollNo === roll && c.category === cat)) {
    showAlert(`Candidate with Roll Number '${roll}' is already staged for ${cat}.`, "error");
    return;
  }

  stagedCandidates.push({
    name,
    rollNo: roll,
    category: cat,
    manifesto: manifesto || "Committed to cohort student welfare and academic representation.",
    photoUrl: photo || ""
  });

  if (nameEl) nameEl.value = "";
  if (rollEl) rollEl.value = "";
  if (manifestoEl) manifestoEl.value = "";
  if (photoEl) photoEl.value = "";

  renderStagedCandidates();
  showAlert(`Added '${name}' as nominee for ${cat}.`, "success");
}

function removeStagedCandidate(rollNo, category) {
  stagedCandidates = stagedCandidates.filter(c => !(c.rollNo === rollNo && c.category === category));
  renderStagedCandidates();
}

// ============================================================================
// 5. Unified Election Creation (Atomically commits Election + Categories + Whitelist + Candidates)
// ============================================================================

export async function createUnifiedElection({ title, section, categories, mode, durationMinutes, whitelistText, candidatesList }) {
  if (!title) throw new Error("Election title is required.");
  const cleanScope = (section || "Section A").trim();
  const slug = cleanScope.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const electionId = slug ? `election-${slug}` : `election-${Date.now().toString(36)}`;

  const finalCategories = categories && categories.length > 0 ? categories : ["Boy CR", "Girl CR"];

  try {
    // 1. Election Document Data
    const electionRef = doc(db, "elections", electionId);
    const electionData = {
      id: electionId,
      title: title.trim(),
      section: cleanScope,
      categories: finalCategories,
      status: "draft",
      revealStage: 1,
      votingMode: mode || "manual",
      durationMinutes: Number(durationMinutes) || 60,
      closesAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(electionRef, electionData, { merge: true });

    // 2. Parse, deduplicate, and chunk-commit Whitelist
    const rawVoters = parseWhitelistInput(whitelistText, cleanScope);
    // Deduplicate entries with new Set to prevent batch collision
    const seenRolls = new Set();
    const voters = [];
    for (const v of rawVoters) {
      if (!seenRolls.has(v.rollNo)) {
        seenRolls.add(v.rollNo);
        voters.push(v);
      }
    }

    if (voters.length > 0) {
      // Each voter writes 2 docs (election subcollection + root whitelist).
      // Chunk size of 220 voters = 440 operations, staying safely under Firestore's 500 limit.
      const CHUNK_SIZE = 220;
      for (let i = 0; i < voters.length; i += CHUNK_SIZE) {
        const chunk = voters.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);

        chunk.forEach(voter => {
          const rollKey = voter.rollNo;
          // Election-specific whitelist subcollection
          const electionWlRef = doc(db, "elections", electionId, "whitelist", rollKey);
          batch.set(electionWlRef, {
            rollNo: rollKey,
            name: voter.name,
            email: voter.email,
            section: cleanScope,
            hasVoted: false,
            updatedAt: serverTimestamp()
          }, { merge: true });

          // Global root whitelist fallback
          const rootWlRef = doc(db, "whitelist", rollKey);
          batch.set(rootWlRef, {
            rollNo: rollKey,
            name: voter.name,
            email: voter.email,
            section: cleanScope,
            hasVoted: false,
            claimed: false,
            updatedAt: serverTimestamp()
          }, { merge: true });
        });

        await batch.commit();
      }
    }

    // 3. Commit Staged Candidates
    if (candidatesList && candidatesList.length > 0) {
      const candBatch = writeBatch(db);
      candidatesList.forEach(cand => {
        const safeCat = cand.category.toLowerCase().replace(/[^a-z0-9]/g, "_");
        const safeRoll = cand.rollNo.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
        const candId = `${safeCat}_${safeRoll}`;
        const candData = {
          id: candId,
          electionId: electionId,
          name: cand.name,
          category: cand.category,
          rollNo: cand.rollNo,
          manifesto: cand.manifesto,
          photoUrl: cand.photoUrl,
          voteCount: 0,
          createdAt: serverTimestamp()
        };

        // Election-specific subcollection: elections/{electionId}/candidates/{candId}
        const electionCandRef = doc(db, "elections", electionId, "candidates", candId);
        candBatch.set(electionCandRef, candData, { merge: true });

        // Root candidates collection
        const rootCandRef = doc(db, "candidates", candId);
        candBatch.set(rootCandRef, candData, { merge: true });
      });

      await candBatch.commit();
    }

    // Also update global election_meta config
    const metaRef = doc(db, "election_meta", "config");
    await setDoc(metaRef, {
      activeElectionId: electionId,
      title: title.trim(),
      section: cleanScope,
      categories: finalCategories,
      status: "draft",
      revealStage: 1,
      votingMode: mode || "manual",
      durationMinutes: Number(durationMinutes) || 60,
      closesAt: null,
      updatedAt: serverTimestamp()
    }, { merge: true });

    showAlert(`Election '${title}' created successfully in Draft with ${voters.length} whitelisted voters and ${candidatesList.length} nominees across [${finalCategories.join(", ")}]!`, "success");
    return electionId;

  } catch (err) {
    console.error("Unified election creation error:", err);
    showAlert(`Failed to create election: ${err.message}`, "error");
    throw err;
  }
}

// Backwards-compatible standalone wrappers
export async function createElection(title, department, section, mode = "manual", durationMinutes = 60) {
  return createUnifiedElection({
    title,
    section: section || "Section A",
    categories: ["Boy CR", "Girl CR"],
    mode,
    durationMinutes,
    whitelistText: "",
    candidatesList: []
  });
}

export async function uploadWhitelist(electionId = "section-a", rawText) {
  const rawVoters = parseWhitelistInput(rawText);
  if (!rawVoters || rawVoters.length === 0) {
    showAlert("No valid student IDs found in input.", "error");
    return 0;
  }

  // Deduplicate entries with new Set to prevent batch collision
  const seenRolls = new Set();
  const voters = [];
  for (const v of rawVoters) {
    if (!seenRolls.has(v.rollNo)) {
      seenRolls.add(v.rollNo);
      voters.push(v);
    }
  }

  // Each voter writes 2 docs (election subcollection + root whitelist).
  // Chunk size of 220 voters = 440 operations, staying safely under Firestore's 500 limit.
  const CHUNK_SIZE = 220;
  let committed = 0;

  for (let i = 0; i < voters.length; i += CHUNK_SIZE) {
    const chunk = voters.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);

    chunk.forEach(voter => {
      const rollKey = voter.rollNo;
      const electionWhitelistRef = doc(db, "elections", electionId, "whitelist", rollKey);
      batch.set(electionWhitelistRef, {
        rollNo: rollKey,
        name: voter.name,
        email: voter.email,
        section: voter.section || "Section A",
        hasVoted: false,
        updatedAt: serverTimestamp()
      }, { merge: true });

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
  }

  showAlert(`Successfully imported ${committed} whitelisted voters into ${electionId}!`, "success");
  return committed;
}

export async function addCandidate(electionId = "section-a", { name, category, photoUrl, manifesto, rollNo }) {
  if (!name) throw new Error("Candidate name is required.");
  const safeCat = (category || "seat").toLowerCase().replace(/[^a-z0-9]/g, "_");
  const safeRoll = (rollNo || name).trim().replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const candId = `${safeCat}_${safeRoll}`;

  const candidateData = {
    id: candId,
    electionId: electionId,
    name: name.trim(),
    category: category || "Boy CR",
    rollNo: (rollNo || "Certified").trim().toUpperCase(),
    manifesto: manifesto || "Committed to cohort student welfare and representation.",
    photoUrl: photoUrl || "",
    voteCount: 0,
    createdAt: serverTimestamp()
  };

  const electionCandRef = doc(db, "elections", electionId, "candidates", candId);
  await setDoc(electionCandRef, candidateData, { merge: true });

  const rootCandRef = doc(db, "candidates", candId);
  await setDoc(rootCandRef, candidateData, { merge: true });

  showAlert(`Candidate '${name}' registered for ${category} in ${electionId}!`, "success");
  return candId;
}

// ============================================================================
// 6. Election Lifecycle Status Transitions per Election
// ============================================================================

export async function setElectionStatus(electionId, status) {
  if (!electionId) return;
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

    // Also sync global config if active election
    const metaRef = doc(db, "election_meta", "config");
    await setDoc(metaRef, updatePayload, { merge: true });

    showAlert(`Election '${existingData.title || electionId}' transitioned to: ${status.toUpperCase()}`, "success");

  } catch (err) {
    console.error("Set election status error:", err);
    showAlert(`Failed to set status: ${err.message}`, "error");
    throw err;
  }
}

export async function updateRevealStage(stage) {
  try {
    const metaRef = doc(db, "election_meta", "config");
    await setDoc(metaRef, { revealStage: stage, updatedAt: serverTimestamp() }, { merge: true });
    showAlert(`Auditing Reveal set to Stage ${stage}`, "success");
  } catch (err) {
    showAlert(`Failed to update reveal stage: ${err.message}`, "error");
  }
}

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
// 7. Manage Election Modal (Manage Categories, Whitelist & Candidates)
// ============================================================================

export async function openManageElectionModal(electionId) {
  activeManageElectionId = electionId;
  const modal = document.getElementById("manageElectionModal");
  const titleEl = document.getElementById("manageModalElectionTitle");
  const subEl = document.getElementById("manageModalElectionSub");
  const wlCountEl = document.getElementById("manageModalWhitelistCount");

  if (!modal) return;
  modal.classList.remove("hidden");

  try {
    const snap = await getDoc(doc(db, "elections", electionId));
    const data = snap.exists() ? snap.data() : {};
    modalCategories = Array.isArray(data.categories) && data.categories.length > 0
      ? data.categories
      : ["Boy CR", "Girl CR"];

    if (titleEl) titleEl.textContent = data.title || electionId;
    if (subEl) subEl.textContent = `${data.section || 'General'} • ID: ${electionId}`;

    // Get whitelist count
    const wlSnap = await getDocs(collection(db, "elections", electionId, "whitelist"));
    if (wlCountEl) wlCountEl.textContent = `${wlSnap.size} Whitelisted`;

    renderModalCategories();
    loadModalElectionCandidates(electionId);
  } catch (e) {
    console.error("Open manage modal error:", e);
  }
}

function renderModalCategories() {
  const listEl = document.getElementById("modalActiveCategoriesList");
  const selectEl = document.getElementById("manageCandCategory");
  if (!listEl) return;

  listEl.innerHTML = "";
  modalCategories.forEach((cat, idx) => {
    const chip = document.createElement("div");
    chip.className = `active-category-chip accent-${idx % 5}`;
    chip.innerHTML = `
      <span>${cat}</span>
      ${modalCategories.length > 1 ? `<button type="button" class="remove-cat-btn" data-cat="${cat}" title="Remove Seat">&times;</button>` : ''}
    `;
    const removeBtn = chip.querySelector(".remove-cat-btn");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => removeModalCategory(cat));
    }
    listEl.appendChild(chip);
  });

  if (selectEl) {
    selectEl.innerHTML = "";
    modalCategories.forEach(cat => {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      selectEl.appendChild(opt);
    });
  }
}

async function addModalCategory(name) {
  const clean = (name || "").trim();
  if (!clean) return;
  if (modalCategories.some(c => c.toLowerCase() === clean.toLowerCase())) {
    showAlert(`Seat '${clean}' is already configured.`, "info");
    return;
  }
  modalCategories.push(clean);
  renderModalCategories();

  if (activeManageElectionId) {
    await setDoc(doc(db, "elections", activeManageElectionId), {
      categories: modalCategories,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }
  showAlert(`Added seat '${clean}' to this election.`, "success");
}

async function removeModalCategory(name) {
  if (modalCategories.length <= 1) {
    showAlert("An election must have at least one seat/category.", "error");
    return;
  }
  modalCategories = modalCategories.filter(c => c !== name);
  renderModalCategories();

  if (activeManageElectionId) {
    await setDoc(doc(db, "elections", activeManageElectionId), {
      categories: modalCategories,
      updatedAt: serverTimestamp()
    }, { merge: true });
    loadModalElectionCandidates(activeManageElectionId);
  }
}

async function loadModalElectionCandidates(electionId) {
  const container = document.getElementById("manageModalCandidatesContainer");
  if (!container) return;

  container.innerHTML = `<span class="spinner"></span>`;

  try {
    const candSnap = await getDocs(collection(db, "elections", electionId, "candidates"));
    const allCands = [];
    candSnap.forEach(d => allCands.push({ id: d.id, ...d.data() }));

    container.innerHTML = "";

    modalCategories.forEach((cat, idx) => {
      const cands = allCands.filter(c => c.category === cat);
      const wrapper = document.createElement("div");
      wrapper.className = `candidate-table-wrapper border-accent-${idx % 5}`;
      wrapper.style.padding = "1rem";
      wrapper.style.background = "var(--bg-surface)";
      wrapper.style.borderRadius = "var(--radius-md)";
      wrapper.style.border = "1px solid var(--border-subtle)";

      wrapper.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <h4 style="margin: 0; font-size: 0.95rem; color: var(--text-primary);">${cat} Candidates (${cands.length})</h4>
          <span class="badge badge-accent-${idx % 5}" style="font-size: 0.7rem;">Seat #${idx + 1}</span>
        </div>
        <div class="admin-candidate-list" id="modalCandList_${idx}"></div>
      `;

      const listEl = wrapper.querySelector(`#modalCandList_${idx}`);
      if (cands.length === 0) {
        listEl.innerHTML = `<p class="text-muted" style="font-size:0.8rem; padding: 0.4rem 0;">No candidates registered for ${cat}.</p>`;
      } else {
        cands.forEach(b => {
          const row = document.createElement("div");
          row.className = "staged-cand-item";
          row.innerHTML = `
            <div><strong>${b.name}</strong> <span class="mono" style="color:var(--neon-cyan);">(${b.rollNo})</span></div>
            <button type="button" class="btn btn-danger btn-sm" data-id="${b.id}">&times; Remove</button>
          `;
          row.querySelector("button").addEventListener("click", () => deleteCandidate(b.id, electionId));
          listEl.appendChild(row);
        });
      }

      container.appendChild(wrapper);
    });

  } catch (err) {
    console.error("Load modal candidates error:", err);
    container.innerHTML = `<div class="error-msg">Error loading candidates: ${err.message}</div>`;
  }
}

export async function deleteCandidate(candidateId, electionId = activeManageElectionId || "section-a") {
  if (!confirm(`Are you sure you want to remove candidate (${candidateId})?`)) return;
  try {
    await deleteDoc(doc(db, "elections", electionId, "candidates", candidateId)).catch(() => {});
    await deleteDoc(doc(db, "candidates", candidateId)).catch(() => {});
    showAlert("Candidate deleted.", "info");
    if (activeManageElectionId) {
      loadModalElectionCandidates(activeManageElectionId);
    }
  } catch (error) {
    showAlert(`Delete failed: ${error.message}`, "error");
  }
}

// ============================================================================
// 8. Voter Audit & Roll Lookup with Target Election Selector
// ============================================================================

let currentLookedUpRoll = null;
let currentLookedUpElectionId = null;

export async function lookupVoter(rollNo, targetElectionId = "") {
  const inputEl = document.getElementById("voterLookupInput");
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
    currentLookedUpElectionId = targetElectionId || null;

    let voterData = null;
    let foundElectionTitle = "";

    // 1. If specific election selected, query that election's whitelist subcollection
    if (targetElectionId) {
      const electionVoterRef = doc(db, "elections", targetElectionId, "whitelist", cleanRoll);
      const snap = await getDoc(electionVoterRef);
      if (snap.exists()) {
        voterData = snap.data();
        const elSnap = await getDoc(doc(db, "elections", targetElectionId));
        foundElectionTitle = elSnap.exists() ? elSnap.data().title : targetElectionId;
      }
    }

    // 2. Fallback: check global root whitelist
    if (!voterData) {
      const rootVoterRef = doc(db, "whitelist", cleanRoll);
      const rootSnap = await getDoc(rootVoterRef);
      if (rootSnap.exists()) {
        voterData = rootSnap.data();
        foundElectionTitle = voterData.section ? `${voterData.section} (Global Registry)` : "General Registry";
      }
    }

    if (!voterData) {
      resultContainer.innerHTML = `
        <span class="voter-status-badge not-whitelisted">Not Whitelisted</span>
        <p style="margin: 0.35rem 0 0; color: var(--text-secondary); font-size: 0.88rem;">
          Roll Number <strong class="mono" style="color:var(--neon-rose);">${cleanRoll}</strong> is not certified on the election whitelist ${targetElectionId ? `for election cohort '${targetElectionId}'` : ''}.
        </p>
      `;
      if (emergencyResetBtn) emergencyResetBtn.classList.add("hidden");
      return;
    }

    const hasVoted = voterData.hasVoted === true;

    if (!hasVoted) {
      resultContainer.innerHTML = `
        <span class="voter-status-badge pending">Whitelisted • Pending Vote</span>
        <div style="font-size: 0.88rem; color: var(--text-secondary); margin-top: 0.35rem; line-height: 1.5;">
          <div>Student Name: <strong style="color:var(--text-primary);">${voterData.name || 'Certified Voter'}</strong></div>
          <div>Roll Number: <span class="mono" style="color:var(--neon-cyan); font-weight:700;">${voterData.rollNo || cleanRoll}</span></div>
          <div>Cohort / Election: <span style="color:var(--text-primary);">${foundElectionTitle || voterData.section || 'General'}</span></div>
          <div style="color: var(--neon-cyan); margin-top: 0.25rem;">● Certified eligible. Official ballot has not yet been cast.</div>
        </div>
      `;
      if (emergencyResetBtn) emergencyResetBtn.classList.add("hidden");
    } else {
      const receiptToken = voterData.receiptHash || "0xMIRAI-SEALED-BALLOT";
      const votedTime = voterData.updatedAt ? new Date(voterData.updatedAt.toDate ? voterData.updatedAt.toDate() : voterData.updatedAt).toLocaleString() : "Audit Recorded";
      resultContainer.innerHTML = `
        <span class="voter-status-badge voted">Whitelisted • Voted</span>
        <div style="font-size: 0.88rem; color: var(--text-secondary); margin-top: 0.35rem; line-height: 1.5;">
          <div>Student Name: <strong style="color:var(--text-primary);">${voterData.name || 'Certified Voter'}</strong></div>
          <div>Roll Number: <span class="mono" style="color:var(--neon-emerald); font-weight:700;">${voterData.rollNo || cleanRoll}</span></div>
          <div>Cohort / Election: <span style="color:var(--text-primary);">${foundElectionTitle || voterData.section || 'General'}</span></div>
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

export async function emergencyResetVoter(rollNo = currentLookedUpRoll, electionId = currentLookedUpElectionId) {
  const cleanRoll = (rollNo || currentLookedUpRoll || "").trim().toUpperCase();
  if (!cleanRoll) return;

  const confirmed = confirm(
    `EMERGENCY ACTION: Reset ballot status for Student ID: ${cleanRoll}?\n\nThis will void their marked participation flag and allow them to recast a ballot.`
  );
  if (!confirmed) return;

  try {
    const batch = writeBatch(db);

    if (electionId) {
      const electionVoterRef = doc(db, "elections", electionId, "whitelist", cleanRoll);
      batch.update(electionVoterRef, {
        hasVoted: false,
        receiptHash: null,
        updatedAt: serverTimestamp()
      });
    }

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
// 9. Real-Time Admin Elections Table & Dynamic Dropdown Populator
// ============================================================================

export function initAdminElectionsTable() {
  const tbody = document.getElementById("adminElectionsTableBody");
  const electionSelect = document.getElementById("voterLookupElectionSelect");
  if (!tbody) return;

  const electionsCol = collection(db, "elections");
  onSnapshot(electionsCol, (snapshot) => {
    tbody.innerHTML = "";

    // Update Voter Audit Election Dropdown
    if (electionSelect) {
      const curVal = electionSelect.value;
      electionSelect.innerHTML = `<option value="">All Elections (Global Lookup)</option>`;
      snapshot.forEach(docSnap => {
        const d = docSnap.data();
        const opt = document.createElement("option");
        opt.value = docSnap.id;
        opt.textContent = `${d.title || docSnap.id} (${d.section || 'General'})`;
        electionSelect.appendChild(opt);
      });
      electionSelect.value = curVal;
    }

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

      const status = (data.status || "draft").toLowerCase();
      let statusBadge = `<span class="badge badge-secondary">${status.toUpperCase()}</span>`;
      if (status === "active") statusBadge = `<span class="badge badge-primary">ACTIVE</span>`;
      else if (status === "concluded" || status === "ended") statusBadge = `<span class="badge badge-secondary" style="border-color:var(--neon-amber); color:var(--neon-amber);">SEALED</span>`;
      else if (status === "published") statusBadge = `<span class="badge badge-winner">PUBLISHED</span>`;

      // Inline action buttons tailored per row
      let lifecycleBtn = "";
      if (status === "draft" || status === "ready") {
        lifecycleBtn = `<button class="btn btn-cyber-primary btn-sm admin-act-btn" data-act="start" data-id="${data.id}">▶ Start Voting</button>`;
      } else if (status === "active") {
        lifecycleBtn = `<button class="btn btn-warning btn-sm admin-act-btn" data-act="end" data-id="${data.id}">⏹ End &amp; Seal</button>`;
      } else if (status === "ended" || status === "concluded") {
        lifecycleBtn = `
          <button class="btn btn-cyber-primary btn-sm admin-act-btn" data-act="publish" data-id="${data.id}">📢 Publish Results</button>
          <button class="btn btn-cyber-outline btn-sm admin-act-btn" data-act="reopen" data-id="${data.id}">↩ Set Draft</button>
        `;
      } else if (status === "published") {
        lifecycleBtn = `<button class="btn btn-cyber-outline btn-sm admin-act-btn" data-act="archive" data-id="${data.id}">📦 Archive</button>`;
      }

      const seatsSummary = Array.isArray(data.categories) && data.categories.length > 0
        ? data.categories.join(", ")
        : "Boy CR, Girl CR";

      row.innerHTML = `
        <td>
          <strong>${data.title || data.id}</strong><br>
          <small class="text-muted">${seatsSummary}</small>
        </td>
        <td>${data.section || 'Section A'}</td>
        <td>${modeBadge}</td>
        <td>${statusBadge}</td>
        <td>
          <div style="display:flex; gap:0.4rem; flex-wrap:wrap; align-items:center;">
            ${lifecycleBtn}
            <button class="btn btn-cyber-outline btn-sm admin-act-btn" data-act="manage" data-id="${data.id}" title="Manage Whitelist & Nominees">⚙️ Manage</button>
            <button class="btn btn-danger btn-sm admin-act-btn" data-act="delete" data-id="${data.id}" title="Delete Election">&times; Delete</button>
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
          else if (act === "reopen") setElectionStatus(id, "draft");
          else if (act === "archive") archiveElection(id);
          else if (act === "manage") openManageElectionModal(id);
          else if (act === "delete") deleteElection(id);
        });
      });

      tbody.appendChild(row);
    });
  }, (err) => {
    console.error("Admin elections ledger error:", err);
  });
}

// ============================================================================
// 10. Setup Event Listeners
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  // Check persisted admin session on load
  checkAdminSession();

  // Initialize creator categories
  renderCreatorCategories();

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

  // Admin Toggle Button
  const adminToggleBtn = document.getElementById("adminToggleBtn");
  if (adminToggleBtn) {
    adminToggleBtn.addEventListener("click", () => {
      const modal = document.getElementById("adminLoginModal");
      if (modal) modal.classList.remove("hidden");
    });
  }

  // Close Admin Login Modal
  const closeAdminLoginModal = document.getElementById("closeAdminLoginModal");
  if (closeAdminLoginModal) {
    closeAdminLoginModal.addEventListener("click", () => {
      const modal = document.getElementById("adminLoginModal");
      if (modal) modal.classList.add("hidden");
    });
  }

  // Preset chips in Creator Form
  const creatorPresetsContainer = document.getElementById("creatorPresetChips");
  if (creatorPresetsContainer) {
    creatorPresetsContainer.querySelectorAll(".category-preset-chip").forEach(btn => {
      btn.addEventListener("click", () => {
        const cat = btn.dataset.cat;
        addCreatorCategory(cat);
      });
    });
  }

  // Custom Category Input in Creator Form
  const addCategoryBtn = document.getElementById("addCategoryBtn");
  const newCategoryInput = document.getElementById("newCategoryInput");
  if (addCategoryBtn && newCategoryInput) {
    addCategoryBtn.addEventListener("click", () => {
      addCreatorCategory(newCategoryInput.value);
      newCategoryInput.value = "";
    });
    newCategoryInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addCategoryBtn.click();
      }
    });
  }

  // Preset chips in Manage Modal
  const modalPresetsContainer = document.getElementById("modalPresetChips");
  if (modalPresetsContainer) {
    modalPresetsContainer.querySelectorAll(".category-preset-chip").forEach(btn => {
      btn.addEventListener("click", () => {
        const cat = btn.dataset.cat;
        addModalCategory(cat);
      });
    });
  }

  // Custom Category Input in Manage Modal
  const modalAddCategoryBtn = document.getElementById("modalAddCategoryBtn");
  const modalNewCategoryInput = document.getElementById("modalNewCategoryInput");
  if (modalAddCategoryBtn && modalNewCategoryInput) {
    modalAddCategoryBtn.addEventListener("click", () => {
      addModalCategory(modalNewCategoryInput.value);
      modalNewCategoryInput.value = "";
    });
    modalNewCategoryInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        modalAddCategoryBtn.click();
      }
    });
  }

  // Scope selection change: reveal custom scope input if "custom" selected
  const scopeSelect = document.getElementById("unifiedElectionScope");
  const customScopeGroup = document.getElementById("unifiedCustomScopeGroup");
  if (scopeSelect && customScopeGroup) {
    scopeSelect.addEventListener("change", (e) => {
      if (e.target.value === "custom") {
        customScopeGroup.classList.remove("hidden");
      } else {
        customScopeGroup.classList.add("hidden");
      }
    });
  }

  // Voting duration mode change: reveal minutes input if "timed"
  const modeSelect = document.getElementById("unifiedElectionMode");
  const durationGroup = document.getElementById("unifiedDurationGroup");
  if (modeSelect && durationGroup) {
    modeSelect.addEventListener("change", (e) => {
      if (e.target.value === "timed") {
        durationGroup.classList.remove("hidden");
      } else {
        durationGroup.classList.add("hidden");
      }
    });
  }

  // Whitelist live counter
  const wlTextarea = document.getElementById("unifiedWhitelistTextarea");
  const wlCountBadge = document.getElementById("unifiedWhitelistCountBadge");
  if (wlTextarea && wlCountBadge) {
    const updateCount = () => {
      const parsed = parseWhitelistInput(wlTextarea.value);
      wlCountBadge.textContent = `${parsed.length} Roll Numbers Staged`;
      wlCountBadge.className = parsed.length > 0 ? "badge badge-primary ml-auto" : "badge badge-secondary ml-auto";
    };
    wlTextarea.addEventListener("input", updateCount);
  }

  // File Drop Zone for CSV / JSON in Unified Creator
  const dropZone = document.getElementById("unifiedWhitelistDropZone");
  const fileInput = document.getElementById("unifiedWhitelistFileInput");
  if (dropZone && fileInput && wlTextarea) {
    dropZone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        const text = evt.target.result;
        wlTextarea.value = text;
        const parsed = parseWhitelistInput(text);
        if (wlCountBadge) {
          wlCountBadge.textContent = `${parsed.length} Roll Numbers Staged`;
          wlCountBadge.className = parsed.length > 0 ? "badge badge-primary ml-auto" : "badge badge-secondary ml-auto";
        }
        showAlert(`Loaded ${parsed.length} roll numbers from ${file.name}.`, "success");
      };
      reader.readAsText(file);
    });
  }

  // Add Nominee to Staging Button
  const stageCandBtn = document.getElementById("stageCandidateBtn");
  if (stageCandBtn) {
    stageCandBtn.addEventListener("click", addStagedCandidate);
  }

  // Unified Form Submission
  const unifiedForm = document.getElementById("unifiedElectionForm");
  if (unifiedForm) {
    unifiedForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = document.getElementById("unifiedElectionTitle")?.value.trim();
      let scope = scopeSelect ? scopeSelect.value : "Section A";
      if (scope === "custom") {
        const customInput = document.getElementById("unifiedCustomScopeInput")?.value.trim();
        scope = customInput || "Custom Cohort";
      }
      const mode = modeSelect ? modeSelect.value : "manual";
      const duration = document.getElementById("unifiedDurationMinutes")?.value || 60;
      const wlText = wlTextarea ? wlTextarea.value.trim() : "";

      if (!title) {
        showAlert("Election title is required.", "error");
        return;
      }

      const submitBtn = document.getElementById("createUnifiedElectionBtn");
      if (submitBtn) submitBtn.disabled = true;

      try {
        await createUnifiedElection({
          title,
          section: scope,
          categories: creatorCategories,
          mode,
          durationMinutes: duration,
          whitelistText: wlText,
          candidatesList: stagedCandidates
        });

        // Reset form and staged candidates
        unifiedForm.reset();
        stagedCandidates = [];
        creatorCategories = ["Boy CR", "Girl CR"];
        renderCreatorCategories();
        if (wlCountBadge) {
          wlCountBadge.textContent = "0 Roll Numbers Staged";
          wlCountBadge.className = "badge badge-secondary ml-auto";
        }
        if (customScopeGroup) customScopeGroup.classList.add("hidden");
        if (durationGroup) durationGroup.classList.add("hidden");

      } catch (err) {
        console.error("Creation error:", err);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // Manage Election Modal Controls
  const closeManageModalBtn = document.getElementById("closeManageElectionModalBtn");
  const manageModalCloseBtn = document.getElementById("manageModalCloseBtn");
  const manageModal = document.getElementById("manageElectionModal");
  if (closeManageModalBtn && manageModal) {
    closeManageModalBtn.addEventListener("click", () => manageModal.classList.add("hidden"));
  }
  if (manageModalCloseBtn && manageModal) {
    manageModalCloseBtn.addEventListener("click", () => manageModal.classList.add("hidden"));
  }

  // Append Whitelist inside Modal
  const modalAppendWlBtn = document.getElementById("manageModalAppendWhitelistBtn");
  const modalWlInput = document.getElementById("manageModalWhitelistInput");
  if (modalAppendWlBtn && modalWlInput) {
    modalAppendWlBtn.addEventListener("click", async () => {
      if (!activeManageElectionId) return;
      const raw = modalWlInput.value.trim();
      if (!raw) {
        showAlert("Please paste student IDs to append.", "error");
        return;
      }

      await uploadWhitelist(activeManageElectionId, raw);
      modalWlInput.value = "";
      const wlSnap = await getDocs(collection(db, "elections", activeManageElectionId, "whitelist"));
      const wlCountEl = document.getElementById("manageModalWhitelistCount");
      if (wlCountEl) wlCountEl.textContent = `${wlSnap.size} Whitelisted`;
    });
  }

  // Add Candidate inside Modal
  const modalAddCandBtn = document.getElementById("manageModalAddCandBtn");
  if (modalAddCandBtn) {
    modalAddCandBtn.addEventListener("click", async () => {
      if (!activeManageElectionId) return;
      const cat = document.getElementById("manageCandCategory")?.value || modalCategories[0] || "Boy CR";
      const name = document.getElementById("manageCandName")?.value.trim();
      const roll = document.getElementById("manageCandRoll")?.value.trim();
      const manifesto = document.getElementById("manageCandManifesto")?.value.trim();
      const photo = document.getElementById("manageCandPhoto")?.value.trim();

      if (!name) {
        showAlert("Candidate name is required.", "error");
        return;
      }
      if (!roll) {
        showAlert("Roll number is required.", "error");
        return;
      }

      await addCandidate(activeManageElectionId, {
        name,
        category: cat,
        rollNo: roll,
        manifesto,
        photoUrl: photo
      });

      // Clear modal inputs
      const nEl = document.getElementById("manageCandName");
      const rEl = document.getElementById("manageCandRoll");
      const mEl = document.getElementById("manageCandManifesto");
      const pEl = document.getElementById("manageCandPhoto");
      if (nEl) nEl.value = "";
      if (rEl) rEl.value = "";
      if (mEl) mEl.value = "";
      if (pEl) pEl.value = "";

      loadModalElectionCandidates(activeManageElectionId);
    });
  }

  // Voter Audit & Lookup with Target Election
  const voterLookupBtn = document.getElementById("voterLookupBtn");
  const voterLookupInput = document.getElementById("voterLookupInput");
  const voterLookupElectionSelect = document.getElementById("voterLookupElectionSelect");
  const emergencyResetVoterBtn = document.getElementById("emergencyResetVoterBtn");

  if (voterLookupBtn && voterLookupInput) {
    voterLookupBtn.addEventListener("click", () => {
      const roll = voterLookupInput.value.trim();
      const targetElection = voterLookupElectionSelect ? voterLookupElectionSelect.value : "";
      lookupVoter(roll, targetElection);
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
        position: "CLASS REPRESENTATIVE",
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

  // Initialize Admin Elections Table and dynamic dropdown
  initAdminElectionsTable();
});
