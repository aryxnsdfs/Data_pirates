import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let app = null;
let db = null;

function isConfigured() {
  return !!(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.apiKey !== 'undefined');
}

function getDb() {
  if (!isConfigured()) return null;
  if (!db) {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  }
  return db;
}

// Strip large binary fields from analysis before saving to Firestore
function stripForCloud(analysis) {
  const stripped = { ...analysis };

  // Remove base64 file data — keep only URL references and metadata
  if (stripped.files) {
    const files = {};
    for (const [key, val] of Object.entries(stripped.files)) {
      if (typeof val === 'string' && val.startsWith('data:')) {
        files[key] = null; // was base64 inline, can't persist
      } else {
        files[key] = val; // keep URL paths
      }
    }
    stripped.files = files;
  }

  // Remove raw claims (large) — keep timeline, contradictions, keyObservations
  delete stripped.claims;

  // Truncate timeline descriptions to save space
  if (stripped.timeline) {
    stripped.timeline = stripped.timeline.map(e => ({
      ...e,
      description: e.description?.substring(0, 300) || '',
    }));
  }

  return stripped;
}

export async function saveToCloud(analysis, fileMeta = null) {
  const database = getDb();
  if (!database) return null;

  try {
    const payload = {
      ...stripForCloud(analysis),
      fileMeta: fileMeta || null,
      savedAt: serverTimestamp(),
      _savedFrom: window.location.hostname,
    };

    const ref = await addDoc(collection(database, 'reports'), payload);
    return ref.id;
  } catch (err) {
    console.warn('Firebase save failed:', err.message);
    return null;
  }
}

export async function getCloudReports(maxCount = 50) {
  const database = getDb();
  if (!database) return [];

  try {
    const q = query(
      collection(database, 'reports'),
      orderBy('savedAt', 'desc'),
      limit(maxCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
      savedAt: d.data().savedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
    }));
  } catch (err) {
    console.warn('Firebase fetch failed:', err.message);
    return [];
  }
}

export async function deleteCloudReport(reportId) {
  const database = getDb();
  if (!database) return;

  try {
    await deleteDoc(doc(database, 'reports', reportId));
  } catch (err) {
    console.warn('Firebase delete failed:', err.message);
  }
}

export { isConfigured };
