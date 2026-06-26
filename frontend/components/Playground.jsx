'use client';

import { useState, useEffect, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { usePyodide } from '@/hooks/usePyodide';
import { Play, Square, Trash2, CheckCircle, Loader2, Sparkles, ChevronLeft, ChevronRight, Pause, BookOpen } from 'lucide-react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function Playground({
  initialCode = '# Write your Python code here\nprint("Hello World!")\n',
  codeOverride = null,
  explanationOverride = null,
  onTraceComplete = null
}) {
  const [code, setCode] = useState(initialCode);
  const [activeTab, setActiveTab] = useState('console');
  const [explanation, setExplanation] = useState('');

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

  // Hook callbacks
  const onStdout = (text) => {
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
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.write('\n\x1b[90m--- Program finished ---\x1b[0m\n');
    }
  };

  const onError = (msg) => {
    setIsTracing(false);
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.write(`\x1b[31mError: ${msg}\x1b[0m\n`);
    }
    if (onTraceComplete) onTraceComplete(null);
  };

  const onTraceResult = (trace) => {
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

  // Handle parent code overrides
  useEffect(() => {
    if (codeOverride !== null) {
      setCode(codeOverride);
      setActiveTab('visualizer');
      setIsTracing(true);
      setTraceData(null);
      // Wait for Pyodide worker to be ready to trace
      const timer = setTimeout(() => {
        runTrace(codeOverride);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [codeOverride, runTrace]);

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

  // Initialize terminal
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
      fontFamily: "var(--font-outfit), monospace",
      convertEol: true
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalElRef.current);

    terminalInstanceRef.current = term;
    fitAddonRef.current = fitAddon;

    term.writeln("\x1b[33mLoading Python Environment (Pyodide WASM)...\x1b[0m");

    // Bulletproof terminal fitting using ResizeObserver
    const resizeObserver = new ResizeObserver((entries) => {
      if (isUnmounted.current) return;
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
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
      resizeObserver.disconnect();
      term.dispose();
      terminalInstanceRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  const handleRun = () => {
    if (!isReady || isRunning) return;
    setActiveTab('console');
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.clear();
      terminalInstanceRef.current.writeln('\x1b[90mRunning script...\x1b[0m');
    }
    runCode(code);
  };

  const handleRunTrace = () => {
    if (!isReady || isRunning) return;
    setActiveTab('visualizer');
    setIsTracing(true);
    setTraceData(null);
    runTrace(code);
  };

  const handleStop = () => {
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.writeln('\n\x1b[31mExecution terminated by user.\x1b[0m');
    }
    stopCode();
    setIsTracing(false);
    setIsPlaying(false);
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
        <div style={{ color: 'var(--red)', background: 'rgba(245,91,107,0.08)', border: '1px solid rgba(245,91,107,0.3)', padding: 12, borderRadius: 8, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <strong style={{ display: 'block' }}>⚠️ Python Runtime Error</strong>
          <span style={{ fontFamily: 'monospace' }}>{error}</span>
        </div>
      );
    }

    const keys = Object.keys(variables);
    if (keys.length === 0) {
      return (
        <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
          No local variables defined in this step.
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {keys.map((key) => {
          const val = variables[key];
          const isArray = Array.isArray(val);
          const isDict = typeof val === 'object' && val !== null && !isArray;

          if (isArray) {
            return (
              <div key={key} style={{ background: 'var(--s2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>{key} (List)</div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {val.map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        minWidth: 32,
                        height: 32,
                        padding: '0 6px',
                        borderRadius: 6,
                        background: 'var(--s3)',
                        border: `1px solid var(--accent)40`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12.5,
                        fontWeight: 700,
                        color: 'var(--accent)'
                      }}
                    >
                      {String(item)}
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          if (isDict) {
            return (
              <div key={key} style={{ background: 'var(--s2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>{key} (Dict)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {Object.entries(val).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, borderBottom: `1px solid var(--border)`, padding: '3px 0' }}>
                      <span style={{ color: 'var(--muted)', fontFamily: 'monospace' }}>{k}</span>
                      <span style={{ fontWeight: 600, color: 'var(--text)', fontFamily: 'monospace' }}>{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          const valType = typeof val;
          const valColor = valType === 'boolean' ? 'var(--green)' : (valType === 'number' ? 'var(--accent)' : 'var(--amber)');

          return (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                background: 'var(--s2)',
                border: '1px solid var(--border)',
                borderRadius: 10
              }}
            >
              <span style={{ fontWeight: 600, color: 'var(--muted)', fontSize: 12.5, fontFamily: 'monospace' }}>{key}</span>
              <span style={{ fontSize: 12.5, color: valColor, fontWeight: 700, fontFamily: 'monospace' }}>{String(val)}</span>
            </div>
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
      background: 'var(--s1)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      overflow: 'hidden',
      boxShadow: '0 4px 20px rgba(0,0,0,0.02)'
    }}>
      {/* Playground Header */}
      <div style={{
        padding: '12px 16px',
        background: 'var(--s2)',
        borderBottom: '1px solid var(--border)',
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
            disabled={!isReady || isRunning}
            style={{
              background: (!isReady || isRunning) ? 'var(--s3)' : 'var(--green)',
              color: '#000',
              border: 'none',
              padding: '6px 14px',
              borderRadius: 6,
              fontSize: 12.5,
              fontWeight: 700,
              cursor: (!isReady || isRunning) ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              opacity: (!isReady || isRunning) ? 0.6 : 1,
              transition: 'opacity 0.15s',
              fontFamily: 'inherit'
            }}
          >
            {isRunning && activeTab === 'console' ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={13} fill="#000" />}
            Run
          </button>

          <button
            onClick={handleRunTrace}
            disabled={!isReady || isRunning}
            style={{
              background: (!isReady || isRunning) ? 'var(--s3)' : 'var(--amber)',
              color: '#000',
              border: 'none',
              padding: '6px 14px',
              borderRadius: 6,
              fontSize: 12.5,
              fontWeight: 700,
              cursor: (!isReady || isRunning) ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              opacity: (!isReady || isRunning) ? 0.6 : 1,
              transition: 'opacity 0.15s',
              fontFamily: 'inherit'
            }}
            title="Visualize Python code execution line-by-line"
          >
            {isTracing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={13} fill="#000" />}
            Run Trace
          </button>

          <button
            onClick={handleStop}
            disabled={!isRunning && !isTracing}
            style={{
              background: (!isRunning && !isTracing) ? 'var(--s3)' : 'var(--red)',
              color: '#fff',
              border: 'none',
              padding: '6px 14px',
              borderRadius: 6,
              fontSize: 12.5,
              fontWeight: 700,
              cursor: (!isRunning && !isTracing) ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              opacity: (!isRunning && !isTracing) ? 0.6 : 1,
              transition: 'opacity 0.15s',
              fontFamily: 'inherit'
            }}
          >
            <Square size={13} fill="#fff" />
            Stop
          </button>
        </div>

        {/* Status Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--muted)', fontWeight: 500 }}>
            {!isReady ? (
              <>
                <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                <span>Loading Environment...</span>
              </>
            ) : isRunning ? (
              <>
                <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ color: 'var(--accent)' }}>Running Code...</span>
              </>
            ) : isTracing ? (
              <>
                <Loader2 size={13} style={{ animation: 'spin 1s linear' }} />
                <span style={{ color: 'var(--amber)' }}>Generating Trace...</span>
              </>
            ) : (
              <>
                <CheckCircle size={13} style={{ color: 'var(--green)' }} />
                <span style={{ color: 'var(--green)' }}>Environment Ready</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Editor & Bottom Panels (Vertical Flex) */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: 'calc(100% - 50px)' }}>
        {/* Code Editor Container */}
        <div style={{ overflow: 'auto', background: '#0F172A' }}>
          <CodeMirror
            value={code}
            height="100%"
            theme="dark"
            extensions={[python()]}
            onChange={(value) => setCode(value)}
            onCreateEditor={(view) => {
              editorViewRef.current = view;
            }}
            style={{ fontSize: 13, fontFamily: 'monospace' }}
          />
        </div>

        {/* Tab Selection Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          background: 'var(--s2)',
          borderTop: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)',
          padding: '0 10px',
          height: 36,
          flexShrink: 0
        }}>
          <button
            onClick={() => setActiveTab('console')}
            style={{
              background: activeTab === 'console' ? 'var(--s3)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'console' ? `2px solid var(--accent)` : 'none',
              color: activeTab === 'console' ? 'var(--text)' : 'var(--muted)',
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
              background: activeTab === 'visualizer' ? 'var(--s3)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'visualizer' ? `2px solid var(--amber)` : 'none',
              color: activeTab === 'visualizer' ? 'var(--text)' : 'var(--muted)',
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
            <Sparkles size={11} color={traceData ? 'var(--amber)' : 'currentColor'} />
            Visualizer {traceData ? `(${traceData.length} Steps)` : ''}
          </button>
          <button
            onClick={() => setActiveTab('explanation')}
            style={{
              background: activeTab === 'explanation' ? 'var(--s3)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'explanation' ? `2px solid var(--green)` : 'none',
              color: activeTab === 'explanation' ? 'var(--text)' : 'var(--muted)',
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
            <BookOpen size={11} color={explanation ? 'var(--green)' : 'currentColor'} />
            Explanation
          </button>
        </div>

        {/* Tab Content Area */}
        <div style={{ flex: 0.9, position: 'relative', overflow: 'hidden', background: 'var(--s1)' }}>
          
          {/* Console Tab Content */}
          <div
            ref={terminalElRef}
            style={{
              display: activeTab === 'console' ? 'block' : 'none',
              width: '100%',
              height: '100%',
              padding: '8px 12px',
              overflow: 'hidden',
              background: '#090A0F'
            }}
          />

          {/* Visualizer Tab Content */}
          <div style={{
            display: activeTab === 'visualizer' ? 'flex' : 'none',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            overflow: 'hidden'
          }}>
            {/* 1. If Loading or empty trace */}
            {isTracing && (
              <div style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--muted)' }}>
                <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: 13 }}>Generating step-by-step trace timeline...</span>
              </div>
            )}

            {!isTracing && !traceData && (
              <div style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px', textAlign: 'center', color: 'var(--muted)', gap: 8 }}>
                <Sparkles size={24} color="var(--amber)" />
                <span style={{ fontSize: 13, maxWidth: 360 }}>
                  No active trace loaded. Write Python code and click <strong>Run Trace</strong> or click <strong>Visualize Code</strong> in the chatbot below!
                </span>
              </div>
            )}

            {/* 2. Timeline player & visualizer panels */}
            {!isTracing && traceData && (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden' }}>
                
                {/* Media Player Controls */}
                <div style={{
                  padding: '8px 16px',
                  background: 'var(--s2)',
                  borderBottom: `1px solid var(--border)`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  flexShrink: 0
                }}>
                  {/* Play/Pause */}
                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    style={{
                      background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4
                    }}
                    title={isPlaying ? "Pause execution" : "Auto play timeline"}
                  >
                    {isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                  </button>

                  {/* Nav Step */}
                  <button
                    onClick={() => { setIsPlaying(false); setCurrentStep(prev => Math.max(prev - 1, 0)); }}
                    disabled={currentStep === 0}
                    style={{
                      background: 'none', border: 'none', color: currentStep === 0 ? 'var(--dim)' : 'var(--text)', cursor: currentStep === 0 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', padding: 4
                    }}
                    title="Previous step"
                  >
                    <ChevronLeft size={16} />
                  </button>

                  <button
                    onClick={() => { setIsPlaying(false); setCurrentStep(prev => Math.min(prev + 1, traceData.length - 1)); }}
                    disabled={currentStep === traceData.length - 1}
                    style={{
                      background: 'none', border: 'none', color: currentStep === traceData.length - 1 ? 'var(--dim)' : 'var(--text)', cursor: currentStep === traceData.length - 1 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', padding: 4
                    }}
                    title="Next step"
                  >
                    <ChevronRight size={16} />
                  </button>

                  {/* Scrubbing Slider */}
                  <input
                    type="range"
                    min={0}
                    max={traceData.length - 1}
                    value={currentStep}
                    onChange={(e) => { setIsPlaying(false); setCurrentStep(Number(e.target.value)); }}
                    style={{
                      flex: 1,
                      accentColor: 'var(--amber)',
                      cursor: 'pointer',
                      height: 4
                    }}
                  />

                  {/* Step Counts */}
                  <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, fontFamily: 'monospace' }}>
                    Step {currentStep + 1} of {traceData.length}
                  </span>
                </div>

                {/* Left/Right Panels Layout */}
                <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                  
                  {/* Variable Visualizer Panel (Full Width) */}
                  <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: 14,
                    background: 'var(--s1)'
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 10 }}>Local Variables Scope</div>
                    {renderVariables()}
                  </div>

                </div>

              </div>
            )}

          </div>

          {/* Explanation Tab Content */}
          <div style={{
            display: activeTab === 'explanation' ? 'block' : 'none',
            width: '100%',
            height: '100%',
            padding: 16,
            overflowY: 'auto',
            background: 'var(--s1)',
            color: 'var(--text)'
          }}>
            {!explanation ? (
              <div style={{ display: 'flex', height: '100%', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px', textAlign: 'center', color: 'var(--muted)', gap: 8 }}>
                <BookOpen size={24} color="var(--green)" />
                <span style={{ fontSize: 13, maxWidth: 360 }}>
                  No active explanation loaded. Click <strong>Visualize Code</strong> in the chatbot below to view the explanation here!
                </span>
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
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--dim)',
                cursor: 'pointer',
                padding: 6,
                display: 'flex',
                alignItems: 'center',
                transition: 'color 0.15s, background 0.15s',
                zIndex: 10
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.background = 'rgba(0,0,0,0.6)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--dim)'; e.currentTarget.style.background = 'rgba(0,0,0,0.4)'; }}
            >
              <Trash2 size={13} />
            </button>
          )}

        </div>
      </div>
    </div>
  );
}
