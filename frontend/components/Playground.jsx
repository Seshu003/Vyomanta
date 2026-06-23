'use client';

import { useState, useEffect, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { usePyodide } from '@/hooks/usePyodide';
import { Play, Square, Trash2, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

export default function Playground({ initialCode = '# Write your Python code here\nprint("Hello World!")\n' }) {
  const [code, setCode] = useState(initialCode);
  const terminalElRef = useRef(null);
  const terminalInstanceRef = useRef(null);
  const fitAddonRef = useRef(null);

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
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.write(`\x1b[31mError: ${msg}\x1b[0m\n`);
    }
  };

  const { isReady, isRunning, runCode, stopCode } = usePyodide({
    onStdout,
    onStderr,
    onReady,
    onFinish,
    onError
  });

  // Initialize terminal
  useEffect(() => {
    if (typeof window === 'undefined') return;

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
      resizeObserver.disconnect();
      term.dispose();
    };
  }, []);

  const handleRun = () => {
    if (!isReady || isRunning) return;
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.clear();
      terminalInstanceRef.current.writeln('\x1b[90mRunning script...\x1b[0m');
    }
    runCode(code);
  };

  const handleStop = () => {
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.writeln('\n\x1b[31mExecution terminated by user.\x1b[0m');
    }
    stopCode();
  };

  const handleClear = () => {
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.clear();
    }
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
        {/* Run/Stop Buttons */}
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
              transition: 'opacity 0.15s'
            }}
          >
            {isRunning ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={13} fill="#000" />}
            Run
          </button>

          <button
            onClick={handleStop}
            disabled={!isRunning}
            style={{
              background: !isRunning ? 'var(--s3)' : 'var(--red)',
              color: '#fff',
              border: 'none',
              padding: '6px 14px',
              borderRadius: 6,
              fontSize: 12.5,
              fontWeight: 700,
              cursor: !isRunning ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              opacity: !isRunning ? 0.6 : 1,
              transition: 'opacity 0.15s'
            }}
          >
            <Square size={13} fill="#fff" />
            Stop
          </button>
        </div>

        {/* Status indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--muted)', fontWeight: 500 }}>
            {!isReady ? (
              <>
                <Loader2 size={13} style={{ animation: 'spin 1s linear' }} />
                <span>Loading Environment...</span>
              </>
            ) : isRunning ? (
              <>
                <Loader2 size={13} style={{ animation: 'spin 1s linear' }} />
                <span style={{ color: 'var(--accent)' }}>Running Code...</span>
              </>
            ) : (
              <>
                <CheckCircle size={13} style={{ color: 'var(--green)' }} />
                <span style={{ color: 'var(--green)' }}>Environment Ready</span>
              </>
            )}
          </div>

          <button
            onClick={handleClear}
            title="Clear Console"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--dim)',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              transition: 'color 0.15s'
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--dim)'}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Editor & Terminal Panels (Vertical Flex) */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: 'calc(100% - 50px)' }}>
        {/* Code Editor Container */}
        <div style={{ flex: 1.2, overflow: 'auto', background: '#0F172A' }}>
          <CodeMirror
            value={code}
            height="100%"
            theme="dark"
            extensions={[python()]}
            onChange={(value) => setCode(value)}
            style={{ fontSize: 13, fontFamily: 'monospace' }}
          />
        </div>

        {/* Terminal Title Bar */}
        <div style={{
          padding: '4px 16px',
          background: 'var(--s2)',
          borderTop: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)',
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--muted)',
          letterSpacing: '0.05em',
          textTransform: 'uppercase'
        }}>
          Console Output
        </div>

        {/* Xterm terminal container */}
        <div
          ref={terminalElRef}
          style={{
            flex: 0.8,
            padding: '8px 12px',
            background: '#090A0F',
            overflow: 'hidden',
            minHeight: 120
          }}
        />
      </div>
    </div>
  );
}
