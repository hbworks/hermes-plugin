import { host, useValue, PANES_AREA, ROUTES_AREA } from '@hermes/plugin-sdk';
import { jsx, jsxs } from 'react/jsx-runtime';
import React, { useState, useEffect, useRef, useMemo } from 'react';

// ============================================================================
// 【第1層】基盤・定義層 (Foundation & Constants)
// ============================================================================

const RESET_BUTTON_DELAY_SEC = 120; // 120秒経過で強制停止・解放ボタンを表示
const LAST_INF_KEY = 'hermes_active_manager_last_inferences_v2';

const loadStoredInferences = () => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_INF_KEY) : null;
    return raw ? JSON.parse(raw) : {};
  } catch (_) { return {}; }
};

const saveStoredInferences = (map) => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LAST_INF_KEY, JSON.stringify(map));
    }
  } catch (_) {}
};

const matchAny = (str, list) => typeof str === 'string' && list.some((k) => str.includes(k));

const formatRelativeTime = (ts) => {
  if (!ts) return 'None';
  let timeMs = ts;
  if (typeof ts === 'string') {
    const clean = ts.trim();
    if (!clean) return 'None';
    const iso = clean.includes('T')
      ? (clean.endsWith('Z') || clean.includes('+') ? clean : clean + 'Z')
      : clean.replace(' ', 'T') + 'Z';
    const parsed = new Date(iso).getTime();
    timeMs = isNaN(parsed) ? new Date(clean).getTime() : parsed;
  } else if (typeof ts === 'number' && ts < 1e11) {
    timeMs = ts * 1000;
  }
  if (!timeMs || isNaN(timeMs)) return 'None';

  const sec = Math.max(1, Math.floor((Date.now() - timeMs) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  return min < 60 ? `${min}m ago` : `${Math.floor(min / 60)}h ago`;
};

const t = {
  incSlot: 'Increase slot limit (+1)',
  decSlot: 'Decrease slot limit (-1)',
  slotUnavailable: 'Desktop internal API unavailable; slot limit is fixed (estimated: 3)',
  resetAllTooltip: 'Stop backend inference and reset state for all busy agents',
  resetSlotBtn: '↺ Reset & Free Slot',
  resetSlotTooltip: (sec) => `Task running for ${sec}s. Click to force stop backend inference and immediately free slot`,
  resetSlotNotif: (p) => `Stopped inference session and released slot for "${p}"`,
  resetSlotPartialWarning: (p, ok, total) => `Partial failure stopping session for "${p}" (${ok}/${total} succeeded)`,
  resetSlotError: (p, msg) => `Failed to stop session for "${p}": ${msg}`,
  resetAllNotif: (count) => `Stopped ${count} busy agent(s)`,
  resetAllPartial: (ok, total) => `Partial failure stopping busy agents (${ok}/${total} stopped)`,
  resetAllFailed: (total) => `Failed to stop all busy agents (${total} agent(s))`,
  apiUnavailable: 'Session stop API is unavailable',
  modalTitle: 'All Agents Are Busy',
  modalDesc1: (max) => `All active slots (${max}) are currently busy with reasoning or tool execution.`,
  modalDesc2: 'Switching now may interrupt ongoing tasks or cause a timeout error while waiting for a free slot.',
  modalRunning: 'Currently running agents:',
  safeSwitchGuardTitle: 'Safe Switch Guard',
  safeSwitchGuardDesc: 'Prevents switch timeout when all slots are busy',
  runningTask: (sec) => `⏳ Running task... (${sec}s)`,
  stuckWarning: (sec) => `⚠️ Long running (${sec}s)`
};

const sendNotification = (message, kind = 'info') => {
  if (typeof host?.notify !== 'function') return;
  try {
    host.notify({ kind, message });
  } catch (_) {}
};

const extractProfile = (ev, p, roster, sMap, focusedProfile, focusedSid) => {
  const sid = ev.sessionId || ev.session_id || ev.session || ev.sid || p?.sessionId || p?.session_id;

  if (sid && sMap[sid]) return sMap[sid];

  if (sid && focusedSid && sid === focusedSid && focusedProfile) {
    sMap[sid] = focusedProfile;
    return focusedProfile;
  }

  const normalize = (value) => {
    const candidate = typeof value === 'string'
      ? value
      : value?.profile || value?.name || value?.id;
    return typeof candidate === 'string' ? candidate.trim().toLowerCase() : '';
  };

  const direct = normalize(
    ev.turn_author || ev.turnAuthor || p?.turn_author || p?.turnAuthor ||
    ev.author || p?.author || ev.sender || p?.sender ||
    ev.agent || ev.bot || ev.speaker || p?.agent || p?.bot || p?.speaker || p?.member || p?.agentName ||
    p?.from
  );
  if (direct) {
    if (sid) sMap[sid] = direct;
    return direct;
  }

  const evProf = normalize(ev.profile || p?.profile);
  if (evProf) {
    if (evProf === 'default' && focusedProfile && focusedProfile !== 'default') {
      if (sid) sMap[sid] = focusedProfile;
      return focusedProfile;
    }
    if (sid) sMap[sid] = evProf;
    return evProf;
  }

  if (focusedProfile) {
    if (sid) sMap[sid] = focusedProfile;
    return focusedProfile;
  }

  return '';
};

// UI スタイル定義（Hermes 公式 CSS 変数 / Design Tokens 準拠）
const S = {
  flexRow: { display: 'flex', alignItems: 'center' },
  flexBetween: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    boxSizing: 'border-box',
    background: 'transparent',
    color: 'var(--ui-text, inherit)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: '12px',
    padding: '12px',
    gap: '12px',
    overflowY: 'auto'
  },
  card: {
    backgroundColor: 'var(--ui-card-bg, rgba(127, 127, 127, 0.05))',
    border: '1px solid var(--ui-border, rgba(127, 127, 127, 0.15))',
    borderRadius: '8px',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    boxShadow: 'var(--ui-shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.04))'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  title: {
    fontSize: '11px',
    fontWeight: '700',
    color: 'var(--ui-muted, #888888)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  statRow: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between'
  },
  statLabel: {
    fontSize: '11px',
    color: 'var(--ui-muted, #888888)'
  },
  statVal: {
    fontSize: '14px',
    fontWeight: '700'
  },
  barContainer: {
    width: '100%',
    height: '6px',
    backgroundColor: 'var(--ui-bar-bg, rgba(127, 127, 127, 0.15))',
    borderRadius: '3px',
    overflow: 'hidden',
    marginTop: '2px'
  },
  barTrack: {
    height: '100%',
    borderRadius: '3px',
    transition: 'width 0.3s ease, background-color 0.3s ease'
  },
  btnGroup: {
    display: 'flex',
    gap: '4px'
  },
  modalBackdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: '20px'
  },
  modal: {
    backgroundColor: 'var(--ui-card-bg, #1e1e24)',
    border: '1px solid var(--ui-border, rgba(127, 127, 127, 0.25))',
    borderRadius: '12px',
    padding: '16px',
    maxWidth: '320px',
    width: '100%',
    boxShadow: 'var(--ui-shadow-lg, 0 10px 25px rgba(0, 0, 0, 0.3))',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  }
};

const Badge = (text, bg, color) => jsx('span', {
  style: {
    fontSize: '9.5px',
    fontWeight: '700',
    padding: '2px 5px',
    borderRadius: '4px',
    backgroundColor: bg,
    color,
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
    display: 'inline-flex',
    alignItems: 'center'
  },
  children: text
});

const Btn = ({ onClick, disabled = false, variant = 'secondary', style = {}, title, children }) => {
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  return jsx('button', {
    onClick,
    disabled,
    title,
    style: {
      background: isDanger
        ? 'var(--ui-danger, #ef4444)'
        : isPrimary
          ? 'var(--ui-primary, #4f46e5)'
          : 'var(--ui-btn-secondary-bg, rgba(127, 127, 127, 0.12))',
      color: isPrimary || isDanger ? '#ffffff' : 'var(--ui-text, inherit)',
      border: 'none',
      borderRadius: '6px',
      padding: '5px 10px',
      fontSize: '11px',
      fontWeight: '600',
      cursor: disabled ? 'not-allowed' : 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      opacity: disabled ? 0.45 : 1,
      transition: 'opacity 0.2s ease, background-color 0.2s ease',
      ...style
    },
    children
  });
};

// ============================================================================
// 【第2層】ロジック層 (Custom Hooks)
// ============================================================================

/**
 * 1. スロット枠・プール制限フック
 */
function usePoolLimits() {
  const hasDesktopPoolControl = typeof window !== 'undefined' && Boolean(window.hermesDesktop?.setPoolLimits);
  const [poolLimits, setPoolLimits] = useState({ maxBackends: 3, idleMs: 600000 });

  const fetchPoolLimits = async () => {
    if (!hasDesktopPoolControl) return;
    try {
      const limits = await window.hermesDesktop?.getPoolLimits?.();
      if (typeof limits?.maxBackends === 'number') {
        setPoolLimits((prev) => ({
          maxBackends: limits.maxBackends,
          idleMs: typeof limits.idleMs === 'number' ? limits.idleMs : prev.idleMs
        }));
      }
    } catch (err) {
      console.debug('[AgentActiveManager] getPoolLimits error:', err);
    }
  };

  useEffect(() => {
    fetchPoolLimits();
    if (hasDesktopPoolControl) {
      const interval = setInterval(fetchPoolLimits, 4000);
      return () => clearInterval(interval);
    }
  }, [hasDesktopPoolControl]);

  return { poolLimits, setPoolLimits, hasDesktopPoolControl };
}

/**
 * 2. エージェント状態統合フック（Roster, SessionBotMap, Activity, Timers, Watchdog）
 */
function useAgentState({ busyBySession, busyBySessionRef, focusedProfileRef, focusedSidRef, poolLimits }) {
  const [roster, setRoster] = useState([]);
  const [sessionBotMap, setSessionBotMap] = useState({});
  const [agentStatus, setAgentStatus] = useState({});
  const [lastInferenceMap, setLastInferenceMap] = useState(loadStoredInferences);
  const [runningProfiles, setRunningProfiles] = useState(new Set());
  const [now, setNow] = useState(Date.now());

  const rosterRef = useRef([]);
  const sessionBotMapRef = useRef({});
  const agentStatusRef = useRef({});
  const lastActiveRef = useRef({});

  // 推論完了・スタンバイ復帰の共通処理
  const markInferenceFinished = (targetProfile, reason = 'Done') => {
    if (!targetProfile) return;
    const nowTime = Date.now();
    const prev = agentStatusRef.current[targetProfile];
    const duration = prev?.start ? Math.max(1, Math.round((nowTime - prev.start) / 1000)) : null;

    setLastInferenceMap((prevMap) => {
      const nextMap = {
        ...prevMap,
        [targetProfile]: {
          completedAt: new Date(nowTime).toISOString(),
          duration,
          summary: prev?.toolName ? `Tool: ${prev.toolName}` : reason
        }
      };
      saveStoredInferences(nextMap);
      return nextMap;
    });

    setAgentStatus((prev) => {
      const next = { ...prev };
      delete next[targetProfile];
      agentStatusRef.current = next;
      return next;
    });
  };

  // busyBySession から推論開始時刻の未設定プロファイルを補完（起動前の既存タスク等）
  const ensureBusyStartTimes = (sMap = sessionBotMapRef.current) => {
    const current = Date.now();
    let updated = false;
    for (const [sid, isBusySid] of Object.entries(busyBySessionRef.current)) {
      if (!isBusySid) continue;
      const bot = sMap[sid];
      if (bot && !agentStatusRef.current[bot]?.start) {
        agentStatusRef.current[bot] = {
          status: 'generating',
          toolName: '',
          start: current,
          lastActive: current
        };
        updated = true;
      }
    }
    if (updated) {
      setAgentStatus({ ...agentStatusRef.current });
    }
  };

  // プロファイル一覧とランタイムセッション情報の同期
  useEffect(() => {
    let isMounted = true;
    const syncRoster = async () => {
      try {
        if (typeof host?.request !== 'function') return;

        const res = await host.request('profiles.list', {});
        const profiles = Array.isArray(res?.profiles) ? res.profiles : [];
        if (!isMounted) return;

        const order = ['assistant', 'research', 'coding', 'copywriter', 'default'];
        const sorted = [...profiles].sort((a, b) => {
          const ia = order.indexOf(a.name);
          const ib = order.indexOf(b.name);
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        });

        setRoster(sorted);
        rosterRef.current = sorted;

        const mapUpdate = {};

        try {
          const sessRes = await host.request('sessions.list', {}).catch(() => null);
          const activeSessions = Array.isArray(sessRes?.sessions) ? sessRes.sessions : [];
          for (const s of activeSessions) {
            const sId = s.id || s.sessionId || s.session_id;
            const sProf = s.profile || s.profileName || s.agent;
            if (sId && sProf) {
              mapUpdate[sId] = String(sProf).toLowerCase();
            }
          }
        } catch (_) {}

        if (focusedSidRef.current && focusedProfileRef.current) {
          mapUpdate[focusedSidRef.current] = focusedProfileRef.current;
        }

        for (const p of sorted) {
          const cs = p.canonical_session || p.last_session;
          const csId = cs?.resolved_id || cs?.id;
          if (csId && !mapUpdate[csId]) mapUpdate[csId] = p.name;
        }

        sessionBotMapRef.current = { ...sessionBotMapRef.current, ...mapUpdate };
        setSessionBotMap((prev) => ({ ...prev, ...mapUpdate }));
        ensureBusyStartTimes(sessionBotMapRef.current);

        setLastInferenceMap((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const p of sorted) {
            if (!next[p.name]) {
              const cs = p.canonical_session || p.last_session;
              const updatedAt = cs?.updated_at || p.updated_at;
              if (updatedAt) {
                next[p.name] = {
                  completedAt: updatedAt,
                  duration: null,
                  summary: 'History'
                };
                changed = true;
              }
            }
          }
          if (changed) saveStoredInferences(next);
          return changed ? next : prev;
        });
      } catch (err) {
        console.debug('[AgentActiveManager] syncRoster error:', err);
      }
    };

    syncRoster();
    const interval = setInterval(syncRoster, 4000);
    return () => { isMounted = false; clearInterval(interval); };
  }, []);

  // busyBySession または sessionBotMap 更新時の開始時間補完
  useEffect(() => {
    ensureBusyStartTimes();
  }, [busyBySession, sessionBotMap]);

  // Gatewayイベントの監視（推論状態と直前推論履歴）
  useEffect(() => {
    if (typeof host?.onEvent !== 'function') return;
    const unsubscribe = host.onEvent('*', (event) => {
      if (!event) return;
      const eventType = (event.type || event.event || '').toLowerCase();
      const payload = event.payload ?? event.data ?? event.message ?? event;

      if (matchAny(eventType, ['gateway.', 'sessions.', 'profiles.', 'skin.', 'theme.'])) {
        const hasActivity = payload?.text || payload?.content || payload?.delta || payload?.tool || payload?.error;
        if (!hasActivity) return;
      }

      const role = payload?.role || payload?.message?.role || event.role;
      if (role === 'user' || role === 'system') return;

      const rawProfile = extractProfile(
        event,
        payload,
        rosterRef.current,
        sessionBotMapRef.current,
        focusedProfileRef.current,
        focusedSidRef.current
      );

      if (!rawProfile) return;

      const sid = event.sessionId || event.session_id || event.session || event.sid || payload?.sessionId || payload?.session_id;
      if (sid && rawProfile) {
        if (sessionBotMapRef.current[sid] !== rawProfile) {
          sessionBotMapRef.current[sid] = rawProfile;
        }
      }

      const nowTime = Date.now();

      const FINISH_SUFFIXES = ['.finish', '.end', '.complete', '.finished', '.idle', '.done'];
      const isFinished = FINISH_SUFFIXES.some((s) => eventType.endsWith(s)) ||
        Boolean(payload?.finish_reason) ||
        payload?.done === true ||
        payload?.status === 'completed';

      const isToolResult = !isFinished && (matchAny(eventType, ['tool_result', 'tool.result', 'tool_output', 'tool_response']) || Boolean(payload?.tool_result) || role === 'tool');
      const isToolCall = !isFinished && !isToolResult && (matchAny(eventType, ['tool_call', 'tool.start', 'tool_start', 'tool', 'exec', 'action']) || Boolean(payload?.tool || payload?.tool_call || payload?.function));
      const isThinking = !isFinished && !isToolCall && !isToolResult && (matchAny(eventType, ['reason', 'think', 'thought', 'turn.start']) || Boolean(payload?.reasoning || payload?.thought));
      const isDelta = matchAny(eventType, ['delta', 'stream', 'chunk']) || Boolean(payload?.delta);
      const isGenerating = !isFinished && !isToolCall && !isToolResult && !isThinking && (
        isDelta ||
        matchAny(eventType, ['agent.stream', 'generate', 'generation']) ||
        (matchAny(eventType, ['turn.progress']) && Boolean(payload?.text || payload?.content))
      );

      if (isToolResult || isToolCall || isThinking || isGenerating || isFinished) {
        lastActiveRef.current[rawProfile] = nowTime;
        setRunningProfiles((prev) => new Set([...prev, rawProfile]));
      }

      const toolName = (isToolCall || isToolResult)
        ? (payload?.tool?.name || payload?.tool || payload?.name || payload?.function?.name || payload?.action || 'tool')
        : '';

      if (isFinished) {
        markInferenceFinished(rawProfile);
      } else if (isToolResult || isToolCall || isThinking || isGenerating) {
        const nextStatus = {
          status: isToolResult ? 'tool_completed' : isToolCall ? 'tool' : isThinking ? 'thinking' : 'generating',
          toolName: isToolCall || isToolResult ? (toolName || 'tool') : '',
          start: agentStatusRef.current[rawProfile]?.start || nowTime,
          lastActive: nowTime
        };
        agentStatusRef.current[rawProfile] = nextStatus;
        setAgentStatus({ ...agentStatusRef.current });
      }
    });

    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, []);

  // ウォッチドッグタイマー（セッションがbusyである限り状態は破棄しない）
  useEffect(() => {
    const watchdog = setInterval(() => {
      const nowTime = Date.now();
      const currentStatus = { ...agentStatusRef.current };
      let changed = false;

      for (const [name, st] of Object.entries(currentStatus)) {
        if (!st) continue;
        const lastActive = st.lastActive || lastActiveRef.current[name] || 0;
        const idleFor = nowTime - lastActive;

        const isSessionBusy = Object.entries(sessionBotMapRef.current).some(([sid, bot]) => bot === name && busyBySessionRef.current[sid]);

        const toolFinished = !isSessionBusy && st.status === 'tool_completed' && idleFor >= 3000;
        const sessionBecameIdle = !isSessionBusy && idleFor >= 3000;
        const eventTimedOut = !isSessionBusy && idleFor >= 10000;

        if (toolFinished || sessionBecameIdle || eventTimedOut) {
          const duration = st.start ? Math.max(1, Math.round((nowTime - st.start) / 1000)) : null;
          const summary = st.toolName ? `Tool: ${st.toolName}` : 'Done';

          setLastInferenceMap((prevMap) => {
            const nextMap = {
              ...prevMap,
              [name]: {
                completedAt: nowTime,
                duration: duration || 1,
                summary
              }
            };
            saveStoredInferences(nextMap);
            return nextMap;
          });

          delete agentStatusRef.current[name];
          changed = true;
        }
      }

      if (changed) {
        setAgentStatus({ ...agentStatusRef.current });
      }
    }, 1000);

    return () => clearInterval(watchdog);
  }, []);

  // アイドル時間経過によるバックエンド退避の検知
  useEffect(() => {
    const timer = setInterval(() => {
      const nowTime = Date.now();
      const idleThreshold = Math.max(60000, poolLimits.idleMs || 120000);
      setRunningProfiles((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const name of prev) {
          const last = lastActiveRef.current[name] || 0;
          const isBusy = (agentStatusRef.current[name] && agentStatusRef.current[name].status !== 'tool_completed') ||
            Object.entries(sessionBotMapRef.current).some(([sid, bot]) => bot === name && busyBySessionRef.current[sid]);
          if (!isBusy && (nowTime - last) > idleThreshold) {
            next.delete(name);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 5000);

    return () => clearInterval(timer);
  }, [poolLimits.idleMs]);

  const runningList = useMemo(() => Array.from(runningProfiles), [runningProfiles]);
  const busyProfiles = useMemo(() => {
    return runningList.filter((name) => {
      const st = agentStatus[name];
      if (st && st.status !== 'tool_completed') return true;
      return Object.entries(sessionBotMapRef.current).some(([sid, bot]) => bot === name && busyBySession[sid]);
    });
  }, [runningList, agentStatus, busyBySession]);

  const hasBusy = busyProfiles.length > 0;

  // ビジー状態のエージェントが存在する場合、1秒ごとにUIタイマーを更新（120秒スタック検出用）
  useEffect(() => {
    if (!hasBusy) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [hasBusy]);

  return {
    roster,
    sessionBotMap,
    sessionBotMapRef,
    agentStatus,
    agentStatusRef,
    lastInferenceMap,
    runningProfiles,
    runningList,
    busyProfiles,
    now,
    markInferenceFinished
  };
}

/**
 * 3. セッション操作・切り替えフック
 */
function useSessionActions({
  host,
  t,
  poolLimits,
  setPoolLimits,
  hasDesktopPoolControl,
  sessionBotMapRef,
  focusedProfileRef,
  focusedSidRef,
  markInferenceFinished,
  busyProfiles,
  runningCount,
  allRunningAreBusy
}) {
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchFeedback, setSwitchFeedback] = useState(null);
  const [pendingSwitchTarget, setPendingSwitchTarget] = useState(null);
  const pendingRevertMaxRef = useRef(null);

  const maxBackends = poolLimits.maxBackends || 3;

  // フォーカス変更時の一時拡張スロットの自動復元
  useEffect(() => {
    if (focusedProfileRef.current) {
      if (pendingRevertMaxRef.current !== null) {
        const orig = pendingRevertMaxRef.current;
        pendingRevertMaxRef.current = null;
        setTimeout(async () => {
          if (hasDesktopPoolControl && window.hermesDesktop?.setPoolLimits) {
            try {
              await window.hermesDesktop.setPoolLimits({ maxBackends: orig });
              setPoolLimits((prev) => ({ ...prev, maxBackends: orig }));
            } catch (_) {}
          }
        }, 1500);
      }
    }
  }, [focusedProfileRef.current, hasDesktopPoolControl]);

  // 個別推論状態のリセット & スロット強制解放
  const handleResetInference = async (targetProfile, options = { silent: false }) => {
    try {
      const routes = typeof host?.profileRoutes === 'function'
        ? await host.profileRoutes().catch(() => null)
        : null;
      const targetRoute = Array.isArray(routes)
        ? routes.find((r) => r.profile === targetProfile || r.targetProfile === targetProfile)
        : null;
      const routeTarget = targetRoute || targetProfile;
      const targetProfileName = targetRoute?.profile ?? targetProfile;

      const activeSids = Object.entries(sessionBotMapRef.current)
        .filter(([_, bot]) => bot === targetProfile || bot === targetProfileName)
        .map(([sid]) => sid);

      if (focusedProfileRef.current === targetProfile && focusedSidRef.current && !activeSids.includes(focusedSidRef.current)) {
        activeSids.push(focusedSidRef.current);
      }

      const targetSids = activeSids.length > 0 ? activeSids : [null];
      const stopPromises = [];
      for (const sid of targetSids) {
        const stopPayload = {
          profile: targetProfileName,
          abort: true,
          ...(sid ? { sessionId: sid, session_id: sid } : {})
        };
        if (typeof host?.requestProfile === 'function') {
          stopPromises.push(host.requestProfile(routeTarget, 'session.stop', stopPayload));
        } else if (typeof host?.request === 'function') {
          stopPromises.push(host.request('session.stop', stopPayload));
        }
      }

      if (stopPromises.length === 0) {
        if (!options.silent) {
          sendNotification(t.resetSlotError(targetProfile, t.apiUnavailable), 'error');
        }
        return false;
      }

      const results = await Promise.allSettled(stopPromises);
      const rejected = results.filter((r) => r.status === 'rejected');
      if (rejected.length > 0) {
        const firstErr = rejected[0]?.reason;
        const errMsg = firstErr?.message || String(firstErr || 'Failed to stop backend session');
        if (rejected.length === stopPromises.length) {
          if (!options.silent) {
            sendNotification(t.resetSlotError(targetProfile, errMsg), 'error');
          }
        } else {
          const successCount = stopPromises.length - rejected.length;
          if (!options.silent) {
            sendNotification(t.resetSlotPartialWarning(targetProfile, successCount, stopPromises.length), 'warning');
          }
        }
        return false;
      }

      markInferenceFinished(targetProfile, 'Reset');
      if (!options.silent) {
        sendNotification(t.resetSlotNotif(targetProfile), 'success');
      }
      return true;
    } catch (err) {
      console.error('[AgentActiveManager] Reset session error:', err);
      if (!options.silent) {
        sendNotification(t.resetSlotError(targetProfile, err?.message || 'Error stopping session'), 'error');
      }
      return false;
    }
  };

  // 全体リセット（すべてのビジープロファイルの停止を並行実行）
  const handleResetAllBusy = async () => {
    const targets = [...busyProfiles];
    if (targets.length === 0) return;
    try {
      const results = await Promise.allSettled(targets.map((b) => handleResetInference(b, { silent: true })));
      const successCount = results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
      if (successCount === targets.length) {
        sendNotification(t.resetAllNotif(successCount), 'success');
      } else if (successCount > 0) {
        sendNotification(t.resetAllPartial(successCount, targets.length), 'warning');
      } else {
        sendNotification(t.resetAllFailed(targets.length), 'error');
      }
    } catch (err) {
      console.error('[AgentActiveManager] handleResetAllBusy error:', err);
      sendNotification(t.resetAllFailed(targets.length), 'error');
    }
  };

  // プロファイル切り替えの実行
  const performSwitch = async (targetBot, options = { expandSlot: false }) => {
    setIsSwitching(true);
    setSwitchFeedback(`Switching to "${targetBot}"...`);
    const originalMax = maxBackends;

    try {
      if (options.expandSlot && hasDesktopPoolControl && window.hermesDesktop?.setPoolLimits) {
        const newMax = Math.max(maxBackends + 1, runningCount + 1);
        setSwitchFeedback(`Expanding slot (${maxBackends} → ${newMax})...`);
        await window.hermesDesktop.setPoolLimits({ maxBackends: newMax });
        setPoolLimits((prev) => ({ ...prev, maxBackends: newMax }));
        pendingRevertMaxRef.current = originalMax;

        setTimeout(async () => {
          if (pendingRevertMaxRef.current === originalMax) {
            pendingRevertMaxRef.current = null;
            try {
              await window.hermesDesktop?.setPoolLimits?.({ maxBackends: originalMax });
              setPoolLimits((prev) => ({ ...prev, maxBackends: originalMax }));
            } catch (_) {}
          }
        }, 30000);

        await new Promise((r) => setTimeout(r, 100));
      }

      const routes = typeof host?.profileRoutes === 'function'
        ? await host.profileRoutes().catch(() => null)
        : null;
      const targetRoute = Array.isArray(routes)
        ? routes.find((r) => r.profile === targetBot || r.targetProfile === targetBot)
        : null;
      const routeTarget = targetRoute || targetBot;

      if (typeof host?.switchProfile === 'function') {
        await host.switchProfile(routeTarget);
      } else if (typeof host?.openSession === 'function') {
        await host.openSession({ profile: targetRoute?.profile ?? targetBot });
      }

      setSwitchFeedback(`Switched to "${targetBot}"`);
      setTimeout(() => setSwitchFeedback(null), 2500);
    } catch (err) {
      console.error('[AgentActiveManager] Switch error:', err);
      setSwitchFeedback(`Error switching: ${err?.message || 'timeout'}`);
      setTimeout(() => setSwitchFeedback(null), 3500);

      if (pendingRevertMaxRef.current !== null) {
        const orig = pendingRevertMaxRef.current;
        pendingRevertMaxRef.current = null;
        try {
          await window.hermesDesktop?.setPoolLimits?.({ maxBackends: orig });
          setPoolLimits((prev) => ({ ...prev, maxBackends: orig }));
        } catch (_) {}
      }
    } finally {
      setIsSwitching(false);
      setPendingSwitchTarget(null);
    }
  };

  const handleRequestSwitch = (targetBot) => {
    if (allRunningAreBusy) {
      setPendingSwitchTarget(targetBot);
    } else {
      performSwitch(targetBot, { expandSlot: false });
    }
  };

  const handlePoolUpdate = async (type, value) => {
    if (!hasDesktopPoolControl || !window.hermesDesktop?.setPoolLimits) return;
    try {
      const payload = type === 'max' ? { maxBackends: value } : { idleMs: value };
      await window.hermesDesktop.setPoolLimits(payload);
      setPoolLimits((prev) => ({
        ...prev,
        maxBackends: type === 'max' ? value : prev.maxBackends,
        idleMs: type === 'idle' ? value : prev.idleMs
      }));
    } catch (err) {
      console.error('[AgentActiveManager] setPoolLimits error:', err);
    }
  };

  return {
    isSwitching,
    switchFeedback,
    pendingSwitchTarget,
    setPendingSwitchTarget,
    handleResetInference,
    handleResetAllBusy,
    performSwitch,
    handleRequestSwitch,
    handlePoolUpdate
  };
}

// ============================================================================
// 【第3層】UI部品層 (Presentational Components)
// ============================================================================

/**
 * 1. スロット枠・使用状況カード
 */
function SlotCapacityCard({
  poolLimits,
  runningCount,
  maxBackends,
  usagePct,
  isFull,
  allRunningAreBusy,
  hasDesktopPoolControl,
  onUpdatePool,
  switchFeedback,
  t
}) {
  const isDanger = usagePct >= 100;
  const isWarn = usagePct >= 70 && !isDanger;
  const barColor = isDanger
    ? 'var(--ui-danger, #ef4444)'
    : isWarn
      ? 'var(--ui-warning, #f59e0b)'
      : 'var(--ui-primary, #4f46e5)';

  return jsxs('div', {
    style: S.card,
    children: [
      jsxs('div', {
        style: S.header,
        children: [
          jsxs('div', {
            style: S.title,
            children: [
              jsx('span', { children: '⚡' }),
              jsx('span', { children: 'ACTIVE BACKEND SLOTS' }),
              allRunningAreBusy && Badge('ALL BUSY', 'var(--ui-badge-danger-bg, rgba(239, 68, 68, 0.15))', 'var(--ui-danger, #ef4444)')
            ]
          }),
          jsxs('div', {
            style: S.btnGroup,
            children: [
              Btn({
                disabled: !hasDesktopPoolControl || maxBackends <= 1,
                onClick: () => onUpdatePool('max', maxBackends - 1),
                style: { padding: '2px 7px', fontSize: '11px' },
                title: hasDesktopPoolControl ? t.decSlot : t.slotUnavailable,
                children: '-1'
              }),
              Btn({
                disabled: !hasDesktopPoolControl || maxBackends >= 10,
                onClick: () => onUpdatePool('max', maxBackends + 1),
                style: { padding: '2px 7px', fontSize: '11px' },
                title: hasDesktopPoolControl ? t.incSlot : t.slotUnavailable,
                children: '+1 Slot'
              })
            ]
          })
        ]
      }),
      jsxs('div', {
        style: S.statRow,
        children: [
          jsxs('div', {
            style: { display: 'flex', alignItems: 'baseline', gap: '6px' },
            children: [
              jsx('span', { style: { ...S.statVal, color: barColor }, children: `${runningCount} / ${maxBackends}` }),
              jsx('span', { style: S.statLabel, children: 'Active' })
            ]
          }),
          jsx('span', {
            style: { fontSize: '11px', color: 'var(--ui-muted, #888888)' },
            children: isFull ? (allRunningAreBusy ? '0 Free (All Busy)' : '0 Free (LRU Evictable)') : `${maxBackends - runningCount} Free Slots`
          })
        ]
      }),
      jsx('div', {
        style: S.barContainer,
        children: jsx('div', {
          style: {
            ...S.barTrack,
            width: `${Math.min(100, usagePct)}%`,
            backgroundColor: barColor
          }
        })
      }),
      jsxs('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' },
        children: [
          jsx('span', { style: { fontSize: '10px', color: 'var(--ui-muted, #888888)' }, children: 'Idle Evict:' }),
          jsxs('div', {
            style: S.btnGroup,
            children: [
              Btn({
                disabled: !hasDesktopPoolControl,
                onClick: () => onUpdatePool('idle', 120000),
                variant: poolLimits.idleMs === 120000 ? 'primary' : 'secondary',
                style: { padding: '1px 5px', fontSize: '9.5px' },
                title: hasDesktopPoolControl ? 'Evict after 2 minutes of inactivity' : t.slotUnavailable,
                children: '2m'
              }),
              Btn({
                disabled: !hasDesktopPoolControl,
                onClick: () => onUpdatePool('idle', 300000),
                variant: poolLimits.idleMs === 300000 ? 'primary' : 'secondary',
                style: { padding: '1px 5px', fontSize: '9.5px' },
                title: hasDesktopPoolControl ? 'Evict after 5 minutes of inactivity' : t.slotUnavailable,
                children: '5m'
              }),
              Btn({
                disabled: !hasDesktopPoolControl,
                onClick: () => onUpdatePool('idle', 600000),
                variant: poolLimits.idleMs === 600000 ? 'primary' : 'secondary',
                style: { padding: '1px 5px', fontSize: '9.5px' },
                title: hasDesktopPoolControl ? 'Evict after 10 minutes of inactivity' : t.slotUnavailable,
                children: '10m'
              })
            ]
          })
        ]
      }),
      switchFeedback && jsx('div', {
        style: {
          fontSize: '11px',
          padding: '4px 8px',
          borderRadius: '4px',
          backgroundColor: switchFeedback.includes('Error')
            ? 'var(--ui-badge-danger-bg, rgba(239, 68, 68, 0.15))'
            : 'var(--ui-card-active-bg, rgba(99, 102, 241, 0.1))',
          color: switchFeedback.includes('Error')
            ? 'var(--ui-danger, #ef4444)'
            : 'var(--ui-primary, #4f46e5)',
          textAlign: 'center'
        },
        children: switchFeedback
      })
    ]
  });
}

/**
 * 2. エージェント単体行コンポーネント (120秒スタック判定・強制停止ボタン・経過時間)
 */
function AgentRow({
  bot,
  isFocused,
  isRunning,
  cur,
  isBusy,
  lastInf,
  now,
  isSwitching,
  onReset,
  onRequestSwitch,
  t
}) {
  const name = bot.name;
  const elapsedSec = (isBusy && cur?.start) ? Math.max(0, Math.floor((now - cur.start) / 1000)) : 0;
  const isStuck = isBusy && elapsedSec >= RESET_BUTTON_DELAY_SEC;

  let statusLabel = 'Standby';
  let statusBg = 'var(--ui-badge-muted-bg, rgba(127, 127, 127, 0.12))';
  let statusColor = 'var(--ui-muted, #888888)';

  if (isBusy) {
    statusLabel = cur?.toolName ? `⚡ ${cur.toolName}` : '🧠 Busy';
    statusBg = 'var(--ui-badge-warning-bg, rgba(245, 158, 11, 0.15))';
    statusColor = 'var(--ui-warning, #d97706)';
  } else if (isRunning) {
    statusLabel = '💤 Idle';
    statusBg = 'var(--ui-badge-success-bg, rgba(16, 185, 129, 0.15))';
    statusColor = 'var(--ui-success, #10b981)';
  }

  return jsxs('div', {
    style: {
      padding: '9px 10px',
      borderRadius: '8px',
      backgroundColor: isFocused ? 'var(--ui-card-active-bg, rgba(99, 102, 241, 0.08))' : 'var(--ui-card-item-bg, rgba(127, 127, 127, 0.04))',
      border: isFocused ? '1px solid var(--ui-primary, rgba(99, 102, 241, 0.4))' : '1px solid var(--ui-border, rgba(127, 127, 127, 0.1))',
      display: 'flex',
      flexDirection: 'column',
      gap: '5px'
    },
    children: [
      jsxs('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
        children: [
          jsxs('div', {
            style: { display: 'flex', alignItems: 'center', gap: '6px' },
            children: [
              jsx('span', { style: { fontWeight: '700', fontSize: '12px' }, children: bot.display_name || name }),
              isFocused && Badge('Active', 'var(--ui-badge-primary-bg, rgba(99, 102, 241, 0.15))', 'var(--ui-primary, #4f46e5)'),
              Badge(statusLabel, statusBg, statusColor)
            ]
          }),
          jsxs('div', {
            style: { display: 'flex', alignItems: 'center', gap: '4px' },
            children: [
              isStuck && Btn({
                onClick: () => onReset(name),
                variant: 'secondary',
                style: { padding: '3px 6px', fontSize: '10px' },
                title: t.resetSlotTooltip(elapsedSec),
                children: t.resetSlotBtn
              }),
              !isFocused && Btn({
                disabled: isSwitching,
                onClick: () => onRequestSwitch(name),
                variant: isRunning ? 'secondary' : 'primary',
                children: isRunning ? 'Open' : 'Switch ➔'
              })
            ]
          })
        ]
      }),
      jsxs('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10.5px', color: 'var(--ui-muted, #888888)', marginTop: '1px' },
        children: [
          jsx('span', {
            children: isBusy
              ? (isStuck ? t.stuckWarning(elapsedSec) : t.runningTask(elapsedSec))
              : lastInf
                ? `⏱ Last: ${formatRelativeTime(lastInf.completedAt)}${lastInf.duration ? ` (${lastInf.duration}s / ${lastInf.summary})` : ` (${lastInf.summary})`}`
                : isRunning
                  ? '⏱ Last: None (Idle)'
                  : '⏱ Last: None (Standby)'
          }),
          isRunning && !isBusy && jsx('span', {
            style: { color: isFocused ? 'var(--ui-primary, #6366f1)' : 'var(--ui-success, #059669)', fontWeight: '600' },
            children: isFocused ? 'Protected' : 'Evictable'
          })
        ]
      })
    ]
  });
}

