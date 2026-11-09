// Mirai Vote Hub - Admin & Election Commission Controller
// Mirai School of Technology - CSE AI/ML

import { db } from "./firebase-config.js";
import { showAlert } from "./auth.js";
import {
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Whitelist Ingestion Elements
const whitelistFileInput = document.getElementById("whitelistFileInput");
const whitelistDropZone = document.getElementById("whitelistDropZone");
const whitelistJsonText = document.getElementById("whitelistJsonText");
const importWhitelistBtn = document.getElementById("importWhitelistBtn");
const whitelistImportStatus = document.getElementById("whitelistImportStatus");

// State & Reveal Elements
const stateReadyBtn = document.getElementById("stateReadyBtn");
const stateActiveBtn = document.getElementById("stateActiveBtn");
const statePausedBtn = document.getElementById("statePausedBtn");
const stateConcludedBtn = document.getElementById("stateConcludedBtn");
const stage1Btn = document.getElementById("stage1Btn");
const stage2Btn = document.getElementById("stage2Btn");
const purgeElectionDataBtn = document.getElementById("purgeElectionDataBtn");

// Candidate Management Elements
const openAddCandidateModalBtn = document.getElementById("openAddCandidateModalBtn");
const addCandidateModal = document.getElementById("addCandidateModal");
const closeCandidateModalBtn = document.getElementById("closeCandidateModalBtn");
const cancelCandidateBtn = document.getElementById("cancelCandidateBtn");
const addCandidateForm = document.getElementById("addCandidateForm");
const adminBoyCandidateList = document.getElementById("adminBoyCandidateList");
const adminGirlCandidateList = document.getElementById("adminGirlCandidateList");

// Parse Raw Voter Input (supports 120+ raw roll numbers, CSV, or JSON)
export function parseRawVoterInput(rawText) {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  // Check if JSON
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
      console.warn("JSON parse attempt failed, falling back to line parser", e);
    }
  }

  // Check if lines
  const rawLines = trimmed.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  if (rawLines.length === 0) return [];

  // Check if first line is a CSV header
  const firstLine = rawLines[0].toLowerCase();
  const isCSVHeader = firstLine.includes("roll") || firstLine.includes("name") || firstLine.includes("email");

  const voters = [];
  const startIndex = isCSVHeader ? 1 : 0;

  for (let i = startIndex; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line.includes(",")) {
      // CSV format
      const parts = line.split(",").map(p => p.trim());
      const roll = (parts[0] || "").toUpperCase();
      if (roll) {
        voters.push({
          rollNo: roll,
          name: parts[1] || `Student ${roll}`,
          email: parts[2] || `${roll.toLowerCase()}@mirai.ac.in`,
          dept: parts[3] || "CSE (AI/ML)",
          passkey: parts[4] || "MIRAI2026",
          hasVoted: false,
          claimed: false
        });
      }
    } else {
      // Single roll number per line or space/tab separated
      const tokens = line.split(/\s+/).filter(Boolean);
      tokens.forEach(tok => {
        const roll = tok.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
        if (roll && roll.length >= 4) {
          voters.push({
            rollNo: roll,
            name: `Student ${roll}`,
            email: `${roll.toLowerCase()}@mirai.ac.in`,
            dept: "CSE (AI/ML)",
            passkey: "MIRAI2026",
            hasVoted: false,
            claimed: false
          });
        }
      });
    }
  }

  return voters;
}

// Parse CSV Text to Voter Objects
function parseCSVToVoters(csvText) {
  return parseRawVoterInput(csvText);
}

