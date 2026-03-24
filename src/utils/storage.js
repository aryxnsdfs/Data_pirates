/**
 * Report Storage — localStorage only
 * Reports are saved on-device. Install the app as a PWA for best experience.
 */

const STORAGE_KEY = 'dp_saved_reports';

export async function saveReport(analysis) {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  const report = {
    id: Date.now().toString(),
    caseName: analysis.caseName || 'Untitled Analysis',
    caseId: analysis.caseId || '',
    summary: analysis.summary || '',
    contradictionCount: analysis.contradictions?.length || 0,
    savedAt: new Date().toISOString(),
    analysis,
  };
  saved.unshift(report);
  if (saved.length > 50) saved.length = 50;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  return report.id;
}

export async function getSavedReports() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
}

export async function deleteReport(reportId) {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  const filtered = saved.filter(r => r.id !== reportId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}
