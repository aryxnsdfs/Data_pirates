import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Shield, FileSearch, Brain, CheckCircle, Scan, FileCheck, Upload } from 'lucide-react';

const steps = [
  { icon: Upload, label: 'Uploading files...' },
  { icon: FileSearch, label: 'Reading evidence files...' },
  { icon: Scan, label: 'Extracting key details...' },
  { icon: Brain, label: 'Cross-referencing sources...' },
  { icon: Shield, label: 'Identifying discrepancies...' },
  { icon: FileCheck, label: 'Building timeline...' },
  { icon: CheckCircle, label: 'Generating report...' },
];

const STEP_DURATION = 2800;

export default function LoadingScreen({ analysisReady, uploadProgress, onComplete }) {
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState(new Set());
  const timerRef = useRef(null);
  const hasCalledComplete = useRef(false);
  const uploadDone = useRef(false);

  // Step 0 (upload) is controlled by uploadProgress
  // Steps 1-5 advance on timers
  // Step 6 (last) waits for analysisReady

  useEffect(() => {
    // When upload completes (100%), mark step 0 done and start step timers
    if (uploadProgress >= 100 && !uploadDone.current) {
      uploadDone.current = true;
      setCompletedSteps(prev => new Set([...prev, 0]));
      setActiveStep(1);

      let currentStep = 1;
      const advanceStep = () => {
        setCompletedSteps(prev => new Set([...prev, currentStep]));
        currentStep++;
        if (currentStep < steps.length - 1) {
          setActiveStep(currentStep);
          timerRef.current = setTimeout(advanceStep, STEP_DURATION);
        } else if (currentStep === steps.length - 1) {
          setActiveStep(currentStep);
        }
      };
      timerRef.current = setTimeout(advanceStep, STEP_DURATION);
    }
  }, [uploadProgress]);

  // For demo mode (no upload progress), start immediately
  useEffect(() => {
    if (uploadProgress === 0) {
      // No upload happening (demo mode) — skip upload step
      const timeout = setTimeout(() => {
        if (!uploadDone.current) {
          uploadDone.current = true;
          setCompletedSteps(new Set([0]));
          setActiveStep(1);

          let currentStep = 1;
          const advanceStep = () => {
            setCompletedSteps(prev => new Set([...prev, currentStep]));
            currentStep++;
            if (currentStep < steps.length - 1) {
              setActiveStep(currentStep);
              timerRef.current = setTimeout(advanceStep, STEP_DURATION);
            } else if (currentStep === steps.length - 1) {
              setActiveStep(currentStep);
            }
          };
          timerRef.current = setTimeout(advanceStep, STEP_DURATION);
        }
      }, 1500);
      return () => clearTimeout(timeout);
    }
  }, []);

  // When analysis is ready, complete the last step
  useEffect(() => {
    if (analysisReady && !hasCalledComplete.current) {
      // Mark all steps done
      const allDone = new Set(steps.map((_, i) => i));
      setCompletedSteps(allDone);
      hasCalledComplete.current = true;
      setTimeout(() => { if (onComplete) onComplete(); }, 800);
    }
  }, [analysisReady, onComplete]);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  // Progress calculation
  let progress;
  if (analysisReady) {
    progress = 100;
  } else if (uploadProgress < 100) {
    // During upload: 0-40% of bar
    progress = Math.round((uploadProgress / 100) * 40);
  } else {
    // After upload: 40-90% based on completed steps
    const stepsAfterUpload = completedSteps.size - 1; // minus upload step
    const totalStepsAfterUpload = steps.length - 2; // minus upload and last step
    progress = 40 + Math.round((stepsAfterUpload / totalStepsAfterUpload) * 50);
    progress = Math.min(progress, 90);
  }

  // Upload status text
  const uploadText = uploadProgress > 0 && uploadProgress < 100
    ? `Uploading: ${uploadProgress}%`
    : '';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4"
    >
      <div className="text-center w-full max-w-sm">
        {/* Animated brain icon */}
        <div className="relative inline-flex items-center justify-center mb-8">
          <motion.div
            animate={{ scale: [1, 1.15, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            className="p-5 rounded-3xl bg-violet-500/10"
          >
            <Brain className="w-12 h-12 text-violet-500" />
          </motion.div>
          <motion.div
            className="absolute inset-0 rounded-3xl border-2 border-violet-500/30"
            animate={{ scale: [1, 1.4], opacity: [0.6, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
          />
          <motion.div
            className="absolute inset-0 rounded-3xl border-2 border-violet-500/20"
            animate={{ scale: [1, 1.7], opacity: [0.4, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut', delay: 0.3 }}
          />
        </div>

        <motion.h3
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-xl font-semibold mb-2"
        >
          Analyzing Evidence
        </motion.h3>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-neutral-500 dark:text-neutral-400 mb-1 text-sm"
        >
          {uploadText || 'Cross-referencing your files for discrepancies'}
        </motion.p>

        {/* Progress bar */}
        <motion.div
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ delay: 0.4 }}
          className="w-full h-2 bg-neutral-200 dark:bg-neutral-800 rounded-full mb-6 overflow-hidden mt-3"
        >
          <motion.div
            className="h-full bg-gradient-to-r from-violet-500 to-violet-600 rounded-full"
            initial={{ width: '0%' }}
            animate={{ width: `${Math.max(progress, 3)}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </motion.div>

        {/* Progress percentage */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-xs text-neutral-400 dark:text-neutral-500 mb-6 tabular-nums"
        >
          {progress}%
        </motion.p>

        {/* Steps */}
        <div className="space-y-2 max-w-xs mx-auto">
          {steps.map((step, i) => {
            const Icon = step.icon;
            const isActive = i === activeStep && !completedSteps.has(i);
            const isDone = completedSteps.has(i);
            // Show upload step label with percentage
            let label = step.label;
            if (i === 0 && uploadProgress > 0 && uploadProgress < 100) {
              label = `Uploading files... ${uploadProgress}%`;
            }

            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.5 + i * 0.08 }}
                className={`
                  flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all duration-500
                  ${isActive ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400' : ''}
                  ${isDone ? 'text-emerald-600 dark:text-emerald-400' : ''}
                  ${!isActive && !isDone ? 'text-neutral-400 dark:text-neutral-600' : ''}
                `}
              >
                {isDone ? (
                  <CheckCircle className="w-4.5 h-4.5 shrink-0 text-emerald-500" />
                ) : (
                  <Icon className={`w-4.5 h-4.5 shrink-0 ${isActive ? 'animate-pulse' : ''}`} />
                )}
                <span className={isActive ? 'font-medium' : ''}>{label}</span>
                {isDone && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="ml-auto text-[10px] text-emerald-500 font-medium"
                  >
                    Done
                  </motion.span>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
