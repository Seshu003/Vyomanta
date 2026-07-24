// Background Worker for Pyodide Execution
importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.1/full/pyodide.js');

let pyodide = null;

// SharedArrayBuffer for stdin: [0]=status (0=waiting,1=ready), rest=UTF-8 bytes up to 1023 chars
let stdinBuffer = null;

async function initPyodide() {
  if (pyodide) return;
  try {
    pyodide = await loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.1/full/',
      stdout: (text) => {
        postMessage({ type: 'STDOUT', content: text + '\n' });
      },
      stderr: (text) => {
        postMessage({ type: 'STDERR', content: text + '\n' });
      }
    });

    postMessage({ type: 'READY' });
  } catch (error) {
    postMessage({ type: 'ERROR', message: 'Failed to load Pyodide: ' + error.message });
  }
}

/**
 * Blocking stdin reader using SharedArrayBuffer + Atomics.
 * The main thread fills the buffer and sets index[0] = 1 when input is ready.
 * We spin-wait (Atomics.wait) until that happens.
 */
function readStdinBlocking() {
  if (!stdinBuffer) return '';
  const control = new Int32Array(stdinBuffer, 0, 1);
  const data = new Uint8Array(stdinBuffer, 4);

  // Signal to main thread that we need input
  postMessage({ type: 'STDIN_REQUEST' });

  // Block until main thread sets control[0] = 1
  Atomics.store(control, 0, 0);
  Atomics.wait(control, 0, 0); // blocks until != 0

  // Read the UTF-8 string from the buffer
  let end = 0;
  while (end < data.length && data[end] !== 0) end++;
  const bytes = data.slice(0, end);
  const text = new TextDecoder().decode(bytes);

  // Reset buffer for next call
  data.fill(0);
  Atomics.store(control, 0, 0);

  return text;
}

self.onmessage = async function (event) {
  const { type, code, inputText, buffer } = event.data;

  if (type === 'INIT') {
    await initPyodide();

  } else if (type === 'INIT_STDIN_BUFFER') {
    // Main thread sends us a SharedArrayBuffer for blocking stdin
    stdinBuffer = buffer;

  } else if (type === 'STDIN_RESPONSE') {
    // Legacy fallback: main thread sends input text directly (non-blocking path)
    // This is handled via buffer now; kept for safety
    if (stdinBuffer) {
      const control = new Int32Array(stdinBuffer, 0, 1);
      const data = new Uint8Array(stdinBuffer, 4);
      data.fill(0);
      const encoded = new TextEncoder().encode(inputText || '');
      data.set(encoded.slice(0, data.length - 1));
      Atomics.store(control, 0, 1);
      Atomics.notify(control, 0, 1);
    }

  } else if (type === 'RUN') {
    if (!pyodide) {
      postMessage({ type: 'ERROR', message: 'Environment is not initialized yet.' });
      return;
    }

    try {
      // Override Python's input() to use our blocking stdin reader
      pyodide.globals.set('__js_read_stdin__', readStdinBlocking);
      await pyodide.runPythonAsync(`
import builtins
def _custom_input(prompt=''):
    import sys
    if prompt:
        sys.stdout.write(prompt)
        sys.stdout.flush()
    return __js_read_stdin__()
builtins.input = _custom_input
`);

      await pyodide.loadPackagesFromImports(code);
      await pyodide.runPythonAsync(code);
      postMessage({ type: 'FINISH' });
    } catch (error) {
      postMessage({ type: 'STDERR', content: error.message + '\n' });
      postMessage({ type: 'FINISH' });
    }

  } else if (type === 'TRACE') {
    if (!pyodide) {
      postMessage({ type: 'ERROR', message: 'Environment is not initialized yet.' });
      return;
    }

    try {
      const traceRunner = `
import sys
import json
import math
import io

class TraceStdout:
    def __init__(self):
        self.buf = ""
    def write(self, s):
        self.buf += s
    def flush(self):
        pass

def serialize_val(val, visited=None):
    if visited is None:
        visited = set()
    val_id = id(val)
    if val_id in visited:
        return "<circular reference>"
    if isinstance(val, float):
        if math.isnan(val):
            return "NaN"
        elif math.isinf(val):
            return "Infinity" if val > 0 else "-Infinity"
        return val
    try:
        json.dumps(val, allow_nan=False)
        return val
    except:
        visited.add(val_id)
        try:
            if isinstance(val, (set, tuple)):
                return [serialize_val(x, visited) for x in val]
            elif isinstance(val, list):
                return [serialize_val(x, visited) for x in val]
            elif isinstance(val, dict):
                return {str(k): serialize_val(v, visited) for k, v in val.items()}
            else:
                return str(val)
        finally:
            visited.remove(val_id)

def trace_code(code_string):
    trace_data = []
    step_counter = 0
    
    stdout_redirector = TraceStdout()
    old_stdout = sys.stdout
    sys.stdout = stdout_redirector

    def trace_lines(frame, event, arg):
        nonlocal step_counter
        if frame.f_code.co_filename == '<string>':
            if event in ('line', 'return'):
                step_counter += 1
                if step_counter > 500:
                    raise Exception("Trace limit exceeded (max 500 steps) to prevent infinite loops.")
                
                local_vars = {}
                for k, v in frame.f_locals.items():
                    if not k.startswith('__') and k != 'trace_code' and k != 'trace_lines' and k != 'serialize_val':
                        local_vars[k] = serialize_val(v)
                
                trace_data.append({
                    "step": step_counter,
                    "line": frame.f_lineno,
                    "variables": local_vars,
                    "stdout": stdout_redirector.buf,
                    "event": event
                })
        return trace_lines

    globals_dict = {"__name__": "__main__"}
    locals_dict = {}
    
    sys.settrace(trace_lines)
    try:
        exec(code_string, globals_dict, locals_dict)
    except Exception as e:
        trace_data.append({
            "step": step_counter + 1,
            "line": 0,
            "error": str(e),
            "variables": {},
            "stdout": stdout_redirector.buf
        })
    finally:
        sys.settrace(None)
        sys.stdout = old_stdout
        
    return json.dumps(trace_data)
`;
      await pyodide.runPythonAsync(traceRunner);
      pyodide.globals.set("user_code_str", code);
      const jsonResult = await pyodide.runPythonAsync("trace_code(user_code_str)");
      postMessage({ type: 'TRACE_RESULT', content: JSON.parse(jsonResult) });
    } catch (error) {
      postMessage({ type: 'ERROR', message: error.message });
    }
  }
};
