import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

// ── Fases do treino ──────────────────────────────────────────────────────────
const PHASE = {
  IDLE: 'IDLE',
  WARMUP: 'WARMUP',
  WORK: 'WORK',
  REST: 'REST',
  COOLDOWN: 'COOLDOWN',
  DONE: 'DONE',
};

const PHASE_LABELS = {
  IDLE: '',
  WARMUP: 'AQUECIMENTO',
  WORK: 'MÁXIMO',
  REST: 'DESCANSO',
  COOLDOWN: 'RETORNO À CALMA',
  DONE: 'CONCLUÍDO',
};

const PHASE_COLORS = {
  IDLE: '#e8e0d4',
  WARMUP: '#f5a623',
  WORK: '#ff2d2d',
  REST: '#00c6a2',
  COOLDOWN: '#4a90d9',
  DONE: '#8bc34a',
};

// ── Defaults & Presets ────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  intervals: 8,
  workTime: 60,
  restTime: 60,
  warmupTime: 120,
  cooldownTime: 120,
};

const PRESETS = [
  { name: 'GIBALA', intervals: 8, workTime: 60, restTime: 75, warmupTime: 180, cooldownTime: 180 },
  { name: 'TABATA', intervals: 8, workTime: 20, restTime: 10, warmupTime: 120, cooldownTime: 120 },
  { name: 'SPRINT', intervals: 6, workTime: 30, restTime: 90, warmupTime: 300, cooldownTime: 300 },
];

const STORAGE_KEY = 'gibala-config';

function loadConfig() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveConfig(config) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch {}
}

