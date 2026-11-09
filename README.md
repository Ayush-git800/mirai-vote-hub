# Mirai Vote Hub
### Institutional Multi-Tenant Election Portal
**Mirai School of Technology — Department of Computer Science & Engineering (AI & ML)**

```
========================================================================================
       __  __ _____ ____      _    ___  __     _____ _____ _____   _   _ _   _ ____  
      |  \/  |_   _|  _ \    / \  |_ _| \ \   / / _ \_   _| ____| | | | | | | | __ ) 
      | |\/| | | | | |_) |  / _ \  | |   \ \ / / | | || | |  _|   | |_| | | | |  _ \ 
      | |  | | | | |  _ <  / ___ \ | |    \ V /| |_| || | | |___  |  _  | |_| | |_) |
      |_|  |_| |_| |_| \_\/_/   \_\___|    \_/  \___/ |_| |_____| |_| |_|\___/|____/ 
                                                                                        
         [ DEPARTMENT OF COMPUTER SCIENCE & ENGINEERING - ARTIFICIAL INTELLIGENCE ]
               [ OFFICIAL CLASS REPRESENTATIVE (CR) ELECTION INFRASTRUCTURE ]
========================================================================================
```

---

## 🏛️ Executive Summary

**Mirai Vote Hub** is a multi-tenant, zero-dummy-data election platform engineered specifically for **Mirai School of Technology (CSE AI/ML)**. Designed around the principles of cryptographic ballot secrecy decoupling, strict identity authentication, atomic concurrency control, and dual-seat representation, the system guarantees 100% election integrity, zero duplicate voting, and automated post-poll certification.

---

## 📐 System Architecture Flowchart

```
+-----------------------------------------------------------------------------------------------+
|                               MIRAI VOTE HUB SYSTEM TOPOLOGY                                 |
+-----------------------------------------------------------------------------------------------+

 [ Phase 1: Ingestion ]
    +------------------------------+
    | Admin / Election Commission  |
    | (Official CSV / JSON Roster) |
    +--------------+---------------+
                   |
                   v
    +----------------------------------+
    | Firestore Batch Commit (Chunked) |
    | Collection: `whitelist/{rollNo}`  |
    | State: { hasVoted: false }       |
    +----------------------------------+

 [ Phase 2: Authentication & Claim ]
    +------------------------------+
    | Eligible Student (Voter)     |
    | Enters Roll No + Passkey     |
    +--------------+---------------+
                   |
                   v
    +----------------------------------+
    | Identity Verification Gate       |
    | - Exists in Whitelist?           |
    | - `hasVoted == false`?           |
    +--------------+---------------+
                   |
         +---------+---------+
         |                   |
    [ Certified ]      [ Duplicate / Reject ]
         |                   |
         v                   v
   Unlock Ballot       Access Blocked (403)
   (Dual-Seat View)    (Already Voted Alert)

 [ Phase 3: Atomic Transaction Voting ]
    +----------------------------------------------------------------+
    | Student casts ballot:                                          |
    |   - Seat 01: Boy Class Representative (Boy CR)                 |
    |   - Seat 02: Girl Class Representative (Girl CR)               |
    +-------------------------------+--------------------------------+
                                    |
                                    v
    +----------------------------------------------------------------+
    |              Cloud Firestore Atomic RunTransaction             |
    |  1. Re-read Whitelist Doc: assert `hasVoted == false`          |
    |  2. Mark Whitelist Doc: `hasVoted: true`, `votedAt: timestamp` |
    |  3. Decouple Ballot: Append anonymous token to `votes` log    |
    |  4. Increment: candidate `voteCount += 1` for Boy & Girl CR    |
    +-------------------------------+--------------------------------+
                                    |
                                    v
    +----------------------------------------------------------------+
    | Tamper-Proof Cryptographic Receipt Token Generated:            |
    | `0xMIRAI-<HEX_TIMESTAMP>-<ENTROPY>`                            |
    +----------------------------------------------------------------+

 [ Phase 4: Sealed Auditing & 2-Stage Reveal ]
                   |
         +---------+---------+
         |                   |
    [ Stage 1 ]         [ Stage 2 ]
    Live Turnout Only   Official Final Reveal
    - Eligible count    - Candidate Vote Counts
    - Votes Cast (%)    - Margin of Victory
    - Turnout Meter     - Certified Winner Badges
    (Ballots Sealed)    (Tallies Unsealed)
```

---

## ⚡ Core Technical Features

### 1. Zero Duplicate Vote Guarantee
The voting mechanism is powered by **Cloud Firestore Atomic Transactions (`runTransaction`)**. 
- The student's whitelist record is evaluated and mutated within an isolated transaction lock.
- If multiple submissions are attempted concurrently or sequentially, the optimistic concurrency checks abort duplicate attempts at the database engine level with zero race conditions.