/**
 * 3. エージェント一覧カード
 */
function AgentListCard({
  roster,
  focusedProfileName,
  runningProfiles,
  agentStatus,
  sessionBotMap,
  busyBySession,
  lastInferenceMap,
  now,
  busyProfiles,
  isSwitching,
  onResetInference,
  onResetAllBusy,
  onRequestSwitch,
  t
}) {
  return jsxs('div', {
    style: S.card,
    children: [
      jsxs('div', {
        style: S.header,
        children: [
          jsxs('div', {
            style: { ...S.title, color: 'var(--ui-text, inherit)' },
            children: [jsx('span', { children: '🤖' }), jsx('span', { children: 'AGENTS & INFERENCE STATE' })]
          }),
          jsxs('div', {
            style: { display: 'flex', alignItems: 'center', gap: '6px' },
            children: [
              jsx('span', {
                style: { fontSize: '10px', color: 'var(--ui-muted, #888888)' },
                children: busyProfiles.length > 0 ? `${busyProfiles.length} Busy` : 'All Idle'
              }),
              busyProfiles.length > 0 && Btn({
                onClick: onResetAllBusy,
                variant: 'secondary',
                style: { padding: '2px 6px', fontSize: '10px' },
                title: t.resetAllTooltip,
                children: '↺ Reset All'
              })
            ]
          })
        ]
      }),
      jsxs('div', {
        style: { display: 'flex', flexDirection: 'column', gap: '8px' },
        children: roster.map((bot) => {
          const name = bot.name;
          const isFocused = focusedProfileName === name;
          const isRunning = runningProfiles.has(name);
          const cur = agentStatus[name];
          const isBusy = (cur && cur.status !== 'tool_completed') || Object.entries(sessionBotMap).some(([sid, b]) => b === name && busyBySession[sid]);
          const lastInf = lastInferenceMap[name];

          return jsx(AgentRow, {
            key: name,
            bot,
            isFocused,
            isRunning,
            cur,
            isBusy,
            lastInf,
            now,
            isSwitching,
            onReset: onResetInference,
            onRequestSwitch,
            t
          });
        })
      })
    ]
  });
}

