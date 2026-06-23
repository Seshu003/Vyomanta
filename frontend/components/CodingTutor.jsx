'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Code2, Loader2, ChevronRight, Lock, FlipHorizontal,
  Paperclip, Mic, Image, HelpCircle, Send, AlignLeft, Sparkles, ChevronLeft,
  BookOpen, BarChart3, Home, Zap
} from 'lucide-react';
import {
  T, geminiCall,
  classifyIntent, evaluateMath, getGreetingResponse, getThanksResponse,
  buildChatPrompt, buildFeaturePrompt,
  parseQuizOutput, parseFlashcardsOutput, parseInfographicOutput,
  CODING_TUTOR_SYSTEM, TUTOR_SYSTEM, QUIZ_SYSTEM, FLASHCARD_SYSTEM, INFOGRAPHIC_SYSTEM, SIMPLER_SYSTEM, EXAMPLES_SYSTEM,
  MAX_TOKENS, getTheme, setTheme
} from '@/lib/lms-data';
import UnifiedSidebar from '@/components/voice-tutor/UnifiedSidebar';
import MobileNav from '@/components/MobileNav';
import { useMediaQuery, isMobileMQ } from '@/lib/useMediaQuery';
import dynamic from 'next/dynamic';

const Playground = dynamic(() => import('./Playground'), { ssr: false });

const MODES = ['Beginner', 'Exam', 'Interview', 'Revision'];
const LENGTHS = ['Short', 'Medium', 'Deep'];
const modeColors = { Beginner: T.green, Exam: T.accent, Interview: T.amber, Revision: T.purple };

const SUGGESTIONS = [
  { id: 'quiz', label: 'Coding Quiz', Icon: HelpCircle, color: T.accent },
  { id: 'flashcards', label: 'Flashcards', Icon: FlipHorizontal, color: T.purple },
  { id: 'infographic', label: 'Visual Summary', Icon: Image, color: T.amber },
  { id: 'simpler', label: 'Explain Simpler', Icon: AlignLeft, color: T.green },
  { id: 'examples', label: 'Code Examples', Icon: Sparkles, color: T.accent },
];

const FEATURE_SYSTEMS = {
  quiz: QUIZ_SYSTEM, flashcards: FLASHCARD_SYSTEM, infographic: INFOGRAPHIC_SYSTEM,
  simpler: SIMPLER_SYSTEM, examples: EXAMPLES_SYSTEM,
};

const FEATURE_LABELS = {
  quiz: 'Coding Quiz', flashcards: 'Flashcards', infographic: 'Visual Summary',
  simpler: 'Simplified Explanation', examples: 'Code Examples',
};

