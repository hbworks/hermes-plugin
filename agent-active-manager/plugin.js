import { host, useValue, PANES_AREA, ROUTES_AREA } from '@hermes/plugin-sdk';
import { jsx, jsxs } from 'react/jsx-runtime';
import React, { useState, useEffect, useRef, useMemo } from 'react';

// --- ヘルパー関数 ---
const matchAny = (str, list) => typeof str === 'string' && list.some((k) => str.includes(k));

const extractProfile = (ev, p, roster, sMap) => {
  const direct = ev.profile || ev.agent || ev.bot || ev.speaker || ev.sender ||
                 p?.profile || p?.agent || p?.bot || p?.speaker || p?.member || p?.author || p?.sender || p?.role;
  if (direct && typeof direct === 'string' && direct.trim()) return direct.trim().toLowerCase();
  if (typeof p?.from === 'string') return p.from.trim().toLowerCase();
  if (p?.from?.name || p?.from?.profile) return (p.from.name || p.from.profile).trim().toLowerCase();

  const sid = ev.sessionId || ev.session_id || ev.session || ev.sid || p?.sessionId || p?.session_id;
  if (sid && sMap[sid]) return sMap[sid];

  if (roster && roster.length) {
    const textStr = `${ev.type || ''} ${p?.text || ''} ${typeof p === 'string' ? p : ''}`.toLowerCase();
    for (const b of roster) {
      const bn = b.name.toLowerCase();
      if (bn !== 'default' && (textStr.includes(`"${bn}"`) || textStr.includes(`@${bn}`) || textStr.includes(`[${bn}]`))) {
        return bn;
      }
    }
  }
  return '';
};

