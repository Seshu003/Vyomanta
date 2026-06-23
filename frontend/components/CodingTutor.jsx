'use client';

import { Code2 } from 'lucide-react';
import { T } from '@/lib/lms-data';
import { useMediaQuery, isMobileMQ } from '@/lib/useMediaQuery';
import dynamic from 'next/dynamic';
const Playground = dynamic(() => import('./Playground'), { ssr: false });

export default function CodingTutor() {
  const isMobile = useMediaQuery(isMobileMQ);
  
  return (
    <div style={{ 
      padding: isMobile ? '20px 16px' : '32px 36px', 
      fontFamily: 'var(--font-outfit), sans-serif',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Title Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 9,
          background: `${T.amber}22`, border: `1px solid ${T.amber}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <Code2 size={16} color={T.amber} />
        </div>
        <h2 style={{ color: T.text, fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: '-0.03em' }}>Coding Tutor Sandbox</h2>
      </div>
      <p style={{ color: T.muted, fontSize: 13.5, marginBottom: 16 }}>
        Write, run, and experiment with Python code immediately inside this sandboxed environment.
      </p>

      {/* Main Sandbox Playground */}
      <div style={{ flex: 1, minHeight: 400, marginBottom: 20 }}>
        <Playground initialCode={`# Python Coding Sandbox\n# Write python code here and run it!\n\ndef greet(name):\n    print(f"Hello, {name}!")\n\ngreet("Seshu")\n`} />
      </div>
    </div>
  );
}