// Batch Ingest Whitelist
export async function batchImportWhitelist(votersArray) {
  if (!votersArray || votersArray.length === 0) {
    showAlert("No voter records detected to import.", "error");
    return;
  }

  try {
    if (importWhitelistBtn) importWhitelistBtn.disabled = true;
    if (whitelistImportStatus) {
      whitelistImportStatus.textContent = `Processing ${votersArray.length} voter records...`;
      whitelistImportStatus.className = "import-status processing";
    }

    // Firestore batch limit is 500 operations
    const chunkSize = 400;
    let committed = 0;

    for (let i = 0; i < votersArray.length; i += chunkSize) {
      const chunk = votersArray.slice(i, i + chunkSize);
      const batch = writeBatch(db);

      chunk.forEach(voter => {
        const rollKey = voter.rollNo.toUpperCase();
        const ref = doc(db, "whitelist", rollKey);
        batch.set(ref, {
          rollNo: rollKey,
          name: voter.name,
          email: voter.email,
          dept: voter.dept || "CSE (AI/ML)",
          passkey: voter.passkey || "MIRAI2026",
          hasVoted: false,
          claimed: false,
          updatedAt: serverTimestamp()
        }, { merge: true });
      });

      await batch.commit();
      committed += chunk.length;
      if (whitelistImportStatus) {
        whitelistImportStatus.textContent = `Committed ${committed} / ${votersArray.length} records...`;
      }
    }

    showAlert(`Successfully imported ${committed} whitelisted voters into CSE AI/ML registry!`, "success");
    if (whitelistImportStatus) {
      whitelistImportStatus.textContent = `✅ Complete: ${committed} voters certified.`;
      whitelistImportStatus.className = "import-status success";
    }

  } catch (error) {
    console.error("Batch import failure:", error);
    showAlert(`Whitelist import failed: ${error.message}`, "error");
    if (whitelistImportStatus) {
      whitelistImportStatus.textContent = `❌ Import Error: ${error.message}`;
      whitelistImportStatus.className = "import-status error";
    }
  } finally {
    if (importWhitelistBtn) importWhitelistBtn.disabled = false;
  }
}

// Update Election Lifecycle State
export async function updateElectionState(status) {
  try {
    const metaRef = doc(db, "election_meta", "config");
    await setDoc(metaRef, { status: status, updatedAt: serverTimestamp() }, { merge: true });
    showAlert(`Election status set to: ${status.toUpperCase()}`, "success");
    highlightActiveStateButton(status);
  } catch (err) {
    showAlert(`Failed to update status: ${err.message}`, "error");
  }
}

// Update 2-Stage Reveal Gate
export async function updateRevealStage(stage) {
  try {
    const metaRef = doc(db, "election_meta", "config");
    await setDoc(metaRef, { revealStage: stage, updatedAt: serverTimestamp() }, { merge: true });
    showAlert(`Auditing Reveal set to Stage ${stage}`, "success");
    highlightActiveStageButton(stage);
  } catch (err) {
    showAlert(`Failed to update reveal stage: ${err.message}`, "error");
  }
}

function highlightActiveStateButton(status) {
  const buttons = [stateReadyBtn, stateActiveBtn, statePausedBtn, stateConcludedBtn];
  buttons.forEach(btn => {
    if (btn) {
      if (btn.dataset.state === status) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    }
  });
}

function highlightActiveStageButton(stage) {
  if (stage1Btn && stage2Btn) {
    if (stage === 1) {
      stage1Btn.classList.add("active");
      stage2Btn.classList.remove("active");
    } else {
      stage1Btn.classList.remove("active");
      stage2Btn.classList.add("active");
    }
  }
}

// Candidate Management
export async function registerCandidate(category, name, rollNo, manifesto, photoUrl) {
  try {
    const candId = `${category}_${rollNo.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`;
    const candRef = doc(db, "candidates", candId);
    
    await setDoc(candRef, {
      category: category,
      name: name,
      rollNo: rollNo.toUpperCase(),
      manifesto: manifesto || "",
      photoUrl: photoUrl || "",
      voteCount: 0,
      createdAt: serverTimestamp()
    });

    showAlert(`Candidate ${name} registered for ${category === "boy_cr" ? "Boy CR" : "Girl CR"}!`, "success");
    loadAdminCandidates();
  } catch (error) {
    showAlert(`Failed to register candidate: ${error.message}`, "error");
  }
}

