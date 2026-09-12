import { host, useValue, PANES_AREA, ROUTES_AREA } from '@hermes/plugin-sdk';
import { jsx, jsxs } from 'react/jsx-runtime';
import React, { useState, useEffect, useRef, useMemo } from 'react';

// --- 1. 共通ヘルパー関数 & 永続化 ---
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

const getLocale = () => {
  if (typeof document !== 'undefined') {
    const docLang = document.documentElement?.lang || document.documentElement?.getAttribute('lang');
    if (docLang && docLang.toLowerCase().startsWith('ja')) return 'ja';
  }
  if (typeof navigator !== 'undefined') {
    const langs = navigator.languages || [navigator.language || navigator.userLanguage || ''];
    if (langs.some((l) => l && l.toLowerCase().startsWith('ja'))) return 'ja';
  }
  return 'en';
};

const I18N = {
  ja: {
    incSlot: 'スロット枠を+1増やす',
    decSlot: 'スロット枠を-1減らす',
    slotUnavailable: 'Desktop内部API未接続のため、スロット数は固定（推定3枠）です',
    resetAllTooltip: 'すべてのビジーエージェントの推論停止とステータスリセットを実行',
    resetSlotTooltip: 'バックエンド推論を強制停止し、スロットを即時解放',
    resetSlotNotif: (p) => `"${p}" の推論セッションを停止し、スロットを解放しました`,
    resetSlotError: (p, msg) => `"${p}" のセッション停止に失敗しました: ${msg}`,
    resetAllNotif: (count) => `${count} 件のビジーセッションを停止しました`,
    modalTitle: '全エージェントが作業・推論中です',
    modalDesc1: (max) => `現在起動中のすべてのスロット（${max}枠）でエージェントが推論やツールを実行しています。`,
    modalDesc2: 'このまま切り替えると、実行中のタスクが中断したり、スロット待ちでタイムアウト（エラー）になる可能性があります。',
    modalRunning: '現在実行中のエージェント:',
    safeSwitchGuardTitle: '全枠ビジー安全ガード',
    safeSwitchGuardDesc: '全スロット稼働時の切り替えタイムアウトを防止'
  },
  en: {
    incSlot: 'Increase slot limit (+1)',
    decSlot: 'Decrease slot limit (-1)',
    slotUnavailable: 'Desktop internal API unavailable; slot limit is fixed (estimated: 3)',
    resetAllTooltip: 'Stop backend inference and reset state for all busy agents',
    resetSlotTooltip: 'Force stop backend inference and immediately free slot',
    resetSlotNotif: (p) => `Stopped inference session and released slot for "${p}"`,
    resetSlotError: (p, msg) => `Failed to stop session for "${p}": ${msg}`,
    resetAllNotif: (count) => `Stopped ${count} busy session(s)`,
    modalTitle: 'All Agents Are Busy',
    modalDesc1: (max) => `All active slots (${max}) are currently busy with reasoning or tool execution.`,
    modalDesc2: 'Switching now may interrupt ongoing tasks or cause a timeout error while waiting for a free slot.',
    modalRunning: 'Currently running agents:',
    safeSwitchGuardTitle: 'Safe Switch Guard',
    safeSwitchGuardDesc: 'Prevents switch timeout when all slots are busy'
  }
};

/**
 * 公式仕様に準拠した通知ヘルパー ({ kind, message })
 */
const sendNotification = (message, kind = 'info') => {
  if (typeof host?.notify !== 'function') return;
  try {
    host.notify({ kind, message });
  } catch (_) {}
};

