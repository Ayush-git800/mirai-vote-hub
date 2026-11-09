// Mirai Vote Hub - Admin & Election Commission Controller
// Multi-Tenant Lifecycle, Whitelist Bulk Ingestion & Candidate Management
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

// 1. Create Election Operation
export async function createElection(title, department, section) {
  if (!title) throw new Error("Election title is required.");
  const safeSection = (section || "A").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const electionId = `cse-aiml-${safeSection || "cohort"}`;

  try {
    const electionRef = doc(db, "elections", electionId);
    const electionData = {
      id: electionId,
      title: title,
      department: department || "Department of Computer Science & Engineering (AI/ML)",
      section: section || "Section A",
      status: "draft",
      revealStage: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(electionRef, electionData, { merge: true });

    // Also update global election_meta config
    const metaRef = doc(db, "election_meta", "config");
    await setDoc(metaRef, {
      activeElectionId: electionId,
      title: title,
      dept: department || "CSE (AI/ML)",
      section: section || "Section A",
      status: "draft",
      revealStage: 1,
      updatedAt: serverTimestamp()
    }, { merge: true });

    showAlert(`Election '${title}' created successfully in 'draft' mode!`, "success");
    return electionId;
  } catch (err) {
    console.error("Create election failed:", err);
    showAlert(`Failed to create election: ${err.message}`, "error");
    throw err;
  }
}

// 2. Parse Raw Whitelist Input (Handles whitespace, commas, line breaks, CSV, JSON)
export function parseWhitelistInput(rawText) {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  // 1. JSON Array Parse attempt
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
          dept: item.dept || item.department || "CSE (AI/ML)",
          hasVoted: false
        };
      }).filter(v => v.rollNo.length >= 4);
    } catch (e) {
      // Fall through to delimiter parser
    }
  }

  // 2. Robust Token & Delimiter Parser
  // Split on newlines, commas, tabs, or spaces
  const lines = trimmed.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  const voters = [];
  const seen = new Set();

  for (const line of lines) {
    // If CSV row with multiple columns
    if (line.includes(",")) {
      const cols = line.split(",").map(c => c.trim());
      const rawRoll = cols[0].toUpperCase();
      // Skip header if contains 'roll' or 'id'
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
          dept: cols[3] || "CSE (AI/ML)",
          hasVoted: false
        });
      }
    } else {
      // Line containing roll number(s)
      const tokens = line.split(/[\s,;]+/).map(t => t.trim().toUpperCase()).filter(Boolean);
      for (const tok of tokens) {
        const roll = tok.replace(/[^A-Z0-9]/g, "");
        if (roll && roll.length >= 4 && !seen.has(roll)) {
          seen.add(roll);
          voters.push({
            rollNo: roll,
            name: `Student ${roll}`,
            email: `${roll.toLowerCase()}@mirai.ac.in`,
            dept: "CSE (AI/ML)",
            hasVoted: false
          });
        }
      }
    }
  }

  return voters;
}

