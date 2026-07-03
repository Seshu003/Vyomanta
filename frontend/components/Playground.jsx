'use client';

import { useState, useEffect, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { usePyodide } from '@/hooks/usePyodide';
import { Play, Square, Trash2, CheckCircle, Loader2, Sparkles, ChevronLeft, ChevronRight, Pause, BookOpen, AlertCircle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function Playground({
  initialCode = '# Write your Python code here\nprint("Hello World!")\n',
  codeOverride = null,
  explanationOverride = null,
  onTraceComplete = null,
  onCodeChange = null,
  codingExercise = null,
  onVerifySuccess = null
}) {
  const getInitialCode = () => {
    if (codingExercise?.hasExercise && codingExercise.starterCode) {
      return codingExercise.starterCode;
    }
    return initialCode;
  };

  const [code, setCode] = useState(getInitialCode);
  const [activeTab, setActiveTab] = useState('console');
  const [explanation, setExplanation] = useState('');
  const [isGeneratingExplanation, setIsGeneratingExplanation] = useState(false);
  const pendingTraceRef = useRef(null);
  const [assertionResults, setAssertionResults] = useState([]);
  const [verifyState, setVerifyState] = useState('idle'); // 'idle' | 'verifying' | 'success' | 'failed'
  const [traceError, setTraceError] = useState(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (codingExercise?.hasExercise && codingExercise.starterCode) {
      setCode(codingExercise.starterCode);
    } else {
      setCode(initialCode);
    }
    setVerifyState('idle');
    setAssertionResults([]);
    setTraceError(null);
  }, [codingExercise, initialCode]);

  const handleCodeChange = (newCode) => {
    setCode(newCode);
    if (onCodeChange) {
      onCodeChange(newCode);
    }
  };

  useEffect(() => {
    if (onCodeChange) {
      onCodeChange(code);
    }
  }, []);

  useEffect(() => {
    if (explanationOverride !== null) {
      setExplanation(explanationOverride);
    }
  }, [explanationOverride]);
  
  // Trace visualizer states
  const [traceData, setTraceData] = useState(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isTracing, setIsTracing] = useState(false);
  
  const terminalElRef = useRef(null);
  const terminalInstanceRef = useRef(null);
  const fitAddonRef = useRef(null);
  const playIntervalRef = useRef(null);
  const editorViewRef = useRef(null);
  const editorPanelRef = useRef(null);
  const [panelHeight, setPanelHeight] = useState(250);
  const isDraggingPanelRef = useRef(false);

  const handlePanelMouseDown = (e) => {
    e.preventDefault();
    isDraggingPanelRef.current = true;
    document.addEventListener('mousemove', handlePanelMouseMove);
    document.addEventListener('mouseup', handlePanelMouseUp);
  };

  const handlePanelMouseMove = (e) => {
    if (!isDraggingPanelRef.current) return;
    const container = editorPanelRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      let newHeight = rect.bottom - e.clientY - 36;
      if (newHeight < 80) newHeight = 80;
      if (newHeight > rect.height - 150) newHeight = rect.height - 150;
      setPanelHeight(newHeight);
    }
  };

  const handlePanelMouseUp = () => {
    isDraggingPanelRef.current = false;
    document.removeEventListener('mousemove', handlePanelMouseMove);
    document.removeEventListener('mouseup', handlePanelMouseUp);
  };

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => {
      document.removeEventListener('mousemove', handlePanelMouseMove);
      document.removeEventListener('mouseup', handlePanelMouseUp);
      window.removeEventListener('resize', checkMobile);
    };
  }, []);

  // Hook callbacks
  const onStdout = (text) => {
    if (text.includes("__TEST_RESULTS__:")) {
      const parts = text.split("__TEST_RESULTS__:");
      const jsonStr = parts[1];
      if (parts[0] && terminalInstanceRef.current) {
        terminalInstanceRef.current.write(parts[0]);
      }
      try {
        const results = JSON.parse(jsonStr.trim());
        setAssertionResults(results);
        const allPassed = results.length > 0 && results.every(r => r.passed);
        if (allPassed) {
          setVerifyState('success');
          if (onVerifySuccess) onVerifySuccess();
        } else {
          setVerifyState('failed');
        }
      } catch (e) {
        console.error("Failed to parse test results:", e);
      }
      return;
    }
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.write(text);
    }
  };

  const onStderr = (text) => {
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.write(`\x1b[31m${text}\x1b[0m`);
    }
  };

  const onReady = () => {
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.write('\r\x1b[2K\x1b[32mEnvironment Ready!\x1b[0m\n');
    }
  };

  const onFinish = () => {
    if (verifyState === 'verifying' && assertionResults.length === 0) {
      setVerifyState('failed');
      setAssertionResults([{ expr: "Execution check", passed: false, msg: "Script completed but verification assertions failed or didn't run." }]);
    }
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.write('\n\x1b[90m--- Program finished ---\x1b[0m\n');
    }
  };

  const onError = (msg) => {
    setIsTracing(false);
    if (verifyState === 'verifying') {
      setVerifyState('failed');
      setAssertionResults([{ expr: "Execution check", passed: false, msg: msg }]);
    }
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.write(`\x1b[31mError: ${msg}\x1b[0m\n`);
    }
    if (onTraceComplete) onTraceComplete(null);
  };

  const validateTraceData = (trace) => {
    if (!trace || !Array.isArray(trace)) {
      return { valid: false, reason: "No execution trace was generated." };
    }
    if (trace.length > 500) {
      return { valid: false, reason: "Execution trace exceeds safety limits (> 500 steps). Infinite loop or heavy recursion detected." };
    }
    const lastStep = trace[trace.length - 1];
    if (lastStep && lastStep.error) {
      if (lastStep.error.includes("Trace limit exceeded")) {
        return { valid: false, reason: "Infinite loop safety limit exceeded. Pyodide execution tracing stopped to avoid freezing the browser." };
      }
    }
    return { valid: true };
  };

  const onTraceResult = (trace) => {
    const check = validateTraceData(trace);
    if (!check.valid) {
      setTraceError(check.reason);
      setTraceData(null);
      setIsTracing(false);
      if (onTraceComplete) onTraceComplete(null);
      return;
    }

    setTraceError(null);
    setTraceData(trace);
    setCurrentStep(0);
    setIsTracing(false);
    if (onTraceComplete) onTraceComplete(trace);
  };

  const { isReady, isRunning, runCode, runTrace, stopCode } = usePyodide({
    onStdout,
    onStderr,
    onReady,
    onFinish,
    onError,
    onTraceResult
  });

  // Trigger trace runner once Pyodide is ready and console execution is finished
  useEffect(() => {
    if (isReady && !isRunning && pendingTraceRef.current !== null) {
      const codeToTrace = pendingTraceRef.current;
      pendingTraceRef.current = null;
      setIsTracing(true);
      setTraceError(null);
      runTrace(codeToTrace);
    }
  }, [isReady, isRunning, runTrace]);

  // Handle parent code overrides
  useEffect(() => {
    if (codeOverride !== null) {
      handleCodeChange(codeOverride);
      setActiveTab('visualizer');
      setIsTracing(true);
      setTraceData(null);
      setTraceError(null);
      
      if (isReady && !isRunning) {
        pendingTraceRef.current = null;
        runTrace(codeOverride);
      } else {
        pendingTraceRef.current = codeOverride;
      }
    }
  }, [codeOverride, isReady, isRunning, runTrace]);

  // Auto-play interval
  useEffect(() => {
    if (isPlaying && traceData) {
      playIntervalRef.current = setInterval(() => {
        setCurrentStep((prev) => {
          if (prev >= traceData.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 1500);
    }
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [isPlaying, traceData]);

  // Highlight and scroll active code line into view in CodeMirror editor
  useEffect(() => {
    if (editorViewRef.current) {
      const view = editorViewRef.current;
      if (traceData && traceData[currentStep]) {
        const activeLine = traceData[currentStep].line;
        try {
          if (activeLine > 0 && activeLine <= view.state.doc.lines) {
            const line = view.state.doc.line(activeLine);
            view.dispatch({
              selection: { anchor: line.from, head: line.to },
              scrollIntoView: true
            });
          }
        } catch (e) {
          console.warn("Error highlighting line in CodeMirror:", e);
        }
      } else {
        // Clear active selection when trace is finished/stopped/cleared
        try {
          const pos = view.state.selection.main.head;
          view.dispatch({
            selection: { anchor: pos, head: pos }
          });
        } catch (e) {}
      }
    }
  }, [currentStep, traceData]);

  // Initialize terminal with layout safety delays
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!terminalElRef.current) return;
    const isUnmounted = { current: false };

    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#090A0F', // matches dark premium theme
        foreground: '#E2E8F0',
        cursor: '#5B8CF8',
      },
      fontSize: 13,
      fontFamily: " var(--font-outfit), monospace",
      convertEol: true
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // Delay opening slightly to let CSS grid/flex layouts fully settle their dimensions
    const initTimer = setTimeout(() => {
      if (isUnmounted.current || !terminalElRef.current) return;
      try {
        term.open(terminalElRef.current);
        terminalInstanceRef.current = term;
        fitAddonRef.current = fitAddon;
        fitAddon.fit();
        term.writeln("\x1b[33mLoading Python Environment (Pyodide WASM)...\x1b[0m");
      } catch (e) {
        console.warn("Failed to initialize xterm:", e);
      }
    }, 100);

    // Bulletproof terminal fitting using ResizeObserver
    const resizeObserver = new ResizeObserver((entries) => {
      if (isUnmounted.current) return;
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && terminalInstanceRef.current) {
          try {
            fitAddon.fit();
          } catch (e) {
            // Ignore errors during CSS transition resizing
          }
        }
      }
    });

    if (terminalElRef.current) {
      resizeObserver.observe(terminalElRef.current);
    }

    return () => {
      isUnmounted.current = true;
      clearTimeout(initTimer);
      resizeObserver.disconnect();
      try {
        term.dispose();
      } catch (e) {
        // Ignore internal disposal errors
      }
      terminalInstanceRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  const generateExplanationForCode = async (codeText) => {
    if (!codeText || !codeText.trim()) return;
    setIsGeneratingExplanation(true);
    setExplanation('Generating explanation...');
    try {
      const systemPrompt = "You are an expert Python tutor. Explain the following Python code step-by-step. Keep your explanation concise, clear, and focused on how the code executes, data structures, and algorithms used. Do not include greetings. Use markdown.";
      const finalPrompt = `Please explain this Python code:\n\`\`\`python\n${codeText}\n\`\`\``;
      
      let storedUserId = '';
      if (typeof window !== 'undefined') {
        storedUserId = localStorage.getItem('lms-user-id') || '';
      }

      const res = await fetch('/api/gemini/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: systemPrompt,
          user: finalPrompt,
          maxOutputTokens: 1500,
          userId: storedUserId
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to generate explanation');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      setExplanation('');
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        setExplanation(fullText);
      }
    } catch (e) {
      console.error(e);
      setExplanation('⚠️ Failed to generate explanation for this code.');
    } finally {
      setIsGeneratingExplanation(false);
    }
  };

  const handleRun = () => {
    if (!isReady || isRunning) return;
    setVerifyState('idle');
    setAssertionResults([]);
    setActiveTab('console');
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.clear();
      terminalInstanceRef.current.writeln('\x1b[90mRunning script...\x1b[0m');
    }
    
    // Start generating AI explanation in the background
    generateExplanationForCode(code);
    
    // Setup tracing visualizer state to loading
    setIsTracing(true);
    setTraceData(null);
    setTraceError(null);
    
    // Queue trace execution for when runCode finishes
    pendingTraceRef.current = code;

    // Execute code in Console
    runCode(code);
  };

  const handleVerify = () => {
    if (!isReady || isRunning) return;
    setVerifyState('verifying');
    setAssertionResults([]);
    setActiveTab('console');
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.clear();
      terminalInstanceRef.current.writeln('\x1b[90mVerifying solution against assertions...\x1b[0m');
    }

    const testCases = codingExercise?.testCases || [];
    let validationCode = code + "\n\n";
    validationCode += "import json\n__results = []\n";
    for (const testCase of testCases) {
      validationCode += `
try:
    ${testCase}
    __results.append({"expr": ${JSON.stringify(testCase)}, "passed": True})
except AssertionError as e:
    __results.append({"expr": ${JSON.stringify(testCase)}, "passed": False, "msg": str(e) or "Assertion failed"})
except Exception as e:
    __results.append({"expr": ${JSON.stringify(testCase)}, "passed": False, "msg": f"Error: {str(e)}"})
`;
    }
    validationCode += '\nprint("__TEST_RESULTS__:" + json.dumps(__results))\n';

    runCode(validationCode);
  };

  const handleClear = () => {
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.clear();
    }
  };

  // Variable visualizer renderer
  const renderVariables = () => {
    if (!traceData || !traceData[currentStep]) return null;
    const { variables = {}, error } = traceData[currentStep];
    
    if (error) {
      return (
        <div style={{ color: '#F55B6B', background: 'rgba(245,91,107,0.08)', border: '1px solid rgba(245,91,107,0.3)', padding: 12, borderRadius: 8, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <strong style={{ display: 'block' }}>⚠️ Python Runtime Error</strong>
          <span style={{ fontFamily: 'monospace' }}>{error}</span>
        </div>
      );
    }

    const keys = Object.keys(variables);
    if (keys.length === 0) {
      return (
        <div style={{ color: '#647298', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
          No local variables defined in this step.
        </div>
      );
    }

    const prevStep = currentStep > 0 ? traceData[currentStep - 1] : null;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {keys.map((key) => {
          const val = variables[key];
          const isArray = Array.isArray(val);
          const isDict = typeof val === 'object' && val !== null && !isArray;
          const prevVal = prevStep ? prevStep.variables?.[key] : undefined;
          const isChanged = prevVal !== undefined && JSON.stringify(prevVal) !== JSON.stringify(val);

          const borderStyle = isChanged ? '1px solid rgba(245, 169, 91, 0.4)' : '1px solid rgba(255, 255, 255, 0.06)';
          const shadowStyle = isChanged ? '0 0 12px rgba(245, 169, 91, 0.15)' : 'none';

          if (isArray) {
            return (
              <motion.div
                key={key}
                layout
                animate={{ scale: isChanged ? [1, 1.03, 1] : 1 }}
                transition={{ duration: 0.3 }}
                className="variable-card"
                style={{ background: '#0D111A', border: borderStyle, boxShadow: shadowStyle, borderRadius: 8, padding: 12 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ fontSize: 11, color: '#8892B0', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{key} (List)</div>
                  {isChanged && <span style={{ fontSize: 9, color: '#F5A95B', background: 'rgba(245, 169, 91, 0.12)', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>Modified</span>}
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {val.map((item, idx) => {
                    const prevItem = Array.isArray(prevVal) ? prevVal[idx] : undefined;
                    const isItemChanged = prevItem !== undefined && prevItem !== item;
                    return (
                      <motion.div
                        key={idx}
                        animate={{ scale: isItemChanged ? [1, 1.15, 1] : 1 }}
                        transition={{ duration: 0.3 }}
                        style={{
                          minWidth: 32,
                          height: 32,
                          padding: '0 6px',
                          borderRadius: 6,
                          background: '#161B26',
                          border: isItemChanged ? `1px solid rgba(245, 169, 91, 0.6)` : `1px solid rgba(91, 140, 248, 0.25)`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 12.5,
                          fontWeight: 700,
                          color: isItemChanged ? '#F5A95B' : '#5B8CF8'
                        }}
                      >
                        {String(item)}
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            );
          }

          if (isDict) {
            return (
              <motion.div
                key={key}
                layout
                animate={{ scale: isChanged ? [1, 1.03, 1] : 1 }}
                transition={{ duration: 0.3 }}
                className="variable-card"
                style={{ background: '#0D111A', border: borderStyle, boxShadow: shadowStyle, borderRadius: 8, padding: 12 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ fontSize: 11, color: '#8892B0', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{key} (Dict)</div>
                  {isChanged && <span style={{ fontSize: 9, color: '#F5A95B', background: 'rgba(245, 169, 91, 0.12)', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>Modified</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {Object.entries(val).map(([k, v]) => {
                    const prevSubVal = prevVal && typeof prevVal === 'object' ? prevVal[k] : undefined;
                    const isSubValChanged = prevSubVal !== undefined && prevSubVal !== v;
                    return (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, borderBottom: `1px solid rgba(255, 255, 255, 0.05)`, padding: '3px 0' }}>
                        <span style={{ color: '#8892B0', fontFamily: 'monospace' }}>{k}</span>
                        <motion.span
                          animate={{ color: isSubValChanged ? '#F5A95B' : '#DDE3F2' }}
                          style={{ fontWeight: 600, fontFamily: 'monospace' }}
                        >
                          {String(v)}
                        </motion.span>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            );
          }

          const valType = typeof val;
          const valColor = isChanged ? '#F5A95B' : (valType === 'boolean' ? '#22C5A0' : (valType === 'number' ? '#5B8CF8' : '#F5A95B'));

          return (
            <motion.div
              key={key}
              layout
              animate={{ scale: isChanged ? [1, 1.05, 1] : 1 }}
              transition={{ duration: 0.3 }}
              className="variable-card"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                background: '#0D111A',
                border: borderStyle,
                boxShadow: shadowStyle,
                borderRadius: 8
              }}
            >
              <span style={{ fontWeight: 600, color: '#8892B0', fontSize: 12.5, fontFamily: 'monospace', display: 'flex', alignItems: 'center' }}>
                {key}
                {isChanged && <span style={{ fontSize: 8, color: '#F5A95B', background: 'rgba(245, 169, 91, 0.12)', padding: '1px 4px', borderRadius: 3, fontWeight: 700, marginLeft: 6 }}>Modified</span>}
              </span>
              <span style={{ fontSize: 12.5, color: valColor, fontWeight: 700, fontFamily: 'monospace' }}>{String(val)}</span>
            </motion.div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#040508',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: 0,
      overflow: 'hidden',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
    }}>
      {/* Playground Header */}
      <div style={{
        padding: '12px 16px',
        background: '#080A0E',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 10
      }}>
        {/* Execution Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleRun}
            disabled={!isReady || isRunning || isTracing}
            style={{
              background: (!isReady || isRunning || isTracing) ? 'rgba(255, 255, 255, 0.08)' : '#22C5A0',
              color: '#000',
              border: 'none',
              padding: '6px 14px',
              borderRadius: 6,
              fontSize: 12.5,
              fontWeight: 700,
              cursor: (!isReady || isRunning || isTracing) ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              opacity: (!isReady || isRunning || isTracing) ? 0.6 : 1,
              transition: 'opacity 0.15s',
              fontFamily: 'inherit'
            }}
          >
            {isRunning && activeTab === 'console' && verifyState !== 'verifying' ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={13} fill="#000" />}
            Run
          </button>

          {codingExercise?.hasExercise && (
            <button
              onClick={handleVerify}
              disabled={!isReady || isRunning || isTracing}
              style={{
                background: (!isReady || isRunning || isTracing) ? 'rgba(255, 255, 255, 0.08)' : '#9B6EF8',
                color: '#fff',
                border: 'none',
                padding: '6px 14px',
                borderRadius: 6,
                fontSize: 12.5,
                fontWeight: 700,
                cursor: (!isReady || isRunning || isTracing) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                opacity: (!isReady || isRunning || isTracing) ? 0.6 : 1,
                transition: 'all 0.15s',
                fontFamily: 'inherit'
              }}
            >
              {verifyState === 'verifying' ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle size={13} />}
              Verify Solution
            </button>
          )}
        </div>

        {/* Status Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#8892B0', fontWeight: 500 }}>
            {!isReady ? (
              <>
                <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                <span>Loading Environment...</span>
              </>
            ) : isRunning ? (
              <>
                <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ color: '#5B8CF8' }}>{verifyState === 'verifying' ? 'Verifying...' : 'Running Code...'}</span>
              </>
            ) : isTracing ? (
              <>
                <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ color: '#F5A95B' }}>Generating Trace...</span>
              </>
            ) : isGeneratingExplanation ? (
              <>
                <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ color: '#22C5A0' }}>Explaining Code...</span>
              </>
            ) : (
              <>
                <CheckCircle size={13} style={{ color: '#22C5A0' }} />
                <span style={{ color: '#22C5A0' }}>Environment Ready</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Split Area */}
      <div style={{ display: 'flex', flex: 1, height: 'calc(100% - 48px)', overflow: 'hidden', flexDirection: isMobile ? 'column' : 'row' }}>
        
        {/* Left Side: Exercise Instructions (rendered only if exercise is enabled) */}
        {codingExercise?.hasExercise && (
          <div style={{
            width: isMobile ? '100%' : '38%',
            borderRight: isMobile ? 'none' : '1px solid rgba(255, 255, 255, 0.08)',
            borderBottom: isMobile ? '1px solid rgba(255, 255, 255, 0.08)' : 'none',
            height: isMobile ? '40%' : '100%',
            overflowY: 'auto',
            padding: 20,
            background: '#090D16',
            display: 'flex',
            flexDirection: 'column',
            gap: 20
          }} className="sandbox-scroll">
            <div>
              <h4 style={{ color: '#9B6EF8', fontSize: 13, fontWeight: 700, margin: '0 0 10px 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Exercise Instructions
              </h4>
              <div style={{ color: '#C4CFE5', fontSize: 13.5, lineHeight: 1.6 }} className="tab-pane md-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {codingExercise.instruction || "*No instructions provided.*"}
                </ReactMarkdown>
              </div>
            </div>

            <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: 16 }}>
              <h4 style={{ color: '#22C5A0', fontSize: 13, fontWeight: 700, margin: '0 0 12px 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Test Cases & Assertions
              </h4>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {verifyState === 'success' && (
                  <div style={{ background: 'rgba(34, 197, 160, 0.1)', border: '1px solid rgba(34, 197, 160, 0.25)', borderRadius: 8, padding: 12, display: 'flex', alignItems: 'center', gap: 10, color: '#22C5A0', fontSize: 13, fontWeight: 600 }}>
                    <Sparkles size={16} />
                    <span>All test cases passed! Excellent! 🎉</span>
                  </div>
                )}

                {verifyState === 'failed' && (
                  <div style={{ background: 'rgba(245, 91, 107, 0.1)', border: '1px solid rgba(245, 91, 107, 0.25)', borderRadius: 8, padding: 12, display: 'flex', alignItems: 'center', gap: 10, color: '#F55B6B', fontSize: 13, fontWeight: 600 }}>
                    <AlertCircle size={16} />
                    <span>Some assertions failed. Check details below.</span>
                  </div>
                )}

                {(codingExercise.testCases || []).map((tc, tcIdx) => {
                  const tcResult = assertionResults.find(r => r.expr === tc);
                  let status = 'idle'; 
                  if (verifyState === 'verifying') status = 'verifying';
                  else if (tcResult) status = tcResult.passed ? 'passed' : 'failed';

                  return (
                    <div key={tcIdx} style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      background: '#0D111A',
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                      borderRadius: 8,
                      padding: 10
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {status === 'verifying' && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite', color: '#9B6EF8' }} />}
                        {status === 'passed' && <CheckCircle size={13} color="#22C5A0" />}
                        {status === 'failed' && <X size={13} color="#F55B6B" />}
                        {status === 'idle' && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#8892B0' }} />}
                        
                        <span style={{ fontFamily: 'monospace', fontSize: 11.5, color: status === 'failed' ? '#F55B6B' : status === 'passed' ? '#22C5A0' : '#8892B0', wordBreak: 'break-all' }}>
                          {tc}
                        </span>
                      </div>
                      {tcResult && !tcResult.passed && tcResult.msg && (
                        <span style={{ fontSize: 10.5, color: '#F55B6B', marginLeft: 21, fontFamily: 'monospace' }}>
                          Reason: {tcResult.msg}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Right Side: Code Editor & Console Panels */}
        <div style={{
          flex: 1,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          {/* Editor & Bottom Panels (Vertical Flex) */}
          <div 
            ref={editorPanelRef}
            style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden' }}
          >
            {/* Code Editor Container */}
            <div style={{ flex: 1, minHeight: 120, background: '#06080C', overflowY: 'auto' }}>
              <CodeMirror
                value={code}
                theme="dark"
                extensions={[python()]}
                onChange={(value) => handleCodeChange(value)}
                onCreateEditor={(view) => {
                  editorViewRef.current = view;
                }}
                style={{ fontSize: 13, fontFamily: 'monospace' }}
              />
            </div>

            {/* Resize Handle */}
            <div
              onMouseDown={handlePanelMouseDown}
              style={{
                height: 5,
                cursor: 'row-resize',
                background: 'rgba(255, 255, 255, 0.08)',
                transition: 'background 0.2s',
                zIndex: 10,
                width: '100%',
                flexShrink: 0
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#5B8CF8'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'}
            />

            {/* Console / Explanation Panel */}
            <div style={{ height: panelHeight, display: 'flex', flexDirection: 'column', background: '#06080C', flexShrink: 0, position: 'relative' }}>
              {/* Tab Selection Header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                background: '#080A0E',
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                padding: '0 10px',
                height: 36,
                flexShrink: 0
              }}>
                <button
                  onClick={() => setActiveTab('console')}
                  style={{
                    background: activeTab === 'console' ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
                    border: 'none',
                    borderBottom: activeTab === 'console' ? `2px solid #5B8CF8` : 'none',
                    color: activeTab === 'console' ? '#F8FAFC' : '#8892B0',
                    padding: '6px 16px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    fontFamily: 'inherit',
                    outline: 'none',
                    transition: 'all 0.15s'
                  }}
                >
                  Console
                </button>
                <button
                  onClick={() => setActiveTab('visualizer')}
                  style={{
                    background: activeTab === 'visualizer' ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
                    border: 'none',
                    borderBottom: activeTab === 'visualizer' ? `2px solid #F5A95B` : 'none',
                    color: activeTab === 'visualizer' ? '#F8FAFC' : '#8892B0',
                    padding: '6px 16px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    fontFamily: 'inherit',
                    outline: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    transition: 'all 0.15s'
                  }}
                >
                  {isTracing ? (
                    <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} color="#F5A95B" />
                  ) : (
                    <Sparkles size={11} color={traceData ? '#F5A95B' : 'currentColor'} />
                  )}
                  Visualizer {traceData ? `(${traceData.length} Steps)` : ''}
                </button>
                <button
                  onClick={() => setActiveTab('explanation')}
                  style={{
                    background: activeTab === 'explanation' ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
                    border: 'none',
                    borderBottom: activeTab === 'explanation' ? `2px solid #22C5A0` : 'none',
                    color: activeTab === 'explanation' ? '#F8FAFC' : '#8892B0',
                    padding: '6px 16px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    fontFamily: 'inherit',
                    outline: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    transition: 'all 0.15s'
                  }}
                >
                  {isGeneratingExplanation ? (
                    <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} color="#22C5A0" />
                  ) : (
                    <BookOpen size={11} color={explanation ? '#22C5A0' : 'currentColor'} />
                  )}
                  Explanation
                </button>
              </div>

              {/* Tab Content Area */}
              <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#040508' }}>
                {/* Console Tab Content */}
                <div
                  ref={terminalElRef}
                  className="tab-pane"
                  style={{
                    display: activeTab === 'console' ? 'block' : 'none',
                    width: '100%',
                    height: '100%',
                    padding: '8px 12px',
                    overflow: 'hidden',
                    background: '#040508'
                  }}
                />

                {/* Visualizer Tab Content */}
                <div className="tab-pane" style={{
                  display: activeTab === 'visualizer' ? 'flex' : 'none',
                  flexDirection: 'column',
                  width: '100%',
                  height: '100%',
                  overflow: 'hidden'
                }}>
                  {traceError && (
                    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px', textAlign: 'center', gap: 12 }}>
                      <div style={{ fontSize: 32 }}>⚠️</div>
                      <h3 style={{ color: '#F8FAFC', fontSize: 16, fontWeight: 700, margin: 0 }}>Visualizer Blocked</h3>
                      <p style={{ color: '#8892B0', fontSize: 13, maxWidth: 360, margin: 0, lineHeight: 1.6 }}>
                        {traceError}
                      </p>
                    </div>
                  )}

                  {isTracing && (
                    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#8892B0' }}>
                      <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
                      <span style={{ fontSize: 13 }}>Generating step-by-step trace timeline...</span>
                    </div>
                  )}

                  {!isTracing && !traceData && !traceError && (
                    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px', textAlign: 'center', color: '#8892B0', gap: 8 }}>
                      <Sparkles size={24} color="#F5A95B" />
                      <span style={{ fontSize: 13, maxWidth: 360 }}>
                        Run your code first to generate a trace timeline and inspect Python execution step-by-step.
                      </span>
                    </div>
                  )}

                  {/* 2. Step Player Controls */}
                  {traceData && (
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      flex: 1,
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        padding: '10px 14px',
                        background: '#080A0E',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexShrink: 0
                      }}>
                        {/* Play/Pause/Prev/Next buttons */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <button
                            onClick={() => setIsPlaying(!isPlaying)}
                            style={{
                              background: '#F5A95B',
                              color: '#000',
                              border: 'none',
                              padding: '5px 10px',
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4
                            }}
                          >
                            {isPlaying ? <Pause size={10} fill="#000" /> : <Play size={10} fill="#000" />}
                            {isPlaying ? 'Pause' : 'Auto Play'}
                          </button>

                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              disabled={currentStep === 0}
                              onClick={() => { setIsPlaying(false); setCurrentStep(prev => prev - 1); }}
                              style={{
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                color: currentStep === 0 ? '#4A5568' : '#F8FAFC',
                                padding: 5,
                                borderRadius: 4,
                                cursor: currentStep === 0 ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center'
                              }}
                            >
                              <ChevronLeft size={12} />
                            </button>
                            <button
                              disabled={currentStep === traceData.length - 1}
                              onClick={() => { setIsPlaying(false); setCurrentStep(prev => prev + 1); }}
                              style={{
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                color: currentStep === traceData.length - 1 ? '#4A5568' : '#F8FAFC',
                                padding: 5,
                                borderRadius: 4,
                                cursor: currentStep === traceData.length - 1 ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center'
                              }}
                            >
                              <ChevronRight size={12} />
                            </button>
                          </div>
                        </div>

                        {/* Step Counts */}
                        <span style={{ fontSize: 11.5, color: '#8892B0', fontWeight: 600, fontFamily: 'monospace' }}>
                          Step {currentStep + 1} of {traceData.length}
                        </span>
                      </div>

                      {/* Variables scope */}
                      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                        <div className="sandbox-scroll" style={{
                          flex: 1,
                          overflowY: 'auto',
                          padding: 14,
                          background: '#040508'
                        }}>
                          <div style={{ fontSize: 11, color: '#8892B0', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 10 }}>Local Variables Scope</div>
                          {renderVariables()}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Explanation Tab Content */}
                <div className="tab-pane sandbox-scroll" style={{
                  display: activeTab === 'explanation' ? 'block' : 'none',
                  width: '100%',
                  height: '100%',
                  padding: 16,
                  overflowY: 'auto',
                  background: '#040508',
                  color: '#F8FAFC'
                }}>
                  {!explanation && !isGeneratingExplanation ? (
                    <div style={{ display: 'flex', height: '100%', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px', textAlign: 'center', color: '#8892B0', gap: 8 }}>
                      <BookOpen size={24} color="#22C5A0" />
                      <span style={{ fontSize: 13, maxWidth: 360 }}>
                        No active explanation loaded. Run your code to generate explanation or trace details.
                      </span>
                    </div>
                  ) : isGeneratingExplanation && !explanation ? (
                    <div style={{ display: 'flex', height: '100%', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#8892B0' }}>
                      <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} color="#22C5A0" />
                      <span style={{ fontSize: 13 }}>Generating step-by-step code explanation...</span>
                    </div>
                  ) : (
                    <div className="md-content" style={{ fontSize: 14, lineHeight: 1.7 }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {explanation}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>

                {/* Console Clear Button (when Console tab is active) */}
                {activeTab === 'console' && (
                  <button
                    onClick={handleClear}
                    title="Clear Console"
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      background: 'rgba(0,0,0,0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: 6,
                      color: '#647298',
                      cursor: 'pointer',
                      padding: 6,
                      display: 'flex',
                      alignItems: 'center',
                      transition: 'color 0.15s, background 0.15s',
                      zIndex: 10
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

      </div>

      <style>{`
        /* Staggered variable card slide-in */
        .variable-card {
          animation: card-enter 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        @keyframes card-enter {
          from { opacity: 0; transform: scale(0.97) translateY(4px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        
        /* Custom scrollbar override for dark theme */
        .sandbox-scroll::-webkit-scrollbar {
          width: 5px;
          height: 5px;
        }
        .sandbox-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.12) !important;
          border-radius: 4px;
        }
        .sandbox-scroll::-webkit-scrollbar-thumb:hover {
          background: #5B8CF8 !important;
        }

        /* Markdown rendering overrides for Sandbox Explanation Tab */
        .tab-pane .md-content {
          color: #E2E8F0 !important;
        }
        .tab-pane .md-content p {
          color: #DDE3F2 !important;
          line-height: 1.7 !important;
          margin-bottom: 12px !important;
        }
        .tab-pane .md-content strong {
          color: #FFFFFF !important;
          font-weight: 700 !important;
        }
        .tab-pane .md-content em {
          color: #F5A95B !important;
        }
        .tab-pane .md-content code {
          background-color: #161B26 !important;
          color: #F5A95B !important;
          border: 1px solid rgba(255, 255, 255, 0.06) !important;
          padding: 2px 6px !important;
          border-radius: 4px !important;
          font-family: monospace !important;
          font-size: 12.5px !important;
        }
        .tab-pane .md-content ul, .tab-pane .md-content ol {
          padding-left: 20px !important;
          margin-bottom: 12px !important;
          color: #DDE3F2 !important;
        }
        .tab-pane .md-content li {
          margin-bottom: 6px !important;
        }
      `}</style>
    </div>
  );
}
