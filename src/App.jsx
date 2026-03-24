import { useState, useCallback, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import Header from './components/Header';
import UploadView from './components/UploadView';
import LoadingScreen from './components/LoadingScreen';
import Dashboard from './components/Dashboard';
import SplitScreen from './components/SplitScreen';
import { analyzeEvidence, translateAnalysis } from './utils/api';

export default function App() {
  const [view, setView] = useState('upload');
  const [files, setFiles] = useState({ pdf: [], audio: [], video: [] });
  const [analysis, setAnalysis] = useState(null);
  const [originalAnalysis, setOriginalAnalysis] = useState(null); // untranslated copy
  const [selectedContradiction, setSelectedContradiction] = useState(null);
  const [error, setError] = useState(null);
  const [analysisReady, setAnalysisReady] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentLang, setCurrentLang] = useState('en');
  const [translating, setTranslating] = useState(false);
  const pendingAnalysis = useRef(null);

  const handleAnalyze = useCallback(async (uploadedFiles) => {
    setFiles(uploadedFiles);
    setView('loading');
    setError(null);
    setAnalysisReady(false);
    setUploadProgress(0);
    pendingAnalysis.current = null;

    try {
      const result = await analyzeEvidence(uploadedFiles, (progress) => {
        setUploadProgress(progress);
      });
      pendingAnalysis.current = result;
      setAnalysisReady(true);
    } catch (err) {
      setError(err.message);
      setView('upload');
    }
  }, []);

  // Called by LoadingScreen when animation finishes after analysisReady
  const handleLoadingComplete = useCallback(() => {
    if (pendingAnalysis.current) {
      const result = pendingAnalysis.current;
      setAnalysis(result);
      setOriginalAnalysis(result);
      setCurrentLang('en');
      pendingAnalysis.current = null;
      setView('dashboard');
    }
  }, []);

  const handleLanguageChange = useCallback(async (lang) => {
    if (lang === currentLang) return;
    if (!analysis) return;

    if (lang === 'en') {
      // Revert to original
      setAnalysis(originalAnalysis);
      setCurrentLang('en');
      return;
    }

    setTranslating(true);
    try {
      const source = originalAnalysis || analysis;
      const translated = await translateAnalysis(source, lang);
      // Preserve files from original
      translated.files = analysis.files;
      setAnalysis(translated);
      setCurrentLang(lang);
    } catch (err) {
      console.error('Translation failed:', err);
    } finally {
      setTranslating(false);
    }
  }, [analysis, originalAnalysis, currentLang]);

  const handleCardClick = useCallback((contradiction) => {
    setSelectedContradiction(contradiction);
    setView('split');
  }, []);

  const handleBack = useCallback(() => {
    if (view === 'split') {
      setSelectedContradiction(null);
      setView('dashboard');
    } else {
      setView('upload');
      setAnalysis(null);
      setOriginalAnalysis(null);
      setCurrentLang('en');
      setFiles({ pdf: [], audio: [], video: [] });
    }
  }, [view]);

  const handleOpenSavedReport = useCallback((reportAnalysis) => {
    setAnalysis(reportAnalysis);
    setOriginalAnalysis(reportAnalysis);
    setCurrentLang('en');
    setView('dashboard');
  }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950 theme-transition">
      <Header
        showBack={view !== 'upload'}
        onBack={handleBack}
        caseName={analysis?.caseName}
        showLanguage={view === 'dashboard' || view === 'split'}
        currentLang={currentLang}
        onLanguageChange={handleLanguageChange}
        translating={translating}
      />
      <main className="pt-16">
        <AnimatePresence mode="wait">
          {view === 'upload' && (
            <UploadView
              key="upload"
              onAnalyze={handleAnalyze}
              onOpenReport={handleOpenSavedReport}
              error={error}
            />
          )}
          {view === 'loading' && (
            <LoadingScreen
              key="loading"
              analysisReady={analysisReady}
              uploadProgress={uploadProgress}
              onComplete={handleLoadingComplete}
            />
          )}
          {view === 'dashboard' && analysis && (
            <Dashboard
              key="dashboard"
              analysis={analysis}
              setAnalysis={setAnalysis}
              onCardClick={handleCardClick}
            />
          )}
          {view === 'split' && selectedContradiction && (
            <SplitScreen
              key="split"
              contradiction={selectedContradiction}
              files={files}
              analysisFiles={analysis?.files}
              onBack={handleBack}
            />
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