/**
 * 4. 全枠ビジー時の安全確認モーダル
 */
function SafeSwitchModal({
  pendingSwitchTarget,
  maxBackends,
  busyProfiles,
  agentStatus,
  hasDesktopPoolControl,
  onPerformSwitch,
  onCancel,
  t
}) {
  if (!pendingSwitchTarget) return null;

  return jsx('div', {
    style: S.modalBackdrop,
    children: jsxs('div', {
      style: S.modal,
      children: [
        jsxs('div', {
          style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' },
          children: [
            jsx('span', { style: { fontSize: '20px' }, children: '⚠️' }),
            jsx('h3', { style: { margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--ui-warning, #b45309)' }, children: t.modalTitle })
          ]
        }),
        jsxs('p', {
          style: { fontSize: '12px', lineHeight: '1.5', color: 'var(--ui-text, inherit)', opacity: 0.85, margin: '0 0 12px 0' },
          children: [
            t.modalDesc1(maxBackends),
            jsx('br', {}),
            t.modalDesc2
          ]
        }),
        jsx('div', {
          style: { backgroundColor: 'var(--ui-card-item-bg, rgba(127, 127, 127, 0.08))', borderRadius: '6px', padding: '8px 10px', marginBottom: '14px' },
          children: jsxs('div', {
            style: { fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '4px' },
            children: [
              jsx('span', { style: { fontWeight: '600', color: 'var(--ui-text, inherit)' }, children: t.modalRunning }),
              busyProfiles.map((bName) => {
                const st = agentStatus[bName];
                const elapsed = st?.start ? Math.max(1, Math.round((Date.now() - st.start) / 1000)) : 0;
                return jsxs('div', {
                  key: bName,
                  style: { display: 'flex', justifyContent: 'space-between', color: 'var(--ui-muted, #888888)' },
                  children: [
                    jsx('span', { children: `・${bName}` }),
                    jsx('span', { style: { color: 'var(--ui-warning, #d97706)', fontWeight: '600' }, children: st?.toolName ? `Tool: ${st?.toolName} (${elapsed}s)` : `Thinking (${elapsed}s)` })
                  ]
                });
              })
            ]
          })
        }),
        jsxs('div', {
          style: { display: 'flex', flexDirection: 'column', gap: '6px' },
          children: [
            hasDesktopPoolControl && Btn({
              onClick: () => onPerformSwitch(pendingSwitchTarget, { expandSlot: true }),
              variant: 'primary',
              style: { justifyContent: 'center', padding: '8px' },
              children: `+1 Slot & Safe Switch (${maxBackends} → ${maxBackends + 1})`
            }),
            Btn({
              onClick: () => onPerformSwitch(pendingSwitchTarget, { expandSlot: false }),
              variant: 'danger',
              style: { justifyContent: 'center', padding: '6px', fontSize: '10.5px' },
              children: 'Force Switch (Risk of Timeout)'
            }),
            Btn({
              onClick: onCancel,
              variant: 'secondary',
              style: { justifyContent: 'center', padding: '6px', marginTop: '4px' },
              children: 'Cancel'
            })
          ]
        })
      ]
    })
  });
}

// ============================================================================
// 【第4層】メインエントリー (Main Pane)
// ============================================================================

function AgentActiveManagerPane() {
  // 1. Hermes 外部状態
  const busyBySession = useValue(host.state?.busyBySession) || {};
  const focusedProfileAtom = host.state?.focusedSessionProfile || host.state?.profile;
  const focusedProfileName = useValue(focusedProfileAtom) || 'default';
  const focusedSidAtom = host.state?.focusedSessionId || host.state?.focusedStoredSessionId;
  const focusedSessionId = useValue(focusedSidAtom) || '';

  // 2. 参照用 Refs（非同期処理からの最新参照用）
  const busyBySessionRef = useRef(busyBySession);
  busyBySessionRef.current = busyBySession;
  const focusedProfileRef = useRef(focusedProfileName);
  focusedProfileRef.current = focusedProfileName;
  const focusedSidRef = useRef(focusedSessionId);
  focusedSidRef.current = focusedSessionId;

  // 3. 各層のカスタムフック呼び出し
  const { poolLimits, setPoolLimits, hasDesktopPoolControl } = usePoolLimits();

  const agentState = useAgentState({
    busyBySession,
    busyBySessionRef,
    focusedProfileRef,
    focusedSidRef,
    poolLimits
  });

  const maxBackends = poolLimits.maxBackends || 3;
  const runningCount = agentState.runningList.length;
  const isFull = runningCount >= maxBackends;
  const allRunningAreBusy = isFull && (agentState.busyProfiles.length >= runningCount);
  const usagePct = Math.round((runningCount / maxBackends) * 100);

  const {
    isSwitching,
    switchFeedback,
    pendingSwitchTarget,
    setPendingSwitchTarget,
    handleResetInference,
    handleResetAllBusy,
    performSwitch,
    handleRequestSwitch,
    handlePoolUpdate
  } = useSessionActions({
    host,
    t,
    poolLimits,
    setPoolLimits,
    hasDesktopPoolControl,
    sessionBotMapRef: agentState.sessionBotMapRef,
    focusedProfileRef,
    focusedSidRef,
    markInferenceFinished: agentState.markInferenceFinished,
    busyProfiles: agentState.busyProfiles,
    runningCount,
    allRunningAreBusy
  });

  return jsxs('div', {
    style: S.container,
    children: [
      // 1. スロット枠・使用状況カード
      jsx(SlotCapacityCard, {
        poolLimits,
        runningCount,
        maxBackends,
        usagePct,
        isFull,
        allRunningAreBusy,
        hasDesktopPoolControl,
        onUpdatePool: handlePoolUpdate,
        switchFeedback,
        t
      }),

      // 2. エージェント一覧 ＆ 安全切り替え
      jsx(AgentListCard, {
        roster: agentState.roster,
        focusedProfileName,
        runningProfiles: agentState.runningProfiles,
        agentStatus: agentState.agentStatus,
        sessionBotMap: agentState.sessionBotMap,
        busyBySession,
        lastInferenceMap: agentState.lastInferenceMap,
        now: agentState.now,
        busyProfiles: agentState.busyProfiles,
        isSwitching,
        onResetInference: handleResetInference,
        onResetAllBusy: handleResetAllBusy,
        onRequestSwitch: handleRequestSwitch,
        t
      }),

      // 3. 全枠ビジー時の安全確認モーダル
      jsx(SafeSwitchModal, {
        pendingSwitchTarget,
        maxBackends,
        busyProfiles: agentState.busyProfiles,
        agentStatus: agentState.agentStatus,
        hasDesktopPoolControl,
        onPerformSwitch: performSwitch,
        onCancel: () => setPendingSwitchTarget(null),
        t
      })
    ]
  });
}

// ============================================================================
// 【第5層】Hermes Desktop Plugin エクスポート
// ============================================================================

const PANES = PANES_AREA || 'panes';
const ROUTES = ROUTES_AREA || 'routes';

export default {
  id: 'agent-active-manager',
  name: 'Agent Active Manager',
  description: 'Smart profile switcher and backend slot optimizer preventing free-slot timeouts.',
  defaultEnabled: true,
  register(ctx) {
    const entries = [
      {
        id: 'agent-active-manager-pane',
        area: PANES,
        title: 'Active Manager',
        data: { placement: 'right', defaultOpen: false, width: '330px' },
        render: () => jsx(AgentActiveManagerPane, {})
      },
      {
        id: 'agent-active-manager-route',
        area: ROUTES,
        data: { path: '/active-manager', title: 'Active Manager' },
        render: () => jsx(AgentActiveManagerPane, {})
      }
    ];

    return typeof ctx.registerMany === 'function'
      ? ctx.registerMany(entries)
      : (() => {
          const disposers = entries.map((e) => ctx.register(e));
          return () => disposers.forEach((d) => typeof d === 'function' && d());
        })();
  }
};