// 相対時間のフォーマット（例: "15秒前", "2分前"）
const formatRelativeTime = (timestamp) => {
  if (!timestamp) return '履歴なし';
  const sec = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (sec < 60) return `${sec}秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hours = Math.floor(min / 60);
  return `${hours}時間前`;
};

// --- スタイル定義 ---
const S = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    boxSizing: 'border-box',
    background: 'transparent',
    color: 'inherit',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    fontSize: '12px',
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '12px'
  },
  card: {
    background: 'rgba(0, 0, 0, 0.03)',
    borderRadius: '10px',
    border: '1px solid rgba(0, 0, 0, 0.08)',
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
    color: '#6366f1',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  badge: (bg, color) => ({
    fontSize: '10px',
    fontWeight: '600',
    padding: '2px 6px',
    borderRadius: '4px',
    background: bg,
    color: color
  }),
  button: (variant = 'primary') => {
    const isPrimary = variant === 'primary';
    const isDanger = variant === 'danger';
    return {
      background: isDanger ? '#ef4444' : isPrimary ? '#4f46e5' : 'rgba(0, 0, 0, 0.06)',
      color: isPrimary || isDanger ? '#ffffff' : 'inherit',
      border: 'none',
      borderRadius: '6px',
      padding: '5px 10px',
      fontSize: '11px',
      fontWeight: '600',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      transition: 'opacity 0.15s ease'
    };
  },
  modalBackdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    backdropFilter: 'blur(3px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 99999,
    padding: '20px'
  },
  modal: {
    background: '#ffffff',
    color: '#1f2937',
    borderRadius: '12px',
    padding: '18px 20px',
    maxWidth: '420px',
    width: '100%',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
    border: '1px solid rgba(0, 0, 0, 0.1)'
  },
  progressTrack: {
    width: '100%',
    height: '6px',
    borderRadius: '3px',
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
    overflow: 'hidden',
    marginTop: '6px',
    marginBottom: '8px'
  },
  progressBar: (pct, isFull) => ({
    width: `${Math.min(100, Math.max(0, pct))}%`,
    height: '100%',
    backgroundColor: isFull ? '#ef4444' : pct > 66 ? '#f59e0b' : '#10b981',
    transition: 'width 0.3s ease, background-color 0.3s ease'
  })
};

/**
 * Agent Active Manager メインコンポーネント
 */
function AgentActiveManagerPane() {
  const busyBySession = useValue(host.state.busyBySession) || {};
  const focusedProfileAtom = host.state.focusedSessionProfile || host.state.profile;
  const focusedProfileName = useValue(focusedProfileAtom) || 'default';

  // プール設定・状態
  const [poolLimits, setPoolLimits] = useState({ maxBackends: 3, idleMs: 600000 });
  const [roster, setRoster] = useState([]);
  const [sessionBotMap, setSessionBotMap] = useState({});
  const [agentStatus, setAgentStatus] = useState({}); // { [botName]: { status, toolName, start, lastActive } }
  const [lastInferenceMap, setLastInferenceMap] = useState({}); // { [botName]: { completedAt, duration, summary } }
  const [runningProfiles, setRunningProfiles] = useState(new Set()); // 過去4分以内にアクティブなプロファイル
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchFeedback, setSwitchFeedback] = useState(null);

  // 全枠ビジー時の安全確認モーダル
  const [pendingSwitchTarget, setPendingSwitchTarget] = useState(null);

  const rosterRef = useRef([]);
  const sessionBotMapRef = useRef({});
  const agentStatusRef = useRef({});
  const lastActiveRef = useRef({});

  // 1. プール制限設定の読み込み
  const fetchPoolLimits = async () => {
    try {
      if (typeof window !== 'undefined' && window.hermesDesktop?.getPoolLimits) {
        const limits = await window.hermesDesktop.getPoolLimits();
        if (limits && typeof limits.maxBackends === 'number') {
          setPoolLimits(limits);
        }
      }
    } catch (err) {
      console.debug('[AgentActiveManager] getPoolLimits error:', err);
    }
  };

  useEffect(() => {
    fetchPoolLimits();
    const interval = setInterval(fetchPoolLimits, 4000);
    return () => clearInterval(interval);
  }, []);

  // 2. プロファイル一覧とセッション情報の同期
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

        // セッションマップ更新（バックエンドは起動させず profiles.list の情報のみ使用）
        const mapUpdate = {};
        for (const p of sorted) {
          const botName = p.name;
          const cs = p.canonical_session || p.last_session;
          const csId = cs?.resolved_id || cs?.id;
          if (csId) {
            mapUpdate[csId] = botName;
          }
        }
        sessionBotMapRef.current = { ...sessionBotMapRef.current, ...mapUpdate };
        setSessionBotMap((prev) => ({ ...prev, ...mapUpdate }));
      } catch (err) {
        console.debug('[AgentActiveManager] syncRoster error:', err);
      }
    };

    syncRoster();
    const interval = setInterval(syncRoster, 8000);
    return () => { isMounted = false; clearInterval(interval); };
  }, []);

  // 3. Gatewayイベントの監視（推論状態と直前の推論履歴）
  useEffect(() => {
    let unsubscribe;
    try {
      if (typeof host?.onEvent === 'function') {
        unsubscribe = host.onEvent('*', (event) => {
          if (!event) return;
          const eventType = (event.type || event.event || '').toLowerCase();
          const payload = event.payload ?? event.data ?? event.message ?? event;
          const rawProfile = extractProfile(event, payload, rosterRef.current, sessionBotMapRef.current);
          if (!rawProfile) return;

          const now = Date.now();
          lastActiveRef.current[rawProfile] = now;

          // 稼働中セットに追加
          setRunningProfiles((prev) => {
            const next = new Set(prev);
            next.add(rawProfile);
            return next;
          });

          const isToolResult = matchAny(eventType, ['tool_result', 'tool.result', 'tool_output', 'tool_response']) || Boolean(payload?.tool_result);
          const isToolCall = !isToolResult && (matchAny(eventType, ['tool_call', 'tool.start', 'tool_start', 'tool', 'exec']) || Boolean(payload?.tool || payload?.tool_call));
          const isThinking = !isToolCall && !isToolResult && (matchAny(eventType, ['reason', 'think', 'thought', 'turn.start']) || Boolean(payload?.reasoning));
          const isGenerating = !isToolCall && !isToolResult && !isThinking && (matchAny(eventType, ['stream', 'delta', 'message']) || Boolean(payload?.text));
          const isFinished = matchAny(eventType, ['turn.finish', 'turn.end', 'turn.complete', 'session.idle']);

          const toolName = (isToolCall || isToolResult)
            ? (payload?.tool?.name || payload?.tool || payload?.name || 'tool')
            : '';

          if (isFinished) {
            const prev = agentStatusRef.current[rawProfile];
            const startT = prev?.start || (now - 2000);
            const duration = Math.max(1, Math.round((now - startT) / 1000));

            // 直前推論履歴に記録
            setLastInferenceMap((prevMap) => ({
              ...prevMap,
              [rawProfile]: {
                completedAt: now,
                duration,
                summary: prev?.toolName ? `ツール実行 (${prev.toolName})` : '思考・回答完了'
              }
            }));

            delete agentStatusRef.current[rawProfile];
            setAgentStatus((prev) => {
              const updated = { ...prev };
              delete updated[rawProfile];
              return updated;
            });
          } else if (isToolResult) {
            agentStatusRef.current[rawProfile] = {
              status: 'tool_completed',
              toolName: toolName || 'tool',
              start: agentStatusRef.current[rawProfile]?.start || now,
              lastActive: now
            };
            setAgentStatus({ ...agentStatusRef.current });
          } else if (isToolCall) {
            agentStatusRef.current[rawProfile] = {
              status: 'tool',
              toolName: toolName || 'tool',
              start: agentStatusRef.current[rawProfile]?.start || now,
              lastActive: now
            };
            setAgentStatus({ ...agentStatusRef.current });
          } else if (isThinking || isGenerating) {
            agentStatusRef.current[rawProfile] = {
              status: isThinking ? 'thinking' : 'generating',
              toolName: '',
              start: agentStatusRef.current[rawProfile]?.start || now,
              lastActive: now
            };
            setAgentStatus({ ...agentStatusRef.current });
          }
        });
      }
    } catch (err) {
      console.error('[AgentActiveManager] onEvent error:', err);
    }
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, []);

  // 4. 定期クリーンアップ（設定された idleMs 以上アクティブがないバックエンドを待機扱いに）
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const idleThreshold = Math.max(60000, poolLimits.idleMs || 120000);
      setRunningProfiles((prev) => {
        let changed = false;
        const next = new Set();
        for (const p of prev) {
          const last = lastActiveRef.current[p] || 0;
          if (now - last < idleThreshold || p === focusedProfileName) {
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

  // フォーカス中のプロファイルは常に稼働セットに含める
  useEffect(() => {
    if (focusedProfileName) {
      lastActiveRef.current[focusedProfileName] = Date.now();
      setRunningProfiles((prev) => {
        const next = new Set(prev);
        next.add(focusedProfileName);
        return next;
      });
    }
  }, [focusedProfileName]);

  // 稼働状況サマリーの算出
  const runningList = useMemo(() => Array.from(runningProfiles), [runningProfiles]);
  const busyProfiles = useMemo(() => {
    return runningList.filter((name) => {
      const st = agentStatus[name];
      if (st && st.status !== 'tool_completed') return true;
      // セッション単位のビジー状態もチェック
      for (const [sid, bot] of Object.entries(sessionBotMap)) {
        if (bot === name && busyBySession[sid]) return true;
      }
      return false;
    });
  }, [runningList, agentStatus, sessionBotMap, busyBySession]);

  const maxBackends = poolLimits.maxBackends || 3;
  const runningCount = runningList.length;
  const isFull = runningCount >= maxBackends;
  const allRunningAreBusy = isFull && (busyProfiles.length >= runningCount);

  // 5. プロファイル切り替えの実行
  const performSwitch = async (targetBot, options = { expandSlot: false }) => {
    setIsSwitching(true);
    setSwitchFeedback(`"${targetBot}" へ切り替え中...`);

    try {
      // 一時スロット拡張が指示された場合
      if (options.expandSlot && typeof window !== 'undefined' && window.hermesDesktop?.setPoolLimits) {
        const newMax = maxBackends + 1;
        setSwitchFeedback(`スロット枠を一時的に ${newMax} に拡張中...`);
        await window.hermesDesktop.setPoolLimits({ maxBackends: newMax });
        setPoolLimits((prev) => ({ ...prev, maxBackends: newMax }));
      }

      // セッション解決
      const matched = (rosterRef.current || []).find((p) => p.name === targetBot);
      let targetSessionId = matched?.canonical_session?.resolved_id || matched?.canonical_session?.id ||
                            matched?.last_session?.resolved_id || matched?.last_session?.id;

      if (!targetSessionId) {
        const fetchSess = typeof host?.requestProfile === 'function'
          ? host.requestProfile(targetBot, 'session.list', { limit: 3, include_hidden: true })
          : host.request('session.list', { profile: targetBot, limit: 3, include_hidden: true });
        const sessRes = await fetchSess.catch(() => null);
        targetSessionId = sessRes?.sessions?.[0]?.id;
      }

      if (!targetSessionId) {
        const createSess = typeof host?.requestProfile === 'function'
          ? host.requestProfile(targetBot, 'session.create', {})
          : host.request('session.create', { profile: targetBot });
        const createRes = await createSess.catch(() => null);
        targetSessionId = createRes?.session?.id || createRes?.id;
      }

      if (targetSessionId) {
        if (typeof host?.ensureAgent === 'function') await host.ensureAgent(targetSessionId, targetBot).catch(() => {});
        if (typeof host?.switchSession === 'function') {
          try {
            await host.switchSession(targetSessionId, { targetProfile: targetBot });
          } catch (_) {
            if (typeof host?.navigate === 'function') host.navigate(`/${targetSessionId}`);
          }
        } else if (typeof host?.navigate === 'function') {
          host.navigate(`/${targetSessionId}`);
        } else if (typeof window !== 'undefined') {
          window.location.hash = `#/${targetSessionId}`;
        }
      } else {
        if (typeof host?.ensureAgent === 'function') await host.ensureAgent(null, targetBot).catch(() => {});
        if (typeof host?.navigate === 'function') host.navigate('/');
      }

      lastActiveRef.current[targetBot] = Date.now();
      setRunningProfiles((prev) => new Set([...prev, targetBot]));
      setSwitchFeedback(`✅ "${targetBot}" に安全に切り替えました`);
      setTimeout(() => setSwitchFeedback(null), 3000);
    } catch (err) {
      console.error('[AgentActiveManager] performSwitch error:', err);
      setSwitchFeedback(`❌ 切り替え失敗: ${err?.message || err}`);
      setTimeout(() => setSwitchFeedback(null), 5000);
    } finally {
      setIsSwitching(false);
      setPendingSwitchTarget(null);
    }
  };

  // 切り替えボタンクリック時の安全判定
  const handleRequestSwitch = (targetBot) => {
    if (targetBot === focusedProfileName) return;

    // ターゲットがすでに起動している、またはスロットに空きがある場合はそのまま切り替え
    const isAlreadyRunning = runningProfiles.has(targetBot);
    if (isAlreadyRunning || runningCount < maxBackends) {
      performSwitch(targetBot, { expandSlot: false });
      return;
    }

    // スロットが満杯で、かつ稼働中の全エージェントが推論・作業中の場合
    if (allRunningAreBusy) {
      setPendingSwitchTarget(targetBot);
      return;
    }

    // スロットは満杯だがアイドル中のエージェントがいる場合
    // タイムアウトを確実に回避するため、スロット拡張または安全切り替えを行う
    performSwitch(targetBot, { expandSlot: false });
  };

  // アイドルタイムアウトの即時変更
  const handleChangeIdleMs = async (ms) => {
    try {
      if (typeof window !== 'undefined' && window.hermesDesktop?.setPoolLimits) {
        await window.hermesDesktop.setPoolLimits({ idleMs: ms });
        setPoolLimits((prev) => ({ ...prev, idleMs: ms }));
        if (typeof host?.notify === 'function') {
          host.notify(`アイドル解放時間を ${Math.round(ms / 60000)}分 に設定しました`);
        }
      }
    } catch (err) {
      console.error('[AgentActiveManager] setPoolLimits idleMs error:', err);
    }
  };

  // スロット枠上限の変更
  const handleChangeMaxBackends = async (delta) => {
    const nextVal = Math.max(1, Math.min(16, maxBackends + delta));
    try {
      if (typeof window !== 'undefined' && window.hermesDesktop?.setPoolLimits) {
        await window.hermesDesktop.setPoolLimits({ maxBackends: nextVal });
        setPoolLimits((prev) => ({ ...prev, maxBackends: nextVal }));
      }
    } catch (err) {
      console.error('[AgentActiveManager] setPoolLimits maxBackends error:', err);
    }
  };

  const usagePct = Math.round((runningCount / maxBackends) * 100);

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
                children: [
                  jsx('span', { children: '⚡' }),
                  jsx('span', { children: 'BACKEND SLOT POOL' })
                ]
              }),
              jsxs('div', {
                style: { display: 'flex', alignItems: 'center', gap: '4px' },
                children: [
                  jsx('span', {
                    style: S.badge(isFull ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)', isFull ? '#ef4444' : '#10b981'),
                    children: `${runningCount} / ${maxBackends} 枠使用中`
                  }),
                  jsx('button', {
                    onClick: () => handleChangeMaxBackends(1),
                    title: 'スロット枠を+1増やす',
                    style: { ...S.button('secondary'), padding: '2px 6px', fontSize: '10px' },
                    children: '+1'
                  }),
                  maxBackends > 1 && jsx('button', {
                    onClick: () => handleChangeMaxBackends(-1),
                    title: 'スロット枠を-1減らす',
                    style: { ...S.button('secondary'), padding: '2px 6px', fontSize: '10px' },
                    children: '-1'
                  })
                ]
              })
            ]
          }),

          // ゲージバー
          jsx('div', {
            style: S.progressTrack,
            children: jsx('div', { style: S.progressBar(usagePct, isFull) })
          }),

          // アイドル時間調整 & 説明
          jsxs('div', {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: '#6b7280', marginTop: '4px' },
            children: [
              jsx('span', { children: `自動解放: ${Math.round(poolLimits.idleMs / 60000)}分後に退避` }),
              jsxs('div', {
                style: { display: 'flex', gap: '4px' },
                children: [
                  jsx('button', {
                    onClick: () => handleChangeIdleMs(120000),
                    style: { ...S.button('secondary'), padding: '1px 5px', fontSize: '9px', fontWeight: poolLimits.idleMs === 120000 ? '700' : '400' },
                    children: '2分'
                  }),
                  jsx('button', {
                    onClick: () => handleChangeIdleMs(300000),
                    style: { ...S.button('secondary'), padding: '1px 5px', fontSize: '9px', fontWeight: poolLimits.idleMs === 300000 ? '700' : '400' },
                    children: '5分'
                  }),
                  jsx('button', {
                    onClick: () => handleChangeIdleMs(600000),
                    style: { ...S.button('secondary'), padding: '1px 5px', fontSize: '9px', fontWeight: poolLimits.idleMs === 600000 ? '700' : '400' },
                    children: '10分'
                  })
                ]
              })
            ]
          }),

          // フィードバックトースト
          switchFeedback && jsx('div', {
            style: {
              marginTop: '8px',
              padding: '6px 8px',
              borderRadius: '6px',
              backgroundColor: switchFeedback.includes('❌') ? 'rgba(239, 68, 68, 0.1)' : 'rgba(79, 70, 229, 0.1)',
              color: switchFeedback.includes('❌') ? '#ef4444' : '#4f46e5',
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
                style: { ...S.title, color: '#374151' },
                children: [
                  jsx('span', { children: '🤖' }),
                  jsx('span', { children: 'AGENTS & INFERENCE STATE' })
                ]
              }),
              jsx('span', {
                style: { fontSize: '10px', color: '#9ca3af' },
                children: busyProfiles.length > 0 ? `${busyProfiles.length}体 作業中` : '全エージェント待機中'
              })
            ]
          }),

          jsxs('div', {
            style: { display: 'flex', flexDirection: 'column', gap: '8px' },
            children: roster.map((bot) => {
              const botName = bot.name;
              const isFocused = focusedProfileName === botName;
              const isRunning = runningProfiles.has(botName);
              const curStatus = agentStatus[botName];
              const isBusy = (curStatus && curStatus.status !== 'tool_completed') ||
                             Object.entries(sessionBotMap).some(([sid, b]) => b === botName && busyBySession[sid]);
              const lastInference = lastInferenceMap[botName];

              let statusLabel = '待機中 (未起動)';
              let statusBg = 'rgba(156, 163, 175, 0.1)';
              let statusColor = '#6b7280';

              if (isBusy) {
                statusLabel = curStatus?.toolName ? `⚡ ツール実行中 (${curStatus.toolName})` : '🧠 推論・生成中';
                statusBg = 'rgba(245, 158, 11, 0.15)';
                statusColor = '#d97706';
              } else if (isRunning) {
                statusLabel = '💤 アイドル (常駐中)';
                statusBg = 'rgba(16, 185, 129, 0.15)';
                statusColor = '#10b981';
              }

              return jsxs('div', {
                key: botName,
                style: {
                  padding: '9px 10px',
                  borderRadius: '8px',
                  backgroundColor: isFocused ? 'rgba(79, 70, 229, 0.06)' : 'rgba(0, 0, 0, 0.02)',
                  border: isFocused ? '1px solid rgba(79, 70, 229, 0.3)' : '1px solid rgba(0, 0, 0, 0.05)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '5px'
                },
                children: [
                  // 1行目: プロファイル名 + 状態バッジ + 切り替えボタン
                  jsxs('div', {
                    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
                    children: [
                      jsxs('div', {
                        style: { display: 'flex', alignItems: 'center', gap: '6px' },
                        children: [
                          jsx('span', { style: { fontWeight: '700', fontSize: '12px' }, children: bot.display_name || botName }),
                          isFocused && jsx('span', { style: S.badge('rgba(79, 70, 229, 0.15)', '#4f46e5'), children: '表示中' }),
                          jsx('span', { style: S.badge(statusBg, statusColor), children: statusLabel })
                        ]
                      }),
                      !isFocused && jsx('button', {
                        disabled: isSwitching,
                        onClick: () => handleRequestSwitch(botName),
                        style: S.button(isRunning ? 'secondary' : 'primary'),
                        children: isRunning ? '開く' : '安全に切り替え ➔'
                      })
                    ]
                  }),

                  // 2行目: 直前の推論履歴情報
                  jsxs('div', {
                    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10.5px', color: '#6b7280', marginTop: '1px' },
                    children: [
                      jsx('span', {
                        children: isBusy
                          ? '⏳ 現在リアルタイムでタスクを実行中'
                          : lastInference
                            ? `⏱ 直前の推論: ${formatRelativeTime(lastInference.completedAt)} (${lastInference.duration}秒 / ${lastInference.summary})`
                            : '⏱ 直前の推論: 記録なし (待機中)'
                      }),
                      isRunning && !isBusy && jsx('span', {
                        style: { color: '#059669', fontWeight: '500' },
                        children: '退避可能'
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
                jsx('h3', { style: { margin: 0, fontSize: '14px', fontWeight: '700', color: '#b45309' }, children: '全エージェントが作業・推論中です' })
              ]
            }),
            jsxs('p', {
              style: { fontSize: '12px', lineHeight: '1.5', color: '#4b5563', margin: '0 0 12px 0' },
              children: [
                `現在起動中のすべてのスロット（${maxBackends}枠）でエージェントが推論やツールを実行しています。`,
                jsx('br', {}),
                'このまま切り替えると、実行中のタスクが中断したり、スロット待ちでタイムアウト（エラー）になる可能性があります。'
              ]
            }),

            // 作業中エージェントの一覧
            jsx('div', {
              style: { backgroundColor: 'rgba(0, 0, 0, 0.04)', borderRadius: '6px', padding: '8px 10px', marginBottom: '14px' },
              children: jsxs('div', {
                style: { fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '4px' },
                children: [
                  jsx('span', { style: { fontWeight: '600', color: '#374151' }, children: '現在実行中のエージェント:' }),
                  busyProfiles.map((bName) => {
                    const st = agentStatus[bName];
                    const elapsed = st?.start ? Math.max(1, Math.round((Date.now() - st.start) / 1000)) : 0;
                    return jsxs('div', {
                      key: bName,
                      style: { display: 'flex', justifyContent: 'space-between', color: '#6b7280' },
                      children: [
                        jsx('span', { children: `・${bName}` }),
                        jsx('span', { style: { color: '#d97706', fontWeight: '600' }, children: st?.toolName ? `ツール実行中 (${elapsed}s)` : `推論中 (${elapsed}s)` })
                      ]
                    });
                  })
                ]
              })
            }),

            // アクションボタン
            jsxs('div', {
              style: { display: 'flex', flexDirection: 'column', gap: '6px' },
              children: [
                jsx('button', {
                  onClick: () => performSwitch(pendingSwitchTarget, { expandSlot: true }),
                  style: { ...S.button('primary'), justifyContent: 'center', padding: '8px' },
                  children: `一時的にスロットを+1拡張して安全に切り替える (${maxBackends} → ${maxBackends + 1})`
                }),
                jsx('button', {
                  onClick: () => performSwitch(pendingSwitchTarget, { expandSlot: false }),
                  style: { ...S.button('danger'), justifyContent: 'center', padding: '6px', fontSize: '10.5px' },
                  children: '強制的に切り替えを試みる（中断・タイムアウトのリスクあり）'
                }),
                jsx('button', {
                  onClick: () => setPendingSwitchTarget(null),
                  style: { ...S.button('secondary'), justifyContent: 'center', padding: '6px', marginTop: '4px' },
                  children: 'キャンセル（現在の作業完了を待つ）'
                })
              ]
            })
          ]
        })
      })
    ]
  });
}

// --- Hermes Desktop Plugin エクスポート ---
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

    if (typeof ctx.registerMany === 'function') {
      ctx.registerMany(entries);
    } else {
      entries.forEach((e) => ctx.register(e));
    }
  }
};