export default function CodingTutor() {
  const [topic, setTopic] = useState('');
  const [mode, setMode] = useState('Beginner');
  const [length, setLength] = useState('Medium');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [generating, setGenerating] = useState({ msgIdx: null, type: null });
  const [streamingText, setStreamingText] = useState('');
  const streamElRef = useRef(null);
  
  const [isPlaygroundOpen, setIsPlaygroundOpen] = useState(false);
  const [textSessions, setTextSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  
  const chatRef = useRef(null);
  const inputRef = useRef(null);
  
  const textSessKey = 'coding-tutor-sessions';
  const voiceSessKey = 'voice-coding-tutor-sessions';

  const [userId] = useState(() => {
    if (typeof window === 'undefined') return '';
    let id = localStorage.getItem('lms-user-id');
    if (!id) {
      id = 'user-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      localStorage.setItem('lms-user-id', id);
    }
    return id;
  });

  const isMobile = useMediaQuery(isMobileMQ);
  const isTabletOrSmallDesktop = useMediaQuery('(max-width: 1150px)');
  
  const rPad = isMobile ? 14 : 28;
  const rGap = isMobile ? 8 : 12;
  const msgMaxW = '100%';
  const bubbleMaxW = isMobile ? '100%' : 520;
  const fCol = isMobile ? '1fr' : '1fr 1fr';

  function getDateLabel(dateStr) {
    if (!dateStr) return 'Older';
    const date = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    if (date >= today) return 'Today';
    if (date >= yesterday) return 'Yesterday';
    if (date >= weekStart) return 'This Week';
    return 'Older';
  }

  // Load local sessions
  useEffect(() => {
    try {
      const raw = localStorage.getItem(textSessKey);
      if (raw) setTextSessions(JSON.parse(raw));
    } catch {}
  }, []);

  const mergedSessions = useMemo(() => {
    const text = (textSessions || []).map(s => ({ ...s, type: 'text' }));
    text.sort((a, b) => {
      const ta = new Date(a.timestamp || 0).getTime();
      const tb = new Date(b.timestamp || 0).getTime();
      return tb - ta;
    });
    return text;
  }, [textSessions]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, streamingText]);

  const handleSelectSession = useCallback((session) => {
    const msgs = (session.messages || []).map(m => ({
      ...m,
      features: m.features || {},
    }));
    setMessages(msgs);
    setMode(session.mode || 'Beginner');
    setLength(session.length || 'Medium');
    setCurrentSessionId(session.id);
    setErr(''); setTopic('');
  }, []);

  const saveSession = useCallback((msgs, overrideSid) => {
    if (!msgs.some(m => m.role === 'ai')) return;
    const lastUserMsg = [...msgs].reverse().find(m => m.role === 'user');
    const label = lastUserMsg ? lastUserMsg.content.slice(0, 40) : 'Untitled';
    const sid = overrideSid || currentSessionId || Date.now().toString(36);
    const session = {
      id: sid, label, topic: label, mode, length,
      messages: msgs,
      timestamp: new Date().toISOString(),
    };
    const updated = [session, ...textSessions.filter(s => s.id !== sid)];
    setTextSessions(updated);
    setCurrentSessionId(sid);
    try { localStorage.setItem(textSessKey, JSON.stringify(updated)); } catch {}
  }, [mode, length, textSessions, currentSessionId, textSessKey]);

  // Construct a specialized coding feature system prompt that enforces programming constraints
  const getCodingFeatureSystem = (type) => {
    const baseSystem = FEATURE_SYSTEMS[type] || TUTOR_SYSTEM;
    return `${baseSystem}\n\nCRITICAL RESTRICTION: You are Vyomanta's coding and programming tutor. You must ONLY answer questions, generate quizzes, flashcards, or infographics related to computer science, programming languages, algorithms, software engineering, and data structures. If the topic requested is not related to coding or computer science, you must return an empty response (or if returning JSON, return an empty array []).`;
  };

  const handleSend = async () => {
    const raw = topic.trim();
    if (!raw) return;
    setTopic(''); setErr('');

    const sid = currentSessionId || Date.now().toString(36);
    if (!currentSessionId) setCurrentSessionId(sid);

    const intent = classifyIntent(raw);
    const userMsg = { id: Date.now().toString(36), role: 'user', content: raw, mode, length };
    const msgsWithUser = [...messages, userMsg];

    if (intent.type === 'greeting') {
      const aiMsg = { id: (Date.now() + 1).toString(36), role: 'ai', content: getGreetingResponse(), local: true, features: {} };
      const next = [...msgsWithUser, aiMsg];
      setMessages(next); saveSession(next, sid);
      return;
    }

    if (intent.type === 'thanks') {
      const aiMsg = { id: (Date.now() + 1).toString(36), role: 'ai', content: getThanksResponse(), local: true, features: {} };
      const next = [...msgsWithUser, aiMsg];
      setMessages(next); saveSession(next, sid);
      return;
    }

    if (intent.type === 'math') {
      const result = evaluateMath(intent.expression);
      const aiMsg = { id: (Date.now() + 1).toString(36), role: 'ai', content: `**${intent.expression}** = ${result}`, local: true, features: {} };
      const next = [...msgsWithUser, aiMsg];
      setMessages(next); saveSession(next, sid);
      return;
    }

    if (intent.type === 'feature') {
      setMessages(msgsWithUser);
      setLoading(true);
      try {
        const tokens = MAX_TOKENS[length.toLowerCase()] || 2000;
        const prompt = buildFeaturePrompt(intent.feature, intent.topic, mode);
        const system = getCodingFeatureSystem(intent.feature);
        const text = await geminiCall(system, prompt, tokens, { sessionId: sid, userId });
        
        if (!text.trim() || text.trim() === '[]') {
          throw new Error('I can only generate learning materials for coding and programming-related topics. Please try a coding-related request.');
        }
        
        const features = {};
        if (intent.feature === 'quiz') {
          const parsed = parseQuizOutput(text);
          if (parsed.length === 0) throw new Error('I can only generate quizzes on programming-related topics.');
          features.quiz = { questions: parsed, currentIdx: 0, currentAnswer: null };
        } else if (intent.feature === 'flashcards') {
          const parsed = parseFlashcardsOutput(text);
          if (parsed.length === 0) throw new Error('I can only generate flashcards on programming-related topics.');
          features.flashcards = { cards: parsed, currentIdx: 0, flipped: false };
        } else if (intent.feature === 'infographic') {
          const parsed = parseInfographicOutput(text);
          if (parsed.length === 0) throw new Error('I can only generate infographics on programming-related topics.');
          features.infographic = { points: parsed };
        } else if (intent.feature === 'simpler') {
          features.simpler = { text };
        } else if (intent.feature === 'examples') {
          features.examples = { text };
        }
        
        const label = FEATURE_LABELS[intent.feature] || 'response';
        const aiMsg = { id: (Date.now() + 1).toString(36), role: 'ai', content: `Here's a ${label} on ${intent.topic}:`, features };
        const next = [...msgsWithUser, aiMsg];
        setMessages(next); saveSession(next, sid);
      } catch (e) {
        setErr(e.message || 'Error generating feature.');
      } finally {
        setLoading(false);
      }
      return;
    }

    setMessages(msgsWithUser);
    setStreamingText(' ');
    setLoading(true);

    try {
      const tokens = MAX_TOKENS[length.toLowerCase()] || 800;
      const prompt = buildChatPrompt(raw, mode, length);
      const res = await fetch('/api/gemini/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: CODING_TUTOR_SYSTEM, user: prompt, maxOutputTokens: tokens, sessionId: sid, userId }),
      });
      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try { const d = await res.json(); errMsg = d.error || errMsg; } catch {}
        throw new Error(errMsg);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        if (streamElRef.current) {
          streamElRef.current.textContent = fullText;
        }
      }
      if (!fullText.trim()) {
        throw new Error('Gemini returned an empty response. If you asked an off-topic question, please note I can only help with programming-related topics.');
      }
      const aiMsg = { id: (Date.now() + 1).toString(36), role: 'ai', content: fullText, features: {} };
      const next = [...msgsWithUser, aiMsg];
      setMessages(next);
      setStreamingText('');
      saveSession(next, sid);
    } catch (e) {
      setErr(e.message || 'Error generating response.');
      setStreamingText('');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateFeature = async (msgIdx, type) => {
    if (generating.msgIdx === msgIdx && generating.type === type) return;
    const msg = messages[msgIdx];
    if (!msg || msg.role !== 'ai') return;

    setGenerating({ msgIdx, type });
    try {
      const system = getCodingFeatureSystem(type);
      const prompt = buildFeaturePrompt(type, msg.content, mode);
      const tokens = type === 'simpler' || type === 'examples' ? 1000 : 1500;
      const text = await geminiCall(system, prompt, tokens, { sessionId: currentSessionId, userId });
      if (!text.trim() || text.trim() === '[]') throw new Error('Could not generate coding-related feature for this topic.');

      setMessages(prev => prev.map((m, i) => {
        if (i !== msgIdx) return m;
        const f = { ...m.features };
        if (type === 'quiz') f.quiz = { questions: parseQuizOutput(text), currentIdx: 0, currentAnswer: null };
        else if (type === 'flashcards') f.flashcards = { cards: parseFlashcardsOutput(text), currentIdx: 0, flipped: false };
        else if (type === 'infographic') f.infographic = { points: parseInfographicOutput(text) };
        else if (type === 'simpler') f.simpler = { text };
        else if (type === 'examples') f.examples = { text };
        return { ...m, features: f };
      }));
    } catch (e) {
      setErr(`Failed to generate ${type}: ${e.message}`);
    } finally {
      setGenerating({ msgIdx: null, type: null });
    }
  };

  const handleQuizAnswer = (msgIdx, answerIdx) => {
    setMessages(prev => prev.map((m, i) => {
      if (i !== msgIdx || !m.features.quiz) return m;
      if (m.features.quiz.currentAnswer !== null) return m;
      return { ...m, features: { ...m.features, quiz: { ...m.features.quiz, currentAnswer: answerIdx } } };
    }));
  };

  const handleQuizNav = (msgIdx, dir) => {
    setMessages(prev => prev.map((m, i) => {
      if (i !== msgIdx || !m.features.quiz) return m;
      const q = m.features.quiz;
      const max = q.questions.length - 1;
      const next = dir === 'next' ? Math.min(q.currentIdx + 1, max) : Math.max(q.currentIdx - 1, 0);
      return { ...m, features: { ...m.features, quiz: { ...q, currentIdx: next, currentAnswer: null } } };
    }));
  };

  const handleFlashcardFlip = (msgIdx) => {
    setMessages(prev => prev.map((m, i) => {
      if (i !== msgIdx || !m.features.flashcards) return m;
      return { ...m, features: { ...m.features, flashcards: { ...m.features.flashcards, flipped: !m.features.flashcards.flipped } } };
    }));
  };

  const handleFlashcardNav = (msgIdx, dir) => {
    setMessages(prev => prev.map((m, i) => {
      if (i !== msgIdx || !m.features.flashcards) return m;
      const fc = m.features.flashcards;
      const len = fc.cards.length;
      const next = dir === 'next' ? (fc.currentIdx + 1) % len : (fc.currentIdx - 1 + len) % len;
      return { ...m, features: { ...m.features, flashcards: { ...fc, currentIdx: next, flipped: false } } };
    }));
  };

  const isGeneratingFeature = (mi, type) => generating.msgIdx === mi && generating.type === type;

  const featureExists = (msg, type) => {
    if (type === 'quiz') return !!msg.features?.quiz;
    if (type === 'flashcards') return !!msg.features?.flashcards;
    if (type === 'infographic') return !!msg.features?.infographic;
    if (type === 'simpler') return !!msg.features?.simpler;
    if (type === 'examples') return !!msg.features?.examples;
    return false;
  };

  const tutorNavItems = [
    { href: '/',              Icon: Home,      label: 'Dashboard'     },
    { href: '/courses',       Icon: BookOpen,  label: 'Courses'       },
    { href: '/coding-tutor',  Icon: Code2,     label: 'Coding Tutor'  },
    { href: '/progress',      Icon: BarChart3, label: 'Progress'      },
  ];

  const tutorExtras = (close) => {
    const items = [];

    // Mode select
    items.push(
      <div key="mode-select">
        <label style={{ fontSize: 11, color: T.muted, fontWeight: 600, letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>LEARNING MODE</label>
        <select value={mode} onChange={e => setMode(e.target.value)}
          style={{ width: '100%', appearance: 'none', background: T.s2, border: `1px solid ${modeColors[mode] + '50' || T.border}`, borderRadius: 8, padding: '8px 12px', color: modeColors[mode] || T.text, fontSize: 13, fontWeight: 600, cursor: 'pointer', outline: 'none', fontFamily: 'inherit' }}>
          {MODES.map(m => <option key={m} value={m} style={{ background: T.s1, color: T.text }}>{m}</option>)}
        </select>
      </div>
    );

    // Length select
    items.push(
      <div key="len-select">
        <label style={{ fontSize: 11, color: T.muted, fontWeight: 600, letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>RESPONSE DEPTH</label>
        <select value={length} onChange={e => setLength(e.target.value)}
          style={{ width: '100%', appearance: 'none', background: T.s2, border: `1px solid ${length === 'Short' ? T.amber + '50' : length === 'Medium' ? T.accent + '50' : T.purple + '50'}`, borderRadius: 8, padding: '8px 12px', color: length === 'Short' ? T.amber : length === 'Medium' ? T.accent : T.purple, fontSize: 13, fontWeight: 600, cursor: 'pointer', outline: 'none', fontFamily: 'inherit' }}>
          {LENGTHS.map(l => <option key={l} value={l} style={{ background: T.s1, color: T.text }}>{l}</option>)}
        </select>
      </div>
    );

    // Session history
    if (isMobile && mergedSessions?.length > 0) {
      const groups = {};
      const ordered = ['Today', 'Yesterday', 'This Week', 'Older'];
      for (const s of mergedSessions) {
        const label = getDateLabel(s.timestamp);
        if (!groups[label]) groups[label] = [];
        groups[label].push(s);
      }
      for (const key of Object.keys(groups)) {
        groups[key].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      }

      items.push(
        <div key="sessions">
          <div style={{ fontSize: 11, color: T.muted, fontWeight: 600, letterSpacing: '0.06em', marginBottom: 8 }}>SESSION HISTORY</div>
          {ordered.map(group => {
            const sList = groups[group];
            if (!sList) return null;
            return (
              <div key={group} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: T.dim, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '0 4px', marginBottom: 4 }}>{group}</div>
                {sList.map(session => {
                  const isActive = session.id === currentSessionId;
                  return (
                    <button key={'coding-' + session.id}
                      onClick={() => {
                        const msgs = (session.messages || []).map(m => ({ ...m, features: m.features || {} }));
                        setMessages(msgs);
                        setMode(session.mode || 'Beginner');
                        setLength(session.length || 'Medium');
                        setCurrentSessionId(session.id);
                        setErr(''); setTopic('');
                        if (close) close();
                      }}
                      style={{
                        width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: 'none',
                        background: isActive ? `${T.amber}15` : 'transparent',
                        color: isActive ? T.text : T.muted, cursor: 'pointer', fontSize: 12,
                        display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'inherit',
                      }}>
                      <span style={{
                        width: 20, height: 20, borderRadius: 6,
                        background: `${T.amber}20`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                      }}>
                        <Code2 size={11} color={T.amber} />
                      </span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isActive ? 600 : 400, flex: 1 }}>
                        {session.label || 'Untitled'}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      );
    }

    return items;
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const showSplitLayout = isPlaygroundOpen && !isMobile && !isTabletOrSmallDesktop;
  const showVerticalSplit = isPlaygroundOpen && (isMobile || isTabletOrSmallDesktop);

  return (
    <>
      <MobileNav title="Coding Tutor" accent={T.amber} items={tutorNavItems} extras={tutorExtras} />
      <div style={{ display: 'flex', height: '100vh', background: T.bg, overflow: 'hidden' }}>
        {!isMobile && (
          <UnifiedSidebar
            sessions={mergedSessions}
            onSelectSession={handleSelectSession}
            currentSessionId={currentSessionId}
            showMenuButton={false}
          />
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: showVerticalSplit ? 'column' : 'row', overflow: 'hidden' }}>
          
          {/* Chat Container */}
          <div style={{
            flex: showSplitLayout ? 0.55 : (showVerticalSplit ? '0 0 50%' : 1),
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderRight: showSplitLayout ? `1px solid ${T.border}` : 'none',
            borderBottom: showVerticalSplit ? `1px solid ${T.border}` : 'none',
            background: T.bg
          }}>
            {/* ── HEADER ── */}
            <div style={{ padding: isMobile ? '10px 14px' : '14px 28px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, background: T.s1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: rGap }}>
                <div style={{ width: isMobile ? 32 : 38, height: isMobile ? 32 : 38, borderRadius: 10, background: `${T.amber}18`, border: `1px solid ${T.amber}35`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Code2 size={isMobile ? 15 : 18} color={T.amber} />
                </div>
                <div>
                  <h2 style={{ color: T.text, fontSize: isMobile ? 15 : 18, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Coding Tutor</h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: T.green, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: T.muted, fontWeight: 500 }}>Programming AI Agent</span>
                    <Lock size={10} color={T.dim} />
                  </div>
                </div>
              </div>

              {/* Action Button for Sandbox */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={() => setIsPlaygroundOpen(!isPlaygroundOpen)}
                  style={{
                    background: isPlaygroundOpen ? `${T.accent}15` : 'transparent',
                    border: `1px solid ${isPlaygroundOpen ? T.accent : T.border}`,
                    color: isPlaygroundOpen ? T.accent : T.text,
                    padding: '6px 14px',
                    borderRadius: 8,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    transition: 'all 0.15s',
                    fontFamily: 'inherit'
                  }}
                  title={isPlaygroundOpen ? "Hide Python Sandbox" : "Open Python Sandbox"}
                >
                  <Zap size={13} fill={isPlaygroundOpen ? T.accent : 'none'} />
                  {isPlaygroundOpen ? 'Close Sandbox' : 'Open Sandbox'}
                </button>
                {isMobile && streamingText && (
                  <Loader2 size={14} color={T.accent} style={{ animation: 'spin 1s linear infinite' }} />
                )}
              </div>
            </div>

            {/* ── CHAT MESSAGES AREA ── */}
            <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px 14px 10px' : '28px 28px 16px' }}>
              {/* Welcome AI Message */}
              <div style={{ display: 'flex', gap: rGap, marginBottom: 24, maxWidth: msgMaxW }}>
                <div style={{ width: isMobile ? 30 : 36, height: isMobile ? 30 : 36, borderRadius: '50%', background: `${T.amber}25`, border: `1px solid ${T.amber}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Code2 size={isMobile ? 14 : 16} color={T.amber} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: T.amber, fontWeight: 700, letterSpacing: '0.05em', marginBottom: 4 }}>CODING TUTOR</div>
                  <div style={{ color: T.text, fontSize: 14, lineHeight: 1.7 }}>
                    Hello! I'm your Vyomanta programming assistant, restricted strictly to coding and software engineering topics. Ask me any coding questions, or request programming quizzes, flashcards, and examples.
                  </div>
                </div>
              </div>

              {/* Chat Thread */}
              {messages.map((msg, mi) => (
                <div key={msg.id || mi} style={{ marginBottom: 20 }}>
                  {/* User Bubble */}
                  {msg.role === 'user' && (
                    <div style={{ display: 'flex', gap: rGap, justifyContent: 'flex-end', maxWidth: msgMaxW, marginLeft: 'auto' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 11, color: T.muted, fontWeight: 600, letterSpacing: '0.04em', marginBottom: 4 }}>YOU</div>
                        <div style={{ background: T.s3, border: `1px solid ${T.border}`, borderRadius: '14px 14px 4px 14px', padding: '10px 14px', color: T.text, fontSize: 14, lineHeight: 1.65, maxWidth: bubbleMaxW }}>
                          {msg.content}
                        </div>
                        <div style={{ fontSize: 10, color: T.dim, marginTop: 4 }}>{msg.mode} &middot; {msg.length}</div>
                      </div>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: T.s3, border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13, color: T.muted, fontWeight: 700 }}>S</div>
                    </div>
                  )}

                  {/* AI Bubble */}
                  {msg.role === 'ai' && (
                    <div style={{ display: 'flex', gap: rGap, maxWidth: msgMaxW }}>
                      <div style={{ width: isMobile ? 30 : 36, height: isMobile ? 30 : 36, borderRadius: '50%', background: `${T.amber}25`, border: `1px solid ${T.amber}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Code2 size={isMobile ? 14 : 16} color={T.amber} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: T.amber, fontWeight: 700, letterSpacing: '0.05em', marginBottom: 4 }}>CODING TUTOR</div>
                        <div style={{ color: T.text, fontSize: 14, lineHeight: 1.7 }}>
                          <div className="md-content">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                          </div>
                        </div>

                        {/* On-Demand Feature Outputs */}
                        {msg.features?.quiz?.questions?.length > 0 && (
                          <div style={{ marginTop: 16, background: T.s1, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20 }}>
                            {(() => {
                              const q = msg.features.quiz;
                              const question = q.questions[q.currentIdx];
                              if (!question) return null;
                              return (
                                <>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                                    <span style={{ fontSize: 12, color: T.muted }}>Question {q.currentIdx + 1} of {q.questions.length}</span>
                                    <button onClick={() => handleGenerateFeature(mi, 'quiz')}
                                      style={{ background: 'none', border: `1px solid ${T.border}`, color: T.muted, borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>
                                      Regenerate
                                    </button>
                                  </div>
                                  <div style={{ color: T.text, fontSize: 14, fontWeight: 600, marginBottom: 14, lineHeight: 1.5 }}>{question.question}</div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                                    {question.options.map((opt, oi) => {
                                      const answered = q.currentAnswer !== null;
                                      const selected = q.currentAnswer === oi;
                                      const correct = oi === question.correct;
                                      let bg = T.s3, bd = T.border, cl = T.muted;
                                      if (answered && correct) { bg = `${T.green}18`; bd = `${T.green}50`; cl = T.green; }
                                      else if (answered && selected) { bg = `${T.red}18`; bd = `${T.red}50`; cl = T.red; }
                                      else if (selected) { bg = `${T.accent}18`; bd = `${T.accent}50`; cl = T.accent; }
                                      return (
                                        <button key={oi} onClick={() => handleQuizAnswer(mi, oi)} disabled={answered}
                                          style={{ background: bg, border: `1px solid ${bd}`, borderRadius: 9, padding: '10px 14px', color: cl, fontSize: 13, cursor: answered ? 'default' : 'pointer', textAlign: 'left', transition: 'all 0.15s' }}>
                                          <span style={{ fontWeight: 700, marginRight: 8 }}>{'ABCD'[oi]})</span>{opt}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  {q.currentAnswer !== null && (
                                    <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <span style={{ fontSize: 13, color: q.currentAnswer === question.correct ? T.green : T.red, fontWeight: 600 }}>
                                        {q.currentAnswer === question.correct ? '✓ Correct!' : `✗ Incorrect — correct: ${'ABCD'[question.correct]}`}
                                      </span>
                                      <div style={{ display: 'flex', gap: 8 }}>
                                        {q.currentIdx > 0 && (
                                          <button onClick={() => handleQuizNav(mi, 'prev')}
                                            style={{ background: T.s3, border: `1px solid ${T.border}`, color: T.muted, borderRadius: 7, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>
                                            ← Prev
                                          </button>
                                        )}
                                        {q.currentIdx < q.questions.length - 1 && (
                                          <button onClick={() => handleQuizNav(mi, 'next')}
                                            style={{ background: T.accent, color: '#fff', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                                            Next <ChevronRight size={12} />
                                          </button>
                                        )}
                                        {q.currentIdx === q.questions.length - 1 && (
                                          <span style={{ fontSize: 12, color: T.muted }}>Quiz complete!</span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        )}

                        {msg.features?.flashcards?.cards?.length > 0 && (
                          <div style={{ marginTop: 16, background: T.s1, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20 }}>
                            {(() => {
                              const fc = msg.features.flashcards;
                              const card = fc.cards[fc.currentIdx];
                              if (!card) return null;
                              return (
                                <>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                                    <span style={{ fontSize: 12, color: T.muted }}>Card {fc.currentIdx + 1} of {fc.cards.length}</span>
                                    <button onClick={() => handleGenerateFeature(mi, 'flashcards')}
                                      style={{ background: 'none', border: `1px solid ${T.border}`, color: T.muted, borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>
                                      Regenerate
                                    </button>
                                  </div>
                                  <div onClick={() => handleFlashcardFlip(mi)} style={{ cursor: 'pointer' }}>
                                    <div style={{ background: fc.flipped ? `${T.amber}15` : T.s3, border: `1px solid ${fc.flipped ? T.amber + '40' : T.border}`, borderRadius: 14, padding: '32px 24px', minHeight: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', transition: 'all 0.3s' }}>
                                      <div style={{ fontSize: 11, color: T.muted, letterSpacing: '0.08em', marginBottom: 10, textTransform: 'uppercase' }}>
                                        {fc.flipped ? 'Answer' : 'Question — tap to reveal'}
                                      </div>
                                      <div style={{ fontSize: 15, color: T.text, fontWeight: fc.flipped ? 400 : 600, lineHeight: 1.6 }}>
                                        {fc.flipped ? card.back : card.front}
                                      </div>
                                      {!fc.flipped && <div style={{ marginTop: 12, fontSize: 11, color: T.dim }}>tap to flip</div>}
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 12 }}>
                                    <button onClick={() => handleFlashcardNav(mi, 'prev')}
                                      style={{ background: T.s3, border: `1px solid ${T.border}`, color: T.muted, borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontSize: 13 }}>
                                      ← Prev
                                    </button>
                                    <button onClick={() => handleFlashcardNav(mi, 'next')}
                                      style={{ background: T.s3, border: `1px solid ${T.border}`, color: T.muted, borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontSize: 13 }}>
                                      Next →
                                    </button>
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'center', gap: 5, marginTop: 8 }}>
                                    {fc.cards.map((_, i) => (
                                      <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: fc.currentIdx === i ? T.amber : T.dim, transition: 'all 0.2s' }} />
                                    ))}
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        )}

                        {msg.features?.infographic?.points?.length > 0 && (
                          <div style={{ marginTop: 16, background: T.s1, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                              <span style={{ fontSize: 12, color: T.muted }}>Concept Breakdown</span>
                              <button onClick={() => handleGenerateFeature(mi, 'infographic')}
                                style={{ background: 'none', border: `1px solid ${T.border}`, color: T.muted, borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>
                                Regenerate
                              </button>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: fCol, gap: 10 }}>
                              {msg.features.infographic.points.map((pt, i) => {
                                const colors = [T.accent, T.green, T.purple, T.amber, T.red];
                                const icons = ['🎯', '📌', '⚡', '🔑', '🌟', '💎', '🧩', '🚀'];
                                const c = colors[i % colors.length];
                                return (
                                  <div key={i} style={{ background: T.s3, border: `1px solid ${c}25`, borderRadius: 10, padding: '14px', position: 'relative', overflow: 'hidden' }}>
                                    <div style={{ position: 'absolute', top: -10, right: -10, width: 50, height: 50, borderRadius: '50%', background: `${c}08` }} />
                                    <div style={{ fontSize: 20, marginBottom: 6 }}>{icons[i % icons.length]}</div>
                                    <div style={{ color: T.text, fontSize: 13, lineHeight: 1.5, fontWeight: 500 }}>{pt}</div>
                                    <div style={{ position: 'absolute', bottom: 0, left: 0, height: 2, width: '100%', background: `linear-gradient(90deg,${c},transparent)` }} />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {msg.features?.simpler?.text && (
                          <div style={{ marginTop: 12, background: `${T.green}10`, border: `1px solid ${T.green}30`, borderRadius: 10, padding: '14px 18px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <span style={{ fontSize: 11, color: T.green, fontWeight: 700, letterSpacing: '0.05em' }}>SIMPLIFIED EXPLANATION</span>
                              <button onClick={() => handleGenerateFeature(mi, 'simpler')}
                                style={{ background: 'none', border: `1px solid ${T.green}40`, color: T.green, borderRadius: 6, padding: '2px 10px', fontSize: 11, cursor: 'pointer' }}>
                                Regenerate
                              </button>
                            </div>
                            <div style={{ color: T.text, fontSize: 14, lineHeight: 1.7 }}>
                              <div className="md-content">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.features.simpler.text}</ReactMarkdown>
                              </div>
                            </div>
                          </div>
                        )}

                        {msg.features?.examples?.text && (
                          <div style={{ marginTop: 12, background: `${T.accent}10`, border: `1px solid ${T.accent}30`, borderRadius: 10, padding: '14px 18px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <span style={{ fontSize: 11, color: T.accent, fontWeight: 700, letterSpacing: '0.05em' }}>CODE EXAMPLES</span>
                              <button onClick={() => handleGenerateFeature(mi, 'examples')}
                                style={{ background: 'none', border: `1px solid ${T.accent}40`, color: T.accent, borderRadius: 6, padding: '2px 10px', fontSize: 11, cursor: 'pointer' }}>
                                Regenerate
                              </button>
                            </div>
                            <div style={{ color: T.text, fontSize: 14, lineHeight: 1.7 }}>
                              <div className="md-content">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.features.examples.text}</ReactMarkdown>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Suggestion Chips */}
                        {!msg.local && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                            {SUGGESTIONS.filter(s => !featureExists(msg, s.id)).map(s => {
                              const loading = isGeneratingFeature(mi, s.id);
                              return (
                                <button key={s.id} onClick={() => handleGenerateFeature(mi, s.id)} disabled={loading}
                                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 16, background: `${s.color}12`, border: `1px solid ${s.color}40`, color: s.color, fontSize: 11, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', transition: 'all 0.15s' }}>
                                  {loading ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <s.Icon size={12} />}
                                  {loading ? 'Generating...' : s.label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Streaming Area */}
              {streamingText && (
                <div style={{ display: 'flex', gap: rGap, marginBottom: 20, maxWidth: msgMaxW }}>
                  <div style={{ width: isMobile ? 30 : 36, height: isMobile ? 30 : 36, borderRadius: '50%', background: `${T.amber}25`, border: `1px solid ${T.amber}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Code2 size={isMobile ? 14 : 16} color={T.amber} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: T.amber, fontWeight: 700, letterSpacing: '0.05em', marginBottom: 4 }}>CODING TUTOR</div>
                    <div ref={streamElRef} style={{ color: T.text, fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} />
                    <Loader2 size={12} color={T.accent} style={{ animation: 'spin 1s linear infinite', marginTop: 6 }} />
                  </div>
                </div>
              )}

              {/* Generating Loader */}
              {loading && !streamingText && (
                <div style={{ display: 'flex', gap: rGap, marginBottom: 20, maxWidth: msgMaxW }}>
                  <div style={{ width: isMobile ? 30 : 36, height: isMobile ? 30 : 36, borderRadius: '50%', background: `${T.amber}25`, border: `1px solid ${T.amber}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Code2 size={isMobile ? 14 : 16} color={T.amber} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Loader2 size={16} color={T.accent} style={{ animation: 'spin 1s linear infinite' }} />
                    <span style={{ fontSize: 13, color: T.muted }}>Thinking...</span>
                  </div>
                </div>
              )}

              {/* Errors Display */}
              {err && (
                <div style={{ maxWidth: 720, marginBottom: 16, color: T.red, fontSize: 12, background: `${T.red}12`, padding: '10px 14px', borderRadius: 8, border: `1px solid ${T.red}30` }}>
                  {err}
                </div>
              )}
            </div>

            {/* ── FOOTER: Mode/Depth selection + Text Input ── */}
            <div style={{ flexShrink: 0, borderTop: `1px solid ${T.border}`, background: T.s1, padding: isMobile ? '10px 14px 14px' : '14px 28px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 14, marginBottom: 10, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, color: T.muted, fontWeight: 600, letterSpacing: '0.06em' }}>LEARNING MODE</label>
                  <div style={{ position: 'relative' }}>
                    <select value={mode} onChange={e => setMode(e.target.value)}
                      style={{ appearance: 'none', background: T.s2, border: `1px solid ${modeColors[mode] + '50' || T.border}`, borderRadius: 8, padding: '7px 34px 7px 12px', color: modeColors[mode] || T.text, fontSize: 12, fontWeight: 600, cursor: 'pointer', outline: 'none', minWidth: 130, fontFamily: 'inherit' }}>
                      {MODES.map(m => <option key={m} value={m} style={{ background: T.s1, color: T.text }}>{m}</option>)}
                    </select>
                    <ChevronRight size={13} color={modeColors[mode] || T.muted} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%) rotate(90deg)', pointerEvents: 'none' }} />
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, color: T.muted, fontWeight: 600, letterSpacing: '0.06em' }}>RESPONSE DEPTH</label>
                  <div style={{ position: 'relative' }}>
                    <select value={length} onChange={e => setLength(e.target.value)}
                      style={{ appearance: 'none', background: T.s2, border: `1px solid ${length === 'Short' ? T.amber + '50' : length === 'Medium' ? T.accent + '50' : T.purple + '50'}`, borderRadius: 8, padding: '7px 34px 7px 12px', color: length === 'Short' ? T.amber : length === 'Medium' ? T.accent : T.purple, fontSize: 12, fontWeight: 600, cursor: 'pointer', outline: 'none', minWidth: 130, fontFamily: 'inherit' }}>
                      {LENGTHS.map(l => <option key={l} value={l} style={{ background: T.s1, color: T.text }}>{l}</option>)}
                    </select>
                    <ChevronRight size={13} color={length === 'Short' ? T.amber : length === 'Medium' ? T.accent : T.purple} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%) rotate(90deg)', pointerEvents: 'none' }} />
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 6, marginLeft: isMobile ? 0 : 'auto', padding: '6px 14px', background: T.s2, border: `1px solid ${T.border}`, borderRadius: 20 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: T.green, flexShrink: 0 }} />
                  <span style={{ fontSize: isMobile ? 10 : 11, color: T.muted, fontWeight: 600 }}>{mode.toUpperCase()} &middot; {length.toUpperCase()}</span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 8, background: T.s2, border: `1px solid ${T.border}`, borderRadius: 12, padding: '10px 14px' }}>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, padding: '2px', display: 'flex', alignItems: 'center' }}>
                    <Paperclip size={16} />
                  </button>
                  <textarea ref={inputRef} value={topic} onChange={e => setTopic(e.target.value)}
                    placeholder="Ask Coding Tutor (restricted to programming topics)..." rows={1}
                    onKeyDown={handleKeyDown}
                    style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: T.text, fontSize: 14, lineHeight: 1.6, resize: 'none', fontFamily: 'inherit', padding: 0, minHeight: 22, maxHeight: 120 }} />
                </div>
                <button onClick={handleSend} disabled={loading}
                  style={{ width: 44, height: 44, borderRadius: 10, background: loading ? T.dim : T.amber, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {loading ? <Loader2 size={18} color="#fff" style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={18} color="#fff" />}
                </button>
              </div>
            </div>
          </div>

          {/* Sandbox Playground (Desktop side-by-side) */}
          {showSplitLayout && (
            <div style={{ flex: 0.45, height: '100%', background: '#090A0F', overflow: 'hidden' }}>
              <Playground initialCode={`# Python Coding Sandbox\n# Write python code here and run it!\n\ndef greet(name):\n    print(f"Hello, {name}!")\n\ngreet("Seshu")\n`} />
            </div>
          )}

          {/* Sandbox Playground (Tablet / Mobile vertical stack) */}
          {showVerticalSplit && (
            <div style={{ flex: '0 0 50%', height: '50%', background: '#090A0F', borderTop: `1px solid ${T.border}`, overflow: 'hidden' }}>
              <Playground initialCode={`# Python Coding Sandbox\n# Write python code here and run it!\n\ndef greet(name):\n    print(f"Hello, {name}!")\n\ngreet("Seshu")\n`} />
            </div>
          )}

        </div>
      </div>

      <style>{`
        .md-content p { margin: 0 0 0.6em 0; }
        .md-content p:last-child { margin: 0; }
        .md-content ul, .md-content ol { margin: 0.4em 0; padding-left: 1.5em; }
        .md-content li { margin: 0.2em 0; }
        .md-content strong { color: #DDE3F2; font-weight: 700; }
        .md-content em { color: #F5A95B; font-style: italic; }
        .md-content code { background: #182033; padding: 1px 5px; border-radius: 4px; font-size: 13px; color: #F5A95B; }
        .md-content pre { background: #0C0F1C; padding: 12px; border-radius: 8px; overflow-x: auto; margin: 0.6em 0; border: 1px solid rgba(255,255,255,0.07); }
        .md-content pre code { background: none; padding: 0; color: #DDE3F2; }
        .md-content table { border-collapse: collapse; margin: 0.6em 0; }
        .md-content th, .md-content td { border: 1px solid rgba(255,255,255,0.12); padding: 6px 10px; text-align: left; font-size: 13px; }
        .md-content th { background: #111827; color: #F5A95B; font-weight: 600; }
        .md-content a { color: #5B8CF8; text-decoration: underline; }
        .md-content blockquote { border-left: 3px solid #5B8CF8; margin: 0.6em 0; padding: 4px 12px; color: #647298; background: rgba(91,140,248,0.06); border-radius: 0 8px 8px 0; }
      `}</style>
    </>
  );
}