// 3. Upload & Batch Commit Whitelist to Firestore
export async function uploadWhitelist(electionId = "cse-aiml-a", rawText) {
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

    // Firestore batch limit is 500 writes
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
          dept: voter.dept || "CSE (AI/ML)",
          hasVoted: false,
          updatedAt: serverTimestamp()
        }, { merge: true });

        // Root whitelist compatibility: whitelist/{studentId}
        const rootWhitelistRef = doc(db, "whitelist", rollKey);
        batch.set(rootWhitelistRef, {
          rollNo: rollKey,
          name: voter.name,
          email: voter.email,
          dept: voter.dept || "CSE (AI/ML)",
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

// 4. Candidate Registration: addCandidate(electionId, candidateData)
export async function addCandidate(electionId = "cse-aiml-a", { name, category, photoUrl, manifesto, rollNo }) {
  if (!name) throw new Error("Candidate name is required.");
  const safeRoll = (rollNo || name).trim().replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const candId = `${category}_${safeRoll}`;

  try {
    const candidateData = {
      id: candId,
      name: name.trim(),
      category: category,
      rollNo: (rollNo || "Certified").trim().toUpperCase(),
      manifesto: manifesto || "Committed to representing CSE AI/ML student cohort interests.",
      photoUrl: photoUrl || "",
      voteCount: 0,
      createdAt: serverTimestamp()
    };

    // 1. Write to nested subcollection: elections/{electionId}/candidates/{candidateId}
    const electionCandRef = doc(db, "elections", electionId, "candidates", candId);
    await setDoc(electionCandRef, candidateData, { merge: true });

    // 2. Synchronize to root collection: candidates/{candidateId}
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

// 5. Lifecycle Transition State: setElectionStatus(electionId, status)
// Supports: "draft", "active", "ended", "published"
export async function setElectionStatus(electionId = "cse-aiml-a", status) {
  const validStates = ["draft", "active", "ended", "published", "ready", "concluded"];
  if (!validStates.includes(status)) {
    throw new Error(`Invalid election status: ${status}`);
  }

  // Canonicalize status
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
    // 1. Update election document: elections/{electionId}
    const electionRef = doc(db, "elections", electionId);
    await setDoc(electionRef, {
      status: canonicalStatus,
      revealStage: revealStage,
      updatedAt: serverTimestamp()
    }, { merge: true });

    // 2. Synchronize with election_meta/config
    const metaRef = doc(db, "election_meta", "config");
    await setDoc(metaRef, {
      status: canonicalStatus,
      revealStage: revealStage,
      updatedAt: serverTimestamp()
    }, { merge: true });

    showAlert(`Election status transitioned to: ${status.toUpperCase()}`, "success");
    highlightLifecycleButtons(status);

    // Update status label in top navbar
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

// Backward compatibility alias
export async function updateElectionState(status) {
  return setElectionStatus("cse-aiml-a", status);
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

// Delete Candidate
export async function deleteCandidate(candidateId, electionId = "cse-aiml-a") {
  if (!confirm(`Are you sure you want to remove this candidate (${candidateId})?`)) return;
  try {
    await deleteDoc(doc(db, "elections", electionId, "candidates", candidateId)).catch(() => {});
    await deleteDoc(doc(db, "candidates", candidateId));
    showAlert("Candidate deleted.", "info");
    loadAdminCandidates();
  } catch (error) {
    showAlert(`Delete failed: ${error.message}`, "error");
  }
}

// Load and Render Certified Admin Candidate list
async function loadAdminCandidates(electionId = "cse-aiml-a") {
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

// Emergency Reset Ledger
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

// Setup Event Listeners
document.addEventListener("DOMContentLoaded", () => {
  // Batch Whitelist Processing Button
  if (processWhitelistBtn && whitelistBatchTextarea) {
    processWhitelistBtn.addEventListener("click", () => {
      const raw = whitelistBatchTextarea.value.trim();
      if (!raw) {
        showAlert("Please paste student IDs or CSV roster into the box.", "error");
        return;
      }
      uploadWhitelist("cse-aiml-a", raw);
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
        uploadWhitelist("cse-aiml-a", text);
      };
      reader.readAsText(file);
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

      await createElection(title, dept, section);
    });
  }

  // Candidate Registry Form
  if (adminCandidateRegistryForm) {
    adminCandidateRegistryForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const cat = document.getElementById("adminCandCategory").value;
      const name = document.getElementById("adminCandName").value.trim();
      const roll = document.getElementById("adminCandRoll").value.trim();
      const manifesto = document.getElementById("adminCandManifesto").value.trim();
      const photo = document.getElementById("adminCandPhoto").value.trim();

      await addCandidate("cse-aiml-a", {
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
  if (lifecycleDraftBtn) lifecycleDraftBtn.addEventListener("click", () => setElectionStatus("cse-aiml-a", "draft"));
  if (lifecycleActiveBtn) lifecycleActiveBtn.addEventListener("click", () => setElectionStatus("cse-aiml-a", "active"));
  if (lifecycleConcludedBtn) lifecycleConcludedBtn.addEventListener("click", () => setElectionStatus("cse-aiml-a", "ended"));
  if (lifecyclePublishBtn) lifecyclePublishBtn.addEventListener("click", () => setElectionStatus("cse-aiml-a", "published"));

  if (stage1Btn) stage1Btn.addEventListener("click", () => updateRevealStage(1));
  if (purgeElectionDataBtn) purgeElectionDataBtn.addEventListener("click", purgeElectionVotes);

  // Tab activation listener
  window.addEventListener("adminTabOpened", () => {
    loadAdminCandidates();
  });
});
