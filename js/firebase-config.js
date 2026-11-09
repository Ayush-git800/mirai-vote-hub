// Mirai Vote Hub - Firebase v10 Modular Configuration
// Mirai School of Technology - CSE AI/ML

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC1cDy0hVSIYWaQvK3kfoEQRfo9nMOWNOI",
  authDomain: "mirai-election-portal.firebaseapp.com",
  projectId: "mirai-election-portal",
  storageBucket: "mirai-election-portal.firebasestorage.app",
  messagingSenderId: "11692501775",
  appId: "1:11692501775:web:ac34ca6c485964a7686c7a",
  measurementId: "G-5EQKSZKX7M"
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication & Cloud Firestore
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db, firebaseConfig };
