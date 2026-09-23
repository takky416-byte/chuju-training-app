import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

export const PARENT_ACCOUNT_HASHES = [
  "4344c27a54708b8f93f4ee6188e6cc1f6c34acae8c591663a999fd879f579076",
  "1556589f49b579813abcf9c5118c0ad6a8346e9b19fb84a403d24acf87fb3f8a",
];
export const LEARNER_ACCOUNT_HASH = "69b4e9b0e95a3cb3c9a3ecdf7cc12468f707634f698e879f3c7c636481cd0960";
export const LEARNER_RECORD_ID = LEARNER_ACCOUNT_HASH;

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyC0yy1vbS-5sIW5gd93XRIFJTBEh9Qd6kU",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "aichi-jh-training-507310.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "aichi-jh-training-507310",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "aichi-jh-training-507310.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "127127795519",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:127127795519:web:8ff9820a7321a80e4f458a",
};

export const firebaseConfigured = Object.values(firebaseConfig).every(Boolean);
const app: FirebaseApp | null = firebaseConfigured ? (getApps()[0] ?? initializeApp(firebaseConfig)) : null;

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export async function hashEmail(email: string) {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}