const extractProfile = (ev, p, roster, sMap, focusedProfile, focusedSid) => {
  const sid = ev.sessionId || ev.session_id || ev.session || ev.sid || p?.sessionId || p?.session_id;

  // 1. すでに登録済みのセッションIDから特定
  if (sid && sMap[sid]) return sMap[sid];

  // 2. 現在開いているセッションIDと一致する場合、フォーカス中のプロファイルを即時学習
  if (sid && focusedSid && sid === focusedSid && focusedProfile) {
    sMap[sid] = focusedProfile;
    return focusedProfile;
  }

  // 3. 最新Hermes公式の turn_author / author / sender を最優先で認識
  const author = ev.turn_author || ev.turnAuthor || p?.turn_author || p?.turnAuthor ||
                 ev.author || p?.author || ev.sender || p?.sender;
  if (typeof author === 'string' && author.trim()) {
    const prof = author.trim().toLowerCase();
    if (sid) sMap[sid] = prof;
    return prof;
  }
  if (author?.profile || author?.name || author?.id) {
    const prof = (author.profile || author.name || author.id).trim().toLowerCase();
    if (sid) sMap[sid] = prof;
    return prof;
  }

  // 4. ペイロード内の直接のボット指定（※ role は除外）
  const direct = ev.agent || ev.bot || ev.speaker ||
                 p?.agent || p?.bot || p?.speaker || p?.member || p?.agentName;
  if (typeof direct === 'string' && direct.trim()) {
    const prof = direct.trim().toLowerCase();
    if (sid) sMap[sid] = prof;
    return prof;
  }

  // 5. from フィールド
  if (typeof p?.from === 'string') {
    const prof = p.from.trim().toLowerCase();
    if (sid) sMap[sid] = prof;
    return prof;
  }
  if (p?.from?.name || p?.from?.profile) {
    const prof = (p.from.name || p.from.profile).trim().toLowerCase();
    if (sid) sMap[sid] = prof;
    return prof;
  }

  // 6. ev.profile / p.profile の判定（Gatewayソケット由来の'default'トラップを回避）
  const evProf = (ev.profile || p?.profile || '').trim().toLowerCase();
  if (evProf) {
    if (evProf === 'default' && focusedProfile && focusedProfile !== 'default') {
      if (sid) sMap[sid] = focusedProfile;
      return focusedProfile;
    }
    if (sid) sMap[sid] = evProf;
    return evProf;
  }

  // 7. フォーカス中プロファイルへのフォールバック
  if (focusedProfile) {
    if (sid) sMap[sid] = focusedProfile;
    return focusedProfile;
  }

  return '';
};

// --- 2. UI スタイル（Hermes 公式 CSS 変数 / Design Tokens 準拠） ---
const S = {
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
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '12px'
  },
  card: {
    background: 'var(--ui-card-bg, rgba(127, 127, 127, 0.05))',
    borderRadius: '10px',
    border: '1px solid var(--ui-border, rgba(127, 127, 127, 0.15))',
    padding: '12px',
    marginBottom: '12px'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '10px'
  },
  title: {
    fontSize: '12px',
    fontWeight: '700',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: 'var(--ui-primary, #6366f1)',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    backdropFilter: 'blur(3px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 99999,
    padding: '20px'
  },
  modal: {
    background: 'var(--ui-modal-bg, var(--ui-card-bg, #ffffff))',
    color: 'var(--ui-text, #1f2937)',
    borderRadius: '12px',
    padding: '18px 20px',
    maxWidth: '420px',
    width: '100%',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)',
    border: '1px solid var(--ui-border, rgba(127, 127, 127, 0.2))'
  }
};

const Badge = (children, bg, color) => jsx('span', {
  style: {
    fontSize: '10px',
    fontWeight: '600',
    padding: '2px 6px',
    borderRadius: '4px',
    background: bg,
    color
  },
  children
});

