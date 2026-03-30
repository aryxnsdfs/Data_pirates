/**
 * Report Storage — Firebase Firestore (cloud) + localStorage (offline fallback)
 */

import { saveToCloud, getCloudReports, deleteCloudReport, isConfigured } from '../firebase.js';

const LOCAL_KEY = 'dp_saved_reports';

function saveLocal(report) {
  const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
  saved.unshift(report);
  if (saved.length > 50) saved.length = 50;
  localStorage.setItem(LOCAL_KEY, JSON.stringify(saved));
}

function getLocal() {
  return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
}

export async function saveReport(analysis, fileMeta = null) {
  const report = {
    id: Date.now().toString(),
    caseName: analysis.caseName || 'Untitled Analysis',
    caseId: analysis.caseId || '',
    summary: analysis.summary || '',
    contradictionCount: analysis.contradictions?.length || 0,
    savedAt: new Date().toISOString(),
    analysis,
    fileMeta: fileMeta || null,
  };

  // Always save locally first (instant, offline-safe)
  saveLocal(report);

  // Save to Firebase cloud
  if (isConfigured()) {
    const cloudId = await saveToCloud(analysis, fileMeta);
    if (cloudId) return cloudId;
  }

  return report.id;
}

export async function getSavedReports() {
  // Merge cloud + local, deduplicate by caseId
  const local = getLocal();

  if (!isConfigured()) return local;

  try {
    const cloud = await getCloudReports();
    // Cloud reports take priority; fill in with local ones not in cloud
    const cloudCaseIds = new Set(cloud.map(r => r.caseId).filter(Boolean));
    const localOnly = local.filter(r => r.caseId && !cloudCaseIds.has(r.caseId));
    return [...cloud, ...localOnly];
  } catch {
    return local;
  }
}

export async function deleteReport(reportId) {
  // Delete from local
  const saved = getLocal().filter(r => r.id !== reportId);
  localStorage.setItem(LOCAL_KEY, JSON.stringify(saved));

  // Delete from cloud
  if (isConfigured()) {
    await deleteCloudReport(reportId).catch(() => {});
  }
}