// ── Utilitários ───────────────────────────────────────────────────────────────
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}:${String(s).padStart(2, '0')}`;
  return String(s);
}

// ── Áudio (Web Audio API) ─────────────────────────────────────────────────────
function createAudioContext() {
  try {
    return new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    return null;
  }
}

function playBeep(ctx, frequency, duration, volume = 0.4, type = 'sine') {
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch {}
}

function playPhaseSound(ctx, phase) {
  if (!ctx) return;
  const sounds = {
    [PHASE.WORK]:     () => { playBeep(ctx, 880, 0.15, 0.5); setTimeout(() => playBeep(ctx, 1100, 0.25, 0.5), 160); },
    [PHASE.REST]:     () => { playBeep(ctx, 660, 0.15, 0.4); setTimeout(() => playBeep(ctx, 440, 0.3, 0.4), 160); },
    [PHASE.WARMUP]:   () => playBeep(ctx, 660, 0.3, 0.35),
    [PHASE.COOLDOWN]: () => playBeep(ctx, 550, 0.3, 0.35),
    [PHASE.DONE]:     () => {
      playBeep(ctx, 523, 0.15, 0.4);
      setTimeout(() => playBeep(ctx, 659, 0.15, 0.4), 160);
      setTimeout(() => playBeep(ctx, 784, 0.3, 0.5), 320);
    },
  };
  sounds[phase]?.();
}

function playCountdownBeep(ctx, n) {
  if (!ctx) return;
  if (n === 1) playBeep(ctx, 1200, 0.12, 0.45, 'square');
  else playBeep(ctx, 800, 0.1, 0.3, 'square');
}

// ── Wake Lock ─────────────────────────────────────────────────────────────────
function useWakeLock(active) {
  const lockRef = useRef(null);

  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let cancelled = false;
    navigator.wakeLock.request('screen').then(lock => {
      if (!cancelled) lockRef.current = lock;
    }).catch(() => {});
    return () => {
      cancelled = true;
      lockRef.current?.release().catch(() => {});
      lockRef.current = null;
    };
  }, [active]);
}

// ── CircleTimer ───────────────────────────────────────────────────────────────
function CircleTimer({ progress, color, size = 340, strokeWidth = 12, children }) {
  const r = (size - strokeWidth * 2) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - progress);

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.4s ease, stroke 0.5s ease' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        {children}
      </div>
    </div>
  );
}

// ── Config Screen ─────────────────────────────────────────────────────────────
function ConfigScreen({ config, onChange, onStart, onPreset }) {
  const fields = [
    { key: 'intervals', label: 'Intervalos', unit: '', min: 1, max: 30, step: 1 },
    { key: 'workTime', label: 'Trabalho', unit: 's', min: 10, max: 120, step: 5 },
    { key: 'restTime', label: 'Descanso', unit: 's', min: 10, max: 120, step: 5 },
    { key: 'warmupTime', label: 'Aquecimento', unit: 's', min: 30, max: 600, step: 30 },
    { key: 'cooldownTime', label: 'Retorno à calma', unit: 's', min: 30, max: 600, step: 30 },
  ];

  return (
    <div className="config-screen">
      <div className="config-header">
        <div className="config-logo">G</div>
        <h1 className="config-title">GIBALA<span>TIMER</span></h1>
        <p className="config-sub">Intervalos de alta intensidade</p>
      </div>

      <div className="preset-row">
        {PRESETS.map(p => (
          <button key={p.name} className="preset-btn" onClick={() => onPreset(p)}>
            {p.name}
          </button>
        ))}
      </div>

      <div className="config-fields">
        {fields.map(({ key, label, unit, min, max, step }) => (
          <div key={key} className="config-row">
            <span className="config-label">{label}</span>
            <div className="config-control">
              <button
                className="adj-btn"
                onClick={() => onChange(key, Math.max(min, config[key] - step))}
              >−</button>
              <span className="config-value">{config[key]}{unit}</span>
              <button
                className="adj-btn"
                onClick={() => onChange(key, Math.min(max, config[key] + step))}
              >+</button>
            </div>
          </div>
        ))}
      </div>

      <div className="config-summary">
        Duração total estimada: <strong>
          {formatTime(config.warmupTime + config.intervals * config.workTime + (config.intervals - 1) * config.restTime + config.cooldownTime)}
        </strong>
      </div>

      <button className="start-btn" onClick={onStart}>INICIAR TREINO</button>
    </div>
  );
}

// ── Timer Screen ──────────────────────────────────────────────────────────────
function TimerScreen({ config, onReset }) {
  const [phase, setPhase] = useState(PHASE.WARMUP);
  const [timeLeft, setTimeLeft] = useState(config.warmupTime);
  const [currentInterval, setCurrentInterval] = useState(0);
  const [running, setRunning] = useState(true);
  const [totalElapsed, setTotalElapsed] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const phaseRef = useRef(phase);
  const intervalNumRef = useRef(currentInterval);
  const audioCtxRef = useRef(null);
  const soundEnabledRef = useRef(soundEnabled);

  phaseRef.current = phase;
  intervalNumRef.current = currentInterval;
  soundEnabledRef.current = soundEnabled;

  useWakeLock(running && phase !== PHASE.DONE);

  // Inicializar áudio na primeira interacção
  useEffect(() => {
    const init = () => {
      if (!audioCtxRef.current) audioCtxRef.current = createAudioContext();
    };
    document.addEventListener('click', init, { once: true });
    document.addEventListener('keydown', init, { once: true });
    return () => {
      document.removeEventListener('click', init);
      document.removeEventListener('keydown', init);
    };
  }, []);

  const totalDuration = config.warmupTime + config.intervals * config.workTime + (config.intervals - 1) * config.restTime + config.cooldownTime;

  const phaseDuration = useCallback(() => {
    switch (phaseRef.current) {
      case PHASE.WARMUP: return config.warmupTime;
      case PHASE.WORK: return config.workTime;
      case PHASE.REST: return config.restTime;
      case PHASE.COOLDOWN: return config.cooldownTime;
      default: return 1;
    }
  }, [config]);

  const advance = useCallback(() => {
    const p = phaseRef.current;
    const n = intervalNumRef.current;
    let nextPhase;

    if (p === PHASE.WARMUP) {
      nextPhase = PHASE.WORK;
      setPhase(PHASE.WORK);
      setCurrentInterval(1);
      setTimeLeft(config.workTime);
    } else if (p === PHASE.WORK) {
      if (n >= config.intervals) {
        nextPhase = PHASE.COOLDOWN;
        setPhase(PHASE.COOLDOWN);
        setTimeLeft(config.cooldownTime);
      } else {
        nextPhase = PHASE.REST;
        setPhase(PHASE.REST);
        setTimeLeft(config.restTime);
      }
    } else if (p === PHASE.REST) {
      nextPhase = PHASE.WORK;
      setPhase(PHASE.WORK);
      setCurrentInterval(n + 1);
      setTimeLeft(config.workTime);
    } else if (p === PHASE.COOLDOWN) {
      nextPhase = PHASE.DONE;
      setPhase(PHASE.DONE);
      setRunning(false);
    }

    if (nextPhase && soundEnabledRef.current) {
      playPhaseSound(audioCtxRef.current, nextPhase);
    }
  }, [config]);

  useEffect(() => {
    if (!running || phase === PHASE.DONE) return;
    const id = setInterval(() => {
      setTimeLeft(t => {
        const next = t - 1;
        if (next <= 0) {
          advance();
          return 0;
        }
        if (next <= 3 && soundEnabledRef.current) {
          playCountdownBeep(audioCtxRef.current, next);
        }
        return next;
      });
      setTotalElapsed(e => e + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [running, phase, advance]);

  // Espaço = pausa/retoma
  useEffect(() => {
    const handler = (e) => {
      if (e.code === 'Space' && phase !== PHASE.DONE) {
        e.preventDefault();
        setRunning(r => !r);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [phase]);

  const progress = phase === PHASE.DONE ? 1 : (phaseDuration() - timeLeft) / phaseDuration();
  const overallProgress = Math.min(totalElapsed / totalDuration, 1);
  const color = PHASE_COLORS[phase];
  const label = PHASE_LABELS[phase];
  const isCountdown = timeLeft <= 3 && timeLeft > 0 && running && phase !== PHASE.DONE;

  return (
    <div className="timer-screen" style={{ '--phase-color': color }}>
      <div className="bg-pulse" style={{ background: color }} />

      <div className="timer-header">
        <span className="timer-logo-small">GIBALA</span>
        <button
          className={`icon-btn ${!soundEnabled ? 'icon-btn-muted' : ''}`}
          onClick={() => setSoundEnabled(s => !s)}
          title={soundEnabled ? 'Silenciar' : 'Activar som'}
        >
          {soundEnabled ? '🔔' : '🔕'}
        </button>
        <button className="icon-btn" onClick={() => setRunning(r => !r)} title={running ? 'Pausar' : 'Retomar'}>
          {running ? '⏸' : '▶'}
        </button>
        <button className="icon-btn" onClick={onReset} title="Terminar">✕</button>
      </div>

      <div className="global-progress-bar">
        <div className="global-progress-fill" style={{ width: `${overallProgress * 100}%`, background: color }} />
      </div>

      <div className="phase-label" style={{ color }}>{label}</div>

      <div className="timer-center">
        <CircleTimer progress={progress} color={color} size={360} strokeWidth={14}>
          {phase === PHASE.DONE ? (
            <span className="timer-done-icon">✓</span>
          ) : (
            <span className={`timer-digits${isCountdown ? ' timer-digits-flash' : ''}`}>
              {formatTime(timeLeft)}
            </span>
          )}
        </CircleTimer>
      </div>

      <div className="interval-counter">
        {phase === PHASE.WORK || phase === PHASE.REST ? (
          <>
            <span className="interval-num">{currentInterval}</span>
            <span className="interval-sep">/</span>
            <span className="interval-total">{config.intervals}</span>
          </>
        ) : phase === PHASE.DONE ? (
          <span className="done-text">TREINO COMPLETO</span>
        ) : (
          <span className="phase-hint">
            {phase === PHASE.WARMUP ? `${config.intervals} intervalos à frente` : ''}
            {phase === PHASE.COOLDOWN ? 'Último esforço feito!' : ''}
          </span>
        )}
      </div>

      {(phase === PHASE.WORK || phase === PHASE.REST || phase === PHASE.DONE) && (
        <div className="dots-row">
          {Array.from({ length: config.intervals }).map((_, i) => {
            const done = i < currentInterval - 1 || phase === PHASE.DONE;
            const active = i === currentInterval - 1 && phase === PHASE.WORK;
            return (
              <div key={i} className={`dot ${done ? 'dot-done' : ''} ${active ? 'dot-active' : ''}`}
                style={{ '--c': color }} />
            );
          })}
        </div>
      )}

      {!running && phase !== PHASE.DONE && (
        <div className="paused-hint">PAUSADO · Espaço para retomar</div>
      )}

      {phase === PHASE.DONE && (
        <button className="start-btn done-btn" onClick={onReset}>NOVO TREINO</button>
      )}
    </div>
  );
}

// ── App Root ──────────────────────────────────────────────────────────────────
export default function App() {
  const [config, setConfig] = useState(loadConfig);
  const [started, setStarted] = useState(false);

  const handleChange = (key, value) => {
    setConfig(c => {
      const next = { ...c, [key]: value };
      saveConfig(next);
      return next;
    });
  };

  const handlePreset = (preset) => {
    const { name: _name, ...values } = preset;
    setConfig(values);
    saveConfig(values);
  };

  return (
    <div className="app-root">
      {!started
        ? <ConfigScreen config={config} onChange={handleChange} onStart={() => setStarted(true)} onPreset={handlePreset} />
        : <TimerScreen key={JSON.stringify(config)} config={config} onReset={() => setStarted(false)} />
      }
    </div>
  );
}