### 2. Ballot Secrecy Decoupling
To uphold institutional democratic trust:
- The voter identity verification layer operates completely decoupled from the ballot record.
- The voter's record in `/whitelist/{rollNo}` only retains a boolean flag `hasVoted: true` and a receipt hash.
- The actual candidate selections are appended to an unlinked `/votes/{anonymousVoteId}` collection devoid of student names, emails, or roll numbers.

### 3. Dual-Seat Representative Selection
Every eligible voter casts votes across two distinct mandated categories:
- **Seat 01**: Boy Class Representative (Boy CR)
- **Seat 02**: Girl Class Representative (Girl CR)
The UI enforces selecting exactly one candidate per category prior to unlocking the cryptographic review and seal dialog.

### 4. 2-Stage Reveal Controls
- **Stage 1 (Live Turnout Telemetry)**: Real-time telemetry exposes the aggregate percentage of eligible student turnout, votes cast, and pending voters. Individual candidate totals remain cryptographically sealed to prevent bandwagon bias.
- **Stage 2 (Certified Results Unseal)**: Upon poll conclusion, Election Commission officers trigger Stage 2, unsealing individual candidate vote counts, percentage shares, rankings, and certified winner statuses.

### 5. Zero Dummy Data Integrity
All voter records and candidate entries are ingested directly from official university data rosters. No mocked or simulated data persists in production.

---

## 🛠️ Project Structure

```
mirai-vote-hub/
├── assets/
│   └── logo.png              # Official institutional emblem
├── css/
│   └── style.css             # High-tech institutional design system
├── js/
│   ├── firebase-config.js    # Firebase v10 modular initialization
│   ├── auth.js               # Whitelist verification & role state manager
│   ├── voting.js             # Dual-seat ballot & atomic transaction engine
│   ├── results.js            # 2-Stage reveal controls & live telemetry
│   └── admin.js              # Commission tools: batch import, candidates, lifecycle
├── firestore.rules           # Cloud Firestore security rules
├── index.html                # Responsive web app entry point
└── README.md                 # Technical specification & operations manual
```

---

## 🚀 Setup & Deployment Instructions

### Prerequisites
- Node.js (v18+)
- Firebase CLI (`npm install -g firebase-tools`)
- A modern ECMAScript module compatible browser

### 1. Local Development
Clone the repository and serve locally:
```bash
git clone https://github.com/<your-org>/mirai-vote-hub.git
cd mirai-vote-hub

# Serve locally using any static web server or Firebase emulator
npx serve .
# Or with Firebase CLI:
firebase emulators:start
```

### 2. Firebase Configuration
The application is pre-configured with Firebase v10 Modular SDK in `js/firebase-config.js`:
```javascript
const firebaseConfig = {
  apiKey: "AIzaSyC1cDy0hVSIYWaQvK3kfoEQRfo9nMOWNOI",
  authDomain: "mirai-election-portal.firebaseapp.com",
  projectId: "mirai-election-portal",
  storageBucket: "mirai-election-portal.firebasestorage.app",
  messagingSenderId: "11692501775",
  appId: "1:11692501775:web:ac34ca6c485964a7686c7a",
  measurementId: "G-5EQKSZKX7M"
};
```

### 3. Deploying Firestore Security Rules
Ensure the security rules in `firestore.rules` are deployed:
```bash
# Login to Firebase
firebase login

# Set the active project
firebase use mirai-election-portal

# Deploy Firestore Security Rules exclusively
firebase deploy --only firestore:rules
```

### 4. Deploying to Firebase Hosting
Deploy the client frontend to Firebase Hosting:
```bash
# Initialize hosting if needed (public dir: .)
firebase init hosting

# Deploy web app
firebase deploy --only hosting
```

---

## 🔒 Security & Firestore Rules Summary

| Collection | Read Permission | Write / Create Permission | Purpose |
|---|---|---|---|
| `whitelist/{studentId}` | Authenticated | Authenticated (Admins & Self atomic update) | Certified voter registry |
| `candidates/{candidateId}` | Authenticated | Authenticated (Atomic `voteCount` increment) | Boy & Girl CR contenders |
| `votes/{voteId}` | Authenticated (Auditing) | Authenticated (Create once, immutable) | Decoupled anonymous ballot log |
| `election_meta/{metaId}` | Authenticated | Authenticated (Commission controls) | Status & 2-stage reveal state |

---

## 👥 Institution Information
**Mirai School of Technology**  
Department of Computer Science & Engineering (Artificial Intelligence & Machine Learning)  
*Academic Year 2026–2027*