export async function deleteCandidate(candidateId) {
  if (!confirm(`Are you sure you want to remove this candidate (${candidateId})?`)) return;
  try {
    await deleteDoc(doc(db, "candidates", candidateId));
    showAlert("Candidate deleted.", "info");
    loadAdminCandidates();
  } catch (error) {
    showAlert(`Delete failed: ${error.message}`, "error");
  }
}

async function loadAdminCandidates() {
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

      row.querySelector("button").addEventListener("click", () => deleteCandidate(data.id));

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

// Reset / Purge Election Data
async function purgeElectionVotes() {
  const code = prompt("CRITICAL ACTION: Type 'RESET-MIRAI' to reset all cast votes and whitelist vote flags:");
  if (code !== "RESET-MIRAI") {
    showAlert("Reset aborted.", "info");
    return;
  }

  try {
    showAlert("Purging vote records and resetting whitelist...", "info");

    // 1. Reset Whitelist hasVoted flags
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

    // 2. Reset Candidate vote counters to 0
    const candSnap = await getDocs(collection(db, "candidates"));
    candSnap.forEach(c => {
      batch.update(doc(db, "candidates", c.id), { voteCount: 0 });
    });

    await batch.commit();

    // 3. Clear votes collection
    const votesSnap = await getDocs(collection(db, "votes"));
    for (const v of votesSnap.docs) {
      await deleteDoc(doc(db, "votes", v.id));
    }

    showAlert("Election ledger successfully reset to Zero baseline.", "success");
  } catch (error) {
    showAlert(`Reset failed: ${error.message}`, "error");
  }
}

// Setup Event Handlers
document.addEventListener("DOMContentLoaded", () => {
  // Drop Zone / File Input
  if (whitelistDropZone && whitelistFileInput) {
    whitelistDropZone.addEventListener("click", () => whitelistFileInput.click());
    whitelistFileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        const text = evt.target.result;
        if (file.name.endsWith(".json")) {
          try {
            const parsed = JSON.parse(text);
            batchImportWhitelist(Array.isArray(parsed) ? parsed : [parsed]);
          } catch (err) {
            showAlert("Invalid JSON file format.", "error");
          }
        } else {
          const parsed = parseCSVToVoters(text);
          batchImportWhitelist(parsed);
        }
      };
      reader.readAsText(file);
    });
  }

  if (importWhitelistBtn && whitelistJsonText) {
    importWhitelistBtn.addEventListener("click", () => {
      const raw = whitelistJsonText.value.trim();
      if (!raw) {
        showAlert("Please paste JSON or CSV data into the input box.", "error");
        return;
      }

      if (raw.startsWith("[") || raw.startsWith("{")) {
        try {
          const parsed = JSON.parse(raw);
          batchImportWhitelist(Array.isArray(parsed) ? parsed : [parsed]);
        } catch (e) {
          showAlert("JSON parse error. Check syntax.", "error");
        }
      } else {
        const parsed = parseCSVToVoters(raw);
        batchImportWhitelist(parsed);
      }
    });
  }

  // Process Whitelist Batch Button (up to 120+ student IDs)
  const processWhitelistBtn = document.getElementById("processWhitelistBtn");
  const whitelistBatchTextarea = document.getElementById("whitelistBatchTextarea");
  if (processWhitelistBtn && whitelistBatchTextarea) {
    processWhitelistBtn.addEventListener("click", () => {
      const raw = whitelistBatchTextarea.value.trim();
      if (!raw) {
        showAlert("Please paste student IDs or CSV roster into the box.", "error");
        return;
      }
      const voters = parseRawVoterInput(raw);
      batchImportWhitelist(voters);
    });
  }

  // Create Election Form
  const createElectionForm = document.getElementById("createElectionForm");
  if (createElectionForm) {
    createElectionForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = document.getElementById("newElectionTitle")?.value.trim();
      const dept = document.getElementById("newElectionDept")?.value.trim();
      const section = document.getElementById("newElectionSection")?.value.trim();

      if (!title) {
        showAlert("Election title is required.", "error");
        return;
      }

      try {
        const metaRef = doc(db, "election_meta", "config");
        await setDoc(metaRef, {
          title: title,
          dept: dept,
          section: section,
          status: "active",
          revealStage: 1,
          updatedAt: serverTimestamp()
        }, { merge: true });

        showAlert(`Election '${title}' registered successfully!`, "success");
        // Update header label
        const statusLabel = document.getElementById("electionStatusLabel");
        if (statusLabel) statusLabel.textContent = "Election Active";
      } catch (err) {
        showAlert(`Failed to create election: ${err.message}`, "error");
      }
    });
  }

  // Admin Candidate Registry Form
  const adminCandidateRegistryForm = document.getElementById("adminCandidateRegistryForm");
  if (adminCandidateRegistryForm) {
    adminCandidateRegistryForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const cat = document.getElementById("adminCandCategory").value;
      const name = document.getElementById("adminCandName").value.trim();
      const roll = document.getElementById("adminCandRoll").value.trim();
      const manifesto = document.getElementById("adminCandManifesto").value.trim();
      const photo = document.getElementById("adminCandPhoto").value.trim();

      if (!name || !roll) {
        showAlert("Candidate name and roll number are mandatory.", "error");
        return;
      }

      registerCandidate(cat, name, roll, manifesto, photo);
      adminCandidateRegistryForm.reset();
    });
  }

  // New Lifecycle buttons
  const lifecycleDraftBtn = document.getElementById("lifecycleDraftBtn");
  const lifecycleActiveBtn = document.getElementById("lifecycleActiveBtn");
  const lifecycleConcludedBtn = document.getElementById("lifecycleConcludedBtn");
  const lifecyclePublishBtn = document.getElementById("lifecyclePublishBtn");

  if (lifecycleDraftBtn) lifecycleDraftBtn.addEventListener("click", () => updateElectionState("ready"));
  if (lifecycleActiveBtn) lifecycleActiveBtn.addEventListener("click", () => updateElectionState("active"));
  if (lifecycleConcludedBtn) lifecycleConcludedBtn.addEventListener("click", () => updateElectionState("concluded"));
  if (lifecyclePublishBtn) lifecyclePublishBtn.addEventListener("click", () => updateRevealStage(2));

  // Purge button
  if (purgeElectionDataBtn) purgeElectionDataBtn.addEventListener("click", purgeElectionVotes);

  // Candidate Modal
  if (openAddCandidateModalBtn && addCandidateModal) {
    openAddCandidateModalBtn.addEventListener("click", () => addCandidateModal.classList.remove("hidden"));
  }
  if (closeCandidateModalBtn && addCandidateModal) {
    closeCandidateModalBtn.addEventListener("click", () => addCandidateModal.classList.add("hidden"));
  }
  if (cancelCandidateBtn && addCandidateModal) {
    cancelCandidateBtn.addEventListener("click", () => addCandidateModal.classList.add("hidden"));
  }

  if (addCandidateForm && addCandidateModal) {
    addCandidateForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const cat = document.getElementById("candCategorySelect").value;
      const name = document.getElementById("candNameInput").value;
      const roll = document.getElementById("candRollInput").value;
      const manifesto = document.getElementById("candManifestoInput").value;
      const photo = document.getElementById("candPhotoInput").value;

      registerCandidate(cat, name, roll, manifesto, photo);
      addCandidateModal.classList.add("hidden");
      addCandidateForm.reset();
    });
  }

  // Load Admin Candidates when tab is opened
  window.addEventListener("adminTabOpened", () => {
    loadAdminCandidates();
  });
});