const Btn = ({ onClick, children, variant = 'primary', disabled = false, style = {}, title }) => {
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

/**
 * Agent Active Manager メインコンポーネント
 */
function AgentActiveManagerPane() {
  const busyBySession = useValue(host.state?.busyBySession) || {};
  const focusedProfileAtom = host.state?.focusedSessionProfile || host.state?.profile;
  const focusedProfileName = useValue(focusedProfileAtom) || 'default';
  const focusedSidAtom = host.state?.focusedSessionId || host.state?.focusedStoredSessionId;
  const focusedSessionId = useValue(focusedSidAtom) || '';
  const t = I18N[getLocale()] || I18N.en;

  const hasDesktopPoolControl = typeof window !== 'undefined' && Boolean(window.hermesDesktop?.setPoolLimits);
  const [poolLimits, setPoolLimits] = useState({ maxBackends: 3, idleMs: 600000 });
  const [roster, setRoster] = useState([]);
  const [sessionBotMap, setSessionBotMap] = useState({});
  const [agentStatus, setAgentStatus] = useState({});
  const [lastInferenceMap, setLastInferenceMap] = useState(loadStoredInferences);
  const [runningProfiles, setRunningProfiles] = useState(new Set());
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchFeedback, setSwitchFeedback] = useState(null);
  const [pendingSwitchTarget, setPendingSwitchTarget] = useState(null);

  const rosterRef = useRef([]);
  const sessionBotMapRef = useRef({});
  const agentStatusRef = useRef({});
  const lastActiveRef = useRef({});
  const focusedProfileRef = useRef(focusedProfileName);
  focusedProfileRef.current = focusedProfileName;
  const focusedSidRef = useRef(focusedSessionId);
  focusedSidRef.current = focusedSessionId;

  // 一時スロット拡張のイベント駆動型クリーンアップ用参照
  const pendingRevertMaxRef = useRef(null);

  // プール制限設定の読み込み（未公開API存在時のみ連携し、非存在時はフォールバック）
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

  // プロファイル一覧と「ランタイムセッション情報（sessions.list）」の同期
  useEffect(() => {
    let isMounted = true;
    const syncRoster = async () => {
      try {
        if (typeof host?.request !== 'function') return;

        // 1. プロファイル一覧を取得
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

        // 2. ランタイムセッション一覧（sessions.list）から正確な sessionId -> profile マッピングを取得
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

        // 3. 現在フォーカス中のセッションIDも最優先でマッピング
        if (focusedSidRef.current && focusedProfileRef.current) {
          mapUpdate[focusedSidRef.current] = focusedProfileRef.current;
        }

        // 4. canonical_session / last_session からの補完マッピング
        for (const p of sorted) {
          const cs = p.canonical_session || p.last_session;
          const csId = cs?.resolved_id || cs?.id;
          if (csId && !mapUpdate[csId]) mapUpdate[csId] = p.name;
        }

        sessionBotMapRef.current = { ...sessionBotMapRef.current, ...mapUpdate };
        setSessionBotMap((prev) => ({ ...prev, ...mapUpdate }));

        // プロファイルに紐づく過去のセッション更新日時の初期補完
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

  // 推論完了・スタンバイ復帰の共通処理
  const markInferenceFinished = (targetProfile, reason = 'Done') => {
    if (!targetProfile) return;
    const now = Date.now();
    const prev = agentStatusRef.current[targetProfile];
    const duration = prev?.start ? Math.max(1, Math.round((now - prev.start) / 1000)) : null;

    setLastInferenceMap((prevMap) => {
      const nextMap = {
        ...prevMap,
        [targetProfile]: {
          completedAt: new Date(now).toISOString(),
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

  // 個別推論状態のリセット & スロット強制解放（関連するすべてのランタイムsessionIdを明示してバックエンド停止を実行）
  const handleResetInference = async (targetProfile) => {
    try {
      // 複数接続・リモート環境対応: profileRoutes から route descriptor を取得
      const routes = typeof host?.profileRoutes === 'function'
        ? await host.profileRoutes().catch(() => null)
        : null;
      const targetRoute = Array.isArray(routes)
        ? routes.find((r) => r.profile === targetProfile || r.targetProfile === targetProfile)
        : null;
      const routeTarget = targetRoute || targetProfile;
      const targetProfileName = targetRoute?.profile ?? targetProfile;

      // 該当プロファイルのアクティブなランタイム sessionId をすべて特定
      const activeSids = Object.entries(sessionBotMapRef.current)
        .filter(([_, bot]) => bot === targetProfile || bot === targetProfileName)
        .map(([sid]) => sid);

      if (focusedProfileRef.current === targetProfile && focusedSidRef.current && !activeSids.includes(focusedSidRef.current)) {
        activeSids.push(focusedSidRef.current);
      }

      const stopPromises = [];
      if (activeSids.length > 0) {
        for (const sid of activeSids) {
          const stopPayload = {
            profile: targetProfileName,
            sessionId: sid,
            session_id: sid,
            abort: true
          };
          if (typeof host?.requestProfile === 'function') {
            stopPromises.push(host.requestProfile(routeTarget, 'session.stop', stopPayload));
          } else if (typeof host?.request === 'function') {
            stopPromises.push(host.request('session.stop', stopPayload));
          }
        }
      } else {
        const stopPayload = { profile: targetProfileName, abort: true };
        if (typeof host?.requestProfile === 'function') {
          stopPromises.push(host.requestProfile(routeTarget, 'session.stop', stopPayload));
        } else if (typeof host?.request === 'function') {
          stopPromises.push(host.request('session.stop', stopPayload));
        }
      }

      const results = await Promise.allSettled(stopPromises);
      const allFailed = stopPromises.length > 0 && results.every((r) => r.status === 'rejected');
      if (allFailed) {
        const firstErr = results.find((r) => r.status === 'rejected')?.reason;
        const errMsg = firstErr?.message || String(firstErr || 'Failed to stop backend session');
        sendNotification(t.resetSlotError(targetProfile, errMsg), 'error');
        return;
      }

      markInferenceFinished(targetProfile, 'Reset');
      sendNotification(t.resetSlotNotif(targetProfile), 'success');
    } catch (err) {
      console.error('[AgentActiveManager] Reset session error:', err);
      sendNotification(t.resetSlotError(targetProfile, err?.message || 'Error stopping session'), 'error');
    }
  };

  // 全体リセット（すべてのビジープロファイルのバックエンドセッション停止を並行実行）
  const handleResetAllBusy = async () => {
    const targets = [...busyProfiles];
    if (targets.length === 0) return;
    try {
      await Promise.allSettled(targets.map((b) => handleResetInference(b)));
      sendNotification(t.resetAllNotif(targets.length), 'info');
    } catch (err) {
      console.error('[AgentActiveManager] handleResetAllBusy error:', err);
    }
  };

  // Gatewayイベントの監視（推論状態と直前推論履歴）
  useEffect(() => {
    if (typeof host?.onEvent !== 'function') return;
    const unsubscribe = host.onEvent('*', (event) => {
      if (!event) return;
      const eventType = (event.type || event.event || '').toLowerCase();
      const payload = event.payload ?? event.data ?? event.message ?? event;

      // ノイズ除外（アクティビティのないシステム通知）
      if (matchAny(eventType, ['gateway.', 'sessions.', 'profiles.', 'skin.', 'theme.'])) {
        const hasActivity = payload?.text || payload?.content || payload?.delta || payload?.tool || payload?.error;
        if (!hasActivity) return;
      }

      // ユーザー入力メッセージやシステム内部通知そのものはエージェント生成中ではないため除外
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
          setSessionBotMap((prev) => ({ ...prev, [sid]: rawProfile }));
        }
      }

      const now = Date.now();

      // 完了・終了シグナルの総合判定
      const isFinished = matchAny(eventType, [
        'turn.finish', 'turn.end', 'turn.complete', 'turn.finished',
        'chat.complete', 'chat.finish',
        'agent.finish', 'agent.idle',
        'session.idle', 'session.finish',
        'run.finish', 'run.complete',
        'stream.finish', 'stream.end',
        'generation.finish', 'generation.complete'
      ]) ||
      eventType.endsWith('.finish') ||
      eventType.endsWith('.complete') ||
      eventType.endsWith('.end') ||
      eventType.endsWith('.idle') ||
      eventType.endsWith('.done') ||
      Boolean(payload?.finish_reason) ||
      payload?.done === true ||
      payload?.status === 'completed';

      // ツール関連
      const isToolResult = !isFinished && (matchAny(eventType, ['tool_result', 'tool.result', 'tool_output', 'tool_response']) || Boolean(payload?.tool_result) || role === 'tool');
      const isToolCall = !isFinished && !isToolResult && (matchAny(eventType, ['tool_call', 'tool.start', 'tool_start', 'tool', 'exec', 'action']) || Boolean(payload?.tool || payload?.tool_call || payload?.function));

      // 思考中
      const isThinking = !isFinished && !isToolCall && !isToolResult && (matchAny(eventType, ['reason', 'think', 'thought', 'turn.start']) || Boolean(payload?.reasoning || payload?.thought));

      // ストリーム生成中
      const isDelta = matchAny(eventType, ['delta', 'stream', 'chunk']) || Boolean(payload?.delta);
      const isGenerating = !isFinished && !isToolCall && !isToolResult && !isThinking && (
        isDelta ||
        matchAny(eventType, ['agent.stream', 'generate', 'generation']) ||
        (matchAny(eventType, ['turn.progress']) && Boolean(payload?.text || payload?.content))
      );

      // 実際の推論・生成・ツール実行が発生している場合のみ稼働中として記録
      if (isToolResult || isToolCall || isThinking || isGenerating || isFinished) {
        lastActiveRef.current[rawProfile] = now;
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
          start: agentStatusRef.current[rawProfile]?.start || now,
          lastActive: now
        };
        agentStatusRef.current[rawProfile] = nextStatus;
        setAgentStatus({ ...agentStatusRef.current });
      }
    });

    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, []);

  // 推論状態の自動クリーンアップ・タイムアウト監視（ウォッチドッグ）
  useEffect(() => {
    const watchdog = setInterval(() => {
      const now = Date.now();
      const currentStatus = { ...agentStatusRef.current };
      let changed = false;

      for (const [name, st] of Object.entries(currentStatus)) {
        if (!st) continue;
        const lastActive = st.lastActive || lastActiveRef.current[name] || 0;
        const idleFor = now - lastActive;

        // 該当プロファイルに紐づくランタイムセッションの busyBySession 状態を判定
        const isSessionBusy = Object.entries(sessionBotMapRef.current).some(([sid, bot]) => bot === name && busyBySession[sid]);

        // 判定条件1: tool_completed 状態が 3秒以上経過したら完了
        const toolFinished = st.status === 'tool_completed' && idleFor >= 3000;

        // 判定条件2: セッションが非busy かつ イベントが 3秒以上停止している
        const sessionBecameIdle = !isSessionBusy && idleFor >= 3000;

        // 判定条件3: busyBySessionの状態にかかわらず、イベントが 10秒以上完全に途絶えた（タイムアウト自動復旧）
        const eventTimedOut = idleFor >= 10000;

        if (toolFinished || sessionBecameIdle || eventTimedOut) {
          const duration = st.start ? Math.max(1, Math.round((now - st.start) / 1000)) : null;
          const summary = st.toolName ? `Tool: ${st.toolName}` : 'Done';

          setLastInferenceMap((prevMap) => {
            const nextMap = {
              ...prevMap,
              [name]: {
                completedAt: now,
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
  }, [busyBySession]);

  // アイドル時間経過によるバックエンド退避の検知
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const idleThreshold = Math.max(60000, poolLimits.idleMs || 120000);
      setRunningProfiles((prev) => {
        let changed = false;
        const next = new Set();
        for (const p of prev) {
          if (now - (lastActiveRef.current[p] || 0) < idleThreshold || p === focusedProfileName) {
            next.add(p);
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 4000);
    return () => clearInterval(timer);
  }, [focusedProfileName, poolLimits.idleMs]);

  // フォーカス中プロファイルは常に稼働セットに維持 ＆ スロット拡張の復元検知
  useEffect(() => {
    if (focusedProfileName) {
      lastActiveRef.current[focusedProfileName] = Date.now();
      setRunningProfiles((prev) => new Set([...prev, focusedProfileName]));

      // 一時スロット拡張のイベント駆動型復元: 目的のプロファイルに切り替わったら上限を元に戻す
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
  }, [focusedProfileName, hasDesktopPoolControl]);

  const runningList = useMemo(() => Array.from(runningProfiles), [runningProfiles]);
  const busyProfiles = useMemo(() => {
    return runningList.filter((name) => {
      const st = agentStatus[name];
      if (st && st.status !== 'tool_completed') return true;
      return Object.entries(sessionBotMap).some(([sid, bot]) => bot === name && busyBySession[sid]);
    });
  }, [runningList, agentStatus, sessionBotMap, busyBySession]);

  const maxBackends = poolLimits.maxBackends || 3;
  const runningCount = runningList.length;
  const isFull = runningCount >= maxBackends;
  const allRunningAreBusy = isFull && (busyProfiles.length >= runningCount);
  const usagePct = Math.round((runningCount / maxBackends) * 100);

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

        // セーフティガード（最大30秒後に自動復元）
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

      // 複数接続環境対応: host.profileRoutes() は Promise を返すため await して取得
      const routes = typeof host?.profileRoutes === 'function'
        ? await host.profileRoutes().catch(() => null)
        : null;
      const targetRoute = Array.isArray(routes)
        ? routes.find((r) => r.profile === targetBot || r.targetProfile === targetBot)
        : null;
      const routeTarget = targetRoute || targetBot;
      const targetConnId = targetRoute?.connectionId ?? null;
      const targetProfileName = targetRoute?.profile ?? targetBot;

      const matched = (rosterRef.current || []).find((p) => p.name === targetBot);
      let targetSessionId = matched?.canonical_session?.resolved_id || matched?.canonical_session?.id ||
                            matched?.last_session?.resolved_id || matched?.last_session?.id;

      if (!targetSessionId) {
        const createSess = typeof host?.requestProfile === 'function'
          ? host.requestProfile(routeTarget, 'session.create', {})
          : host.request?.('session.create', { profile: targetBot });
        const createRes = await createSess?.catch(() => null);
        targetSessionId = createRes?.session?.id || createRes?.id;
      }

      // 公式仕様: host.ensureAgent(connectionId, profile) - route 由来の connectionId と source profile を指定
      await host?.ensureAgent?.(targetConnId, targetProfileName).catch(() => {});

      if (targetSessionId) {
        if (typeof host?.openSession === 'function') {
          await host.openSession(targetSessionId, {
            profile: targetProfileName,
            route: targetRoute || undefined,
            connectionId: targetConnId || undefined,
            awaitHydration: false
          }).catch(() => null);
        } else if (typeof host?.switchSession === 'function') {
          await host.switchSession(targetSessionId, {
            targetProfile: targetRoute?.targetProfile ?? targetProfileName,
            profile: targetProfileName,
            route: targetRoute || undefined,
            connectionId: targetConnId || undefined
          }).catch(() => host?.navigate?.(`/${targetSessionId}`));
        } else if (typeof host?.navigate === 'function') {
          host.navigate(`/${targetSessionId}`);
        } else if (typeof window !== 'undefined') {
          window.location.hash = `#/${targetSessionId}`;
        }
      } else {
        host?.navigate?.('/');
      }

      lastActiveRef.current[targetBot] = Date.now();
      setRunningProfiles((prev) => new Set([...prev, targetBot]));
      setSwitchFeedback(`✅ Switched to "${targetBot}"`);
      setTimeout(() => setSwitchFeedback(null), 3000);
    } catch (err) {
      console.error('[AgentActiveManager] performSwitch error:', err);
      setSwitchFeedback(`❌ Switch failed: ${err?.message || err}`);
      setTimeout(() => setSwitchFeedback(null), 5000);
    } finally {
      setIsSwitching(false);
      setPendingSwitchTarget(null);
    }
  };

  const handleRequestSwitch = (targetBot) => {
    if (targetBot === focusedProfileName) return;
    if (isFull && allRunningAreBusy && !runningProfiles.has(targetBot)) {
      setPendingSwitchTarget(targetBot);
      return;
    }
    performSwitch(targetBot, { expandSlot: false });
  };

  const handleChangeIdleMs = async (ms) => {
    if (!hasDesktopPoolControl) return;
    try {
      await window.hermesDesktop?.setPoolLimits?.({ idleMs: ms });
      setPoolLimits((prev) => ({ ...prev, idleMs: ms }));
      sendNotification(`Idle timeout set to ${Math.round(ms / 60000)}m`, 'info');
    } catch (err) {
      console.error('[AgentActiveManager] setPoolLimits idleMs error:', err);
    }
  };

  const handleChangeMaxBackends = async (delta) => {
    if (!hasDesktopPoolControl) return;
    const nextVal = Math.max(1, Math.min(16, maxBackends + delta));
    try {
      await window.hermesDesktop?.setPoolLimits?.({ maxBackends: nextVal });
      setPoolLimits((prev) => ({ ...prev, maxBackends: nextVal }));
    } catch (err) {
      console.error('[AgentActiveManager] setPoolLimits maxBackends error:', err);
    }
  };

  return jsxs('div', {
    style: S.container,
    children: [
      // 1. スロットリソースメーター
      jsxs('div', {
        style: S.card,
        children: [
          jsxs('div', {
            style: S.header,
            children: [
              jsxs('div', {
                style: S.title,
                children: [jsx('span', { children: '⚡' }), jsx('span', { children: 'BACKEND SLOT POOL' })]
              }),
              jsxs('div', {
                style: { display: 'flex', alignItems: 'center', gap: '4px' },
                children: [
                  Badge(
                    `${runningCount} / ${maxBackends} Active`,
                    isFull ? 'var(--ui-badge-danger-bg, rgba(239, 68, 68, 0.15))' : 'var(--ui-badge-success-bg, rgba(16, 185, 129, 0.15))',
                    isFull ? 'var(--ui-danger, #ef4444)' : 'var(--ui-success, #10b981)'
                  ),
                  Btn({
                    onClick: () => handleChangeMaxBackends(1),
                    variant: 'secondary',
                    disabled: !hasDesktopPoolControl,
                    title: hasDesktopPoolControl ? t.incSlot : t.slotUnavailable,
                    style: { padding: '2px 6px', fontSize: '10px' },
                    children: '+1'
                  }),
                  maxBackends > 1 && Btn({
                    onClick: () => handleChangeMaxBackends(-1),
                    variant: 'secondary',
                    disabled: !hasDesktopPoolControl,
                    title: hasDesktopPoolControl ? t.decSlot : t.slotUnavailable,
                    style: { padding: '2px 6px', fontSize: '10px' },
                    children: '-1'
                  })
                ]
              })
            ]
          }),
          // プログレスバー
          jsx('div', {
            style: {
              width: '100%',
              height: '6px',
              borderRadius: '3px',
              backgroundColor: 'var(--ui-progress-bg, rgba(127, 127, 127, 0.15))',
              overflow: 'hidden',
              marginTop: '6px',
              marginBottom: '8px'
            },
            children: jsx('div', {
              style: {
                width: `${Math.min(100, Math.max(0, usagePct))}%`,
                height: '100%',
                backgroundColor: isFull ? 'var(--ui-danger, #ef4444)' : usagePct > 66 ? 'var(--ui-warning, #f59e0b)' : 'var(--ui-success, #10b981)',
                transition: 'width 0.3s ease, background-color 0.3s ease'
              }
            })
          }),
          // アイドル時間調整
          jsxs('div', {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '11px',
              color: 'var(--ui-muted, #888888)',
              marginTop: '4px'
            },
            children: [
              jsx('span', { children: `Idle Evict: ${Math.round(poolLimits.idleMs / 60000)}m` }),
              jsxs('div', {
                style: { display: 'flex', gap: '4px' },
                children: [120000, 300000, 600000].map((ms) => Btn({
                  key: ms,
                  onClick: () => handleChangeIdleMs(ms),
                  variant: 'secondary',
                  disabled: !hasDesktopPoolControl,
                  title: hasDesktopPoolControl ? undefined : t.slotUnavailable,
                  style: { padding: '1px 5px', fontSize: '9px', fontWeight: poolLimits.idleMs === ms ? '700' : '400' },
                  children: `${ms / 60000}m`
                }))
              })
            ]
          }),
          switchFeedback && jsx('div', {
            style: {
              marginTop: '8px',
              padding: '6px 8px',
              borderRadius: '6px',
              backgroundColor: switchFeedback.includes('❌') ? 'var(--ui-badge-danger-bg, rgba(239, 68, 68, 0.12))' : 'var(--ui-badge-primary-bg, rgba(99, 102, 241, 0.12))',
              color: switchFeedback.includes('❌') ? 'var(--ui-danger, #ef4444)' : 'var(--ui-primary, #4f46e5)',
              fontSize: '11px',
              fontWeight: '600'
            },
            children: switchFeedback
          })
        ]
      }),

      // 2. エージェント一覧 ＆ 安全切り替え
      jsxs('div', {
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
                    onClick: handleResetAllBusy,
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
                key: name,
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
                          isBusy && Btn({
                            onClick: () => handleResetInference(name),
                            variant: 'secondary',
                            style: { padding: '3px 6px', fontSize: '10px' },
                            title: t.resetSlotTooltip,
                            children: '↺ Reset & Free Slot'
                          }),
                          !isFocused && Btn({
                            disabled: isSwitching,
                            onClick: () => handleRequestSwitch(name),
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
                          ? '⏳ Running task...'
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
            })
          })
        ]
      }),

      // 3. 全枠ビジー時の安全確認モーダル
      pendingSwitchTarget && jsx('div', {
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
                  onClick: () => performSwitch(pendingSwitchTarget, { expandSlot: true }),
                  variant: 'primary',
                  style: { justifyContent: 'center', padding: '8px' },
                  children: `+1 Slot & Safe Switch (${maxBackends} → ${maxBackends + 1})`
                }),
                Btn({
                  onClick: () => performSwitch(pendingSwitchTarget, { expandSlot: false }),
                  variant: 'danger',
                  style: { justifyContent: 'center', padding: '6px', fontSize: '10.5px' },
                  children: 'Force Switch (Risk of Timeout)'
                }),
                Btn({
                  onClick: () => setPendingSwitchTarget(null),
                  variant: 'secondary',
                  style: { justifyContent: 'center', padding: '6px', marginTop: '4px' },
                  children: 'Cancel'
                })
              ]
            })
          ]
        })
      })
    ]
  });
}

// --- 3. Hermes Desktop Plugin エクスポート ---
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

    let unregister;
    if (typeof ctx.registerMany === 'function') {
      unregister = ctx.registerMany(entries);
    } else {
      const disposers = entries.map((e) => ctx.register(e));
      unregister = () => {
        disposers.forEach((d) => {
          if (typeof d === 'function') d();
        });
      };
    }

    return typeof unregister === 'function' ? unregister : () => {};
  }
};
