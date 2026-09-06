import { host, useValue, PANES_AREA, ROUTES_AREA } from '@hermes/plugin-sdk';
import { jsx, jsxs } from 'react/jsx-runtime';
import React, { useState, useEffect, useRef } from 'react';

// マウスホバーによる勝手なプロファイル先行起動（Hover-intent prewarm）を完全抑止
if (typeof window !== 'undefined' && !window.__hermes_prewarm_blocked_v2) {
  window.__hermes_prewarm_blocked_v2 = true;

  const originalSetTimeout = window.setTimeout;
  window.setTimeout = function(fn, delay, ...args) {
    if (typeof fn === 'function' && delay === 120) {
      const fnStr = fn.toString();
      if (fnStr.includes('prewarmProfileBackend') || fnStr.includes('startPrewarm')) {
        return -1;
      }
    }
    return originalSetTimeout.call(this, fn, delay, ...args);
  };

  const isPrewarmElement = (el) => {
    if (!el || typeof el.closest !== 'function') return false;
    return Boolean(
      el.closest('[data-slot*="profile"]') ||
      el.closest('[data-tour*="profile"]') ||
      el.closest('aside') ||
      el.closest('nav') ||
      el.closest('[data-slot="sidebar"]') ||
      el.closest('[data-sidebar]') ||
      el.closest('[role="menu"]') ||
      el.closest('[role="menuitem"]') ||
      el.closest('[role="menuitemradio"]') ||
      el.closest('[data-radix-popper-content-wrapper]') ||
      el.closest('[data-radix-collection-item]') ||
      el.closest('[data-slot="session-row"]') ||
      el.closest('[data-roster-key]') ||
      el.closest('button[aria-label*="profile" i]') ||
      el.closest('button[aria-label*="Profile" i]')
    );
  };

  const blockPrewarm = (e) => {
    if (isPrewarmElement(e.target)) {
      e.stopImmediatePropagation();
    }
  };

  ['pointerenter', 'pointerover', 'mouseenter', 'mouseover'].forEach((type) => {
    window.addEventListener(type, blockPrewarm, true);
  });

  try {
    const patchSdk = () => {
      const sdk = window.__HERMES_PLUGIN_SDK__;
      if (sdk?.host) {
        sdk.host.warmProfile = () => {};
        sdk.host.warmAgent = () => {};
      }
    };
    patchSdk();
    setInterval(patchSdk, 2000);
  } catch (_) {}
}

// --- 共通ヘルパー & 設定 ---
const matchAny = (str, list) => typeof str === 'string' && list.some((k) => str.includes(k));

const STATUS_CONFIG = {
  thinking:       { color: '#8b5cf6', icon: '●',  pulse: '#8b5cf6', label: (e) => `● 推論中 (${e}s 経過)` },
  tool_start:     { color: '#f59e0b', icon: '🚀', pulse: '#f59e0b', label: (_, t) => `🚀 呼出: ${t || 'tool'}` },
  tool:           { color: '#8b5cf6', icon: '⚡', pulse: '#8b5cf6', label: (e, t) => `⚡ 実行中: ${t || 'tool'} (${e}s)` },
  tool_completed: { color: '#10b981', icon: '✅', pulse: '#10b981', label: (e, t, d) => `✅ 完了: ${t || 'tool'} (${d || e}s)` },
  generating:     { color: '#3b82f6', icon: '✍️', pulse: '#3b82f6', label: (e) => `✍️ 出力中 (${e}s 経過)` }
};

const getActivityTypeMeta = (type) => {
  const t = (type || '').toLowerCase();
  if (matchAny(t, ['tool_result', 'tool.result', 'tool_output'])) return { icon: '✅', color: '#10b981' };
  if (matchAny(t, ['tool_call', 'tool.start', 'tool_start'])) return { icon: '🚀', color: '#f59e0b' };
  if (matchAny(t, ['tool', 'exec', 'action'])) return { icon: '⚡', color: '#8b5cf6' };
  if (matchAny(t, ['reason', 'think', 'thought'])) return { icon: '🧠', color: '#8b5cf6' };
  return { icon: '💬', color: '#3b82f6' };
};

const extractProfile = (ev, p, roster, sMap) => {
  const direct = ev.profile || ev.agent || ev.bot || ev.speaker || ev.sender ||
                 p?.profile || p?.agent || p?.bot || p?.speaker || p?.member || p?.author || p?.sender || p?.role;
  if (direct && typeof direct === 'string' && direct.trim()) return direct.trim().toLowerCase();
  if (typeof p?.from === 'string') return p.from.trim().toLowerCase();
  if (p?.from?.name || p?.from?.profile) return (p.from.name || p.from.profile).trim().toLowerCase();

  const sid = ev.sessionId || ev.session_id || ev.session || ev.sid || p?.sessionId || p?.session_id;
  if (sid && sMap[sid]) return sMap[sid];

  return '';
};

// --- 共通スタイル ---
const S = {
  pane: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    boxSizing: 'border-box',
    background: 'transparent',
    color: 'inherit',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    fontSize: '12px',
    overflow: 'hidden'
  },
  flexRow: { display: 'flex', alignItems: 'center' },
  flexBetween: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  sectionHeader: {
    padding: '12px 14px 6px 14px',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    fontSize: '11px',
    fontWeight: '700',
    color: '#8e8e93'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    padding: '4px 8px',
    gap: '4px 6px'
  },
  card: (isFocused, isHovered) => ({
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '7px 8px',
    borderRadius: '8px',
    background: isFocused ? 'rgba(0, 0, 0, 0.08)' : isHovered ? 'rgba(0, 0, 0, 0.04)' : 'rgba(0, 0, 0, 0.02)',
    border: isFocused ? '1px solid rgba(0, 0, 0, 0.15)' : '1px solid rgba(0, 0, 0, 0.05)',
    cursor: 'pointer',
    transition: 'background 0.15s ease, border-color 0.15s ease',
    userSelect: 'none',
    minWidth: 0,
    overflow: 'hidden'
  }),
  tag: (bg, color) => ({
    fontSize: '8.5px',
    fontWeight: '600',
    padding: '1px 4px',
    borderRadius: '3px',
    background: bg,
    color: color,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '100%'
  }),
  filterBtn: (active) => ({
    background: active ? 'rgba(0, 0, 0, 0.08)' : 'transparent',
    color: active ? '#1c1c1e' : '#8e8e93',
    border: 'none',
    borderRadius: '4px',
    padding: '2px 6px',
    fontSize: '10px',
    fontWeight: active ? '600' : '500',
    cursor: 'pointer'
  })
};

const AVATAR_COLORS = ['#6366f1', '#ec4899', '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b'];

/**
 * Agent Activity Monitor コンポーネント
 */
function AgentActivityPane() {
  const busyBySession = useValue(host.state.busyBySession) || {};
  const focusedProfileAtom = host.state.focusedSessionProfile || host.state.profile;
  const focusedProfileName = useValue(focusedProfileAtom) || 'default';

  const [activities, setActivities] = useState([]);
  const [roster, setRoster] = useState([]);
  const [botAvatars, setBotAvatars] = useState({});
  const [botStates, setBotStates] = useState({});
  const [filter, setFilter] = useState('all');
  const [timers, setTimers] = useState({});
  const [hoveredBot, setHoveredBot] = useState(null);

  const timerRef = useRef({});
  const lastActiveMapRef = useRef({});
  const agentStatusMapRef = useRef({});
  const rosterRef = useRef([]);
  const sessionBotMapRef = useRef({});

  // 1. プロファイル一覧・アバター・セッションの同期
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

        for (const p of sorted) {
          const botName = p.name;
          if (!botName) continue;

          // アバター取得
          if ((p.has_avatar || p.avatar) && !botAvatars[botName]) {
            host.request('profiles.get_asset', { name: botName, asset: 'avatar' })
              .then((assetRes) => {
                if (assetRes?.found && assetRes?.data && isMounted) {
                  setBotAvatars((prev) => ({ ...prev, [botName]: assetRes.data }));
                }
              }).catch(() => {});
          }

          // profiles.list のメタデータから直接取得（バックエンドを起動させない）
          const cs = p.canonical_session || p.last_session;
          const csId = cs?.resolved_id || cs?.id;
          const title = cs?.title || '';
          const isTeam = title.toLowerCase().includes('group:');
          if (!isTeam && csId) {
            sessionBotMapRef.current[csId] = botName;
          }
          setBotStates((prev) => ({
            ...prev,
            [botName]: {
              model: p.model || cs?.model || '',
              provider: p.provider || cs?.provider || '',
              lastSessionId: csId,
              isTeam,
              title
            }
          }));
        }
      } catch (err) {
        console.debug('[AgentMonitor] sync error:', err);
      }
    };

    syncRoster();
    const interval = setInterval(syncRoster, 5000);
    return () => { isMounted = false; clearInterval(interval); };
  }, []);

  // 2. 稼働タイマー計算（1秒毎）
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const nextTimers = {};

      for (const bot of roster) {
        const botName = bot.name;
        const bState = botStates[botName] || {};
        const curStatus = agentStatusMapRef.current[botName];
        const lastActive = lastActiveMapRef.current[botName] || 0;

        const isToolCompleted = curStatus?.status === 'tool_completed' && (now - (curStatus.completedAt || 0) < 3000);
        const eventBusy = (now - lastActive < 15000) && Boolean(curStatus) && !curStatus.isFinished;
        const directSessBusy = (!bState.isTeam && bState.lastSessionId) ? Boolean(busyBySession[bState.lastSessionId]) : false;

        if (isToolCompleted) {
          nextTimers[botName] = {
            status: 'tool_completed',
            toolName: curStatus.toolName,
            duration: curStatus.duration,
            elapsed: curStatus.duration || 1
          };
        } else if (eventBusy) {
          const startTime = curStatus.start || now;
          nextTimers[botName] = {
            status: curStatus.status,
            toolName: curStatus.toolName,
            start: startTime,
            elapsed: Math.floor((now - startTime) / 1000)
          };
        } else if (directSessBusy) {
          const prev = timerRef.current[botName];
          const startTime = prev?.start || now;
          nextTimers[botName] = {
            status: prev?.status || 'thinking',
            toolName: prev?.toolName || '',
            start: startTime,
            elapsed: Math.floor((now - startTime) / 1000)
          };
        } else if (agentStatusMapRef.current[botName] && (now - lastActive >= 15000)) {
          delete agentStatusMapRef.current[botName];
        }
      }
      timerRef.current = nextTimers;
      setTimers({ ...nextTimers });
    }, 1000);

    return () => clearInterval(interval);
  }, [roster, botStates, busyBySession]);

  // 3. Gateway イベントのリアルタイム購読
  useEffect(() => {
    let unsubscribe;
    try {
      if (typeof host?.onEvent === 'function') {
        unsubscribe = host.onEvent('*', (event) => {
          if (!event) return;
          const timestamp = new Date().toLocaleTimeString('ja-JP', { hour12: false });
          const eventType = (event.type || event.event || 'gateway.event').toLowerCase();
          const payload = event.payload ?? event.data ?? event.message ?? event;

          // ノイズ除外（アクティビティのないシステム通知）
          if (matchAny(eventType, ['gateway.', 'sessions.', 'profiles.', 'skin.', 'theme.'])) {
            const hasActivity = payload?.text || payload?.content || payload?.delta || payload?.tool || payload?.error;
            if (!hasActivity) return;
          }

          const rawProfile = extractProfile(event, payload, rosterRef.current, sessionBotMapRef.current);
          const sid = event.sessionId || event.session_id || payload?.sessionId;

          let textChunk = typeof payload === 'string' ? payload : (payload?.text || (payload?.content ? (typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.content)) : ''));
          const isDelta = matchAny(eventType, ['delta', 'stream', 'chunk']);

          // イベント種別判定
          const isToolResult = matchAny(eventType, ['tool_result', 'tool.result', 'tool_output', 'tool_response']) || Boolean(payload?.tool_result) || payload?.role === 'tool';
          const isToolCall = !isToolResult && (matchAny(eventType, ['tool_call', 'tool.start', 'tool_start', 'tool', 'exec', 'action']) || Boolean(payload?.tool || payload?.tool_call || payload?.function));
          const toolName = (isToolCall || isToolResult) ? (payload?.tool?.name || payload?.tool || payload?.name || payload?.function?.name || payload?.action || payload?.tool_name || 'tool') : '';

          const isThinking = !isToolCall && !isToolResult && (matchAny(eventType, ['reason', 'think', 'thought', 'turn.start']) || Boolean(payload?.reasoning || payload?.thought));
          const isGenerating = !isToolCall && !isToolResult && !isThinking && (isDelta || matchAny(eventType, ['stream', 'chunk', 'message']) || Boolean(textChunk));
          const isFinished = matchAny(eventType, ['turn.finish', 'turn.end', 'turn.complete', 'chat.complete', 'session.idle']) || eventType.endsWith('.finish') || eventType.endsWith('.complete');

          const now = Date.now();
          if (rawProfile) {
            if (isFinished) {
              lastActiveMapRef.current[rawProfile] = 0;
              delete agentStatusMapRef.current[rawProfile];
            } else if (isToolResult) {
              lastActiveMapRef.current[rawProfile] = now;
              const prev = agentStatusMapRef.current[rawProfile];
              const startT = prev?.start || (now - 1000);
              agentStatusMapRef.current[rawProfile] = {
                status: 'tool_completed',
                toolName: toolName || prev?.toolName || 'tool',
                start: startT,
                duration: Math.max(1, Math.round((now - startT) / 1000)),
                completedAt: now,
                lastActive: now
              };
            } else if (isToolCall) {
              lastActiveMapRef.current[rawProfile] = now;
              const prev = agentStatusMapRef.current[rawProfile];
              agentStatusMapRef.current[rawProfile] = {
                status: (!prev || prev.status !== 'tool') ? 'tool_start' : 'tool',
                toolName: toolName || prev?.toolName || 'tool',
                start: prev?.start || now,
                lastActive: now
              };
            } else if (isThinking || isGenerating) {
              lastActiveMapRef.current[rawProfile] = now;
              const prev = agentStatusMapRef.current[rawProfile];
              if (!prev || prev.status !== 'tool_completed' || (now - (prev.completedAt || 0) > 2000)) {
                agentStatusMapRef.current[rawProfile] = {
                  status: isThinking ? 'thinking' : 'generating',
                  toolName: '',
                  start: prev?.start || now,
                  lastActive: now
                };
              }
            }
          }

          // ログ詳細文字列の構築
          let detailStr = textChunk || (typeof payload === 'object' ? JSON.stringify(payload, null, 2) : String(payload));
          if (!detailStr || detailStr.trim() === '{}' || detailStr === 'null') return;

          setActivities((prev) => {
            const last = prev[0];
            if (isDelta && last && last.type === eventType && last.profile === rawProfile && textChunk) {
              return [{ ...last, time: timestamp, detail: last.detail + textChunk }, ...prev.slice(1)];
            }
            return [{
              id: `${Date.now()}-${Math.random().toString(36).substr(2, 7)}`,
              time: timestamp,
              type: eventType,
              sessionId: sid,
              profile: rawProfile,
              detail: detailStr
            }, ...prev.slice(0, 99)];
          });
        });
      }
    } catch (err) {
      console.error('[AgentMonitor] host.onEvent error:', err);
    }
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, []);

  // 4. エージェントクリック時の遷移
  const handleAgentClick = async (botName) => {
    try {
      const targetBot = botName || 'default';
      const matched = (rosterRef.current || []).find((p) => p.name === targetBot);
      let targetSessionId = matched?.canonical_session?.resolved_id || matched?.canonical_session?.id ||
                            matched?.last_session?.resolved_id || matched?.last_session?.id ||
                            botStates[targetBot]?.lastSessionId;

      if (!targetSessionId) {
        const fetchSess = typeof host?.requestProfile === 'function'
          ? host.requestProfile(targetBot, 'session.list', { limit: 5, include_hidden: true })
          : host.request('session.list', { profile: targetBot, limit: 5, include_hidden: true });
        const sessRes = await fetchSess.catch(() => null);
        const nonTeam = (sessRes?.sessions || []).find((s) => !(s.title || '').toLowerCase().includes('group:'));
        targetSessionId = nonTeam?.id;
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
          try { await host.switchSession(targetSessionId, { targetProfile: targetBot }); return; } catch (_) {}
        }
        if (typeof host?.navigate === 'function') host.navigate(`/${targetSessionId}`);
        else if (typeof window !== 'undefined') window.location.hash = `#/${targetSessionId}`;
      } else {
        if (typeof host?.ensureAgent === 'function') await host.ensureAgent(null, targetBot).catch(() => {});
        if (typeof host?.navigate === 'function') host.navigate('/');
        else if (typeof window !== 'undefined') window.location.hash = '#/';
      }
    } catch (err) {
      console.error('[AgentMonitor] handleAgentClick error:', err);
    }
  };

  const activeCount = Object.keys(timers).length;
  const filteredActivities = activities.filter((act) => {
    if (filter === 'all') return true;
    if (filter === 'busy') return matchAny(act.type?.toLowerCase() || '', ['think', 'reason', 'tool', 'run', 'step', 'turn', 'delta', 'stream']);
    return act.type?.toLowerCase().includes(filter);
  });

  return jsxs('div', {
    style: S.pane,
    children: [
      // 1. セクションヘッダー
      jsxs('div', {
        style: { ...S.flexBetween, ...S.sectionHeader },
        children: [
          jsxs('div', {
            style: { ...S.flexRow, gap: '6px' },
            children: [
              jsx('span', {
                style: {
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  backgroundColor: activeCount > 0 ? '#10b981' : '#c7c7cc',
                  boxShadow: activeCount > 0 ? '0 0 6px rgba(16, 185, 129, 0.6)' : 'none'
                }
              }),
              jsx('span', { children: 'AGENT ACTIVITY' })
            ]
          }),
          jsx('span', {
            style: { fontSize: '10px', fontWeight: '500', color: activeCount > 0 ? '#10b981' : '#8e8e93' },
            children: activeCount > 0 ? `${activeCount} 稼働中` : 'Idle'
          })
        ]
      }),

      // 2. エージェント一覧（2カラムグリッド）
      jsx('div', {
        style: S.grid,
        children: roster.map((bot, index) => {
          const botName = bot.name;
          const timerInfo = timers[botName];
          const isBusy = Boolean(timerInfo);
          const elapsed = timerInfo?.elapsed || 0;
          const statusType = timerInfo?.status || 'idle';
          const cfg = STATUS_CONFIG[statusType];
          const isFocused = focusedProfileName === botName;
          const bState = botStates[botName] || {};

          let displayName = bot.display_name || bot.name || 'Agent';
          displayName = displayName.toLowerCase() === 'default' ? 'Hermes' : displayName.charAt(0).toUpperCase() + displayName.slice(1);

          const rawModel = bState.model || bot.model || '';
          const parts = rawModel.split('/');
          const providerName = bState.provider || (parts.length > 1 ? parts[0] : '');
          const modelName = (parts.length > 1 ? parts[parts.length - 1] : rawModel).replace(/:free$/i, '');

          const avatarImg = botAvatars[botName];
          const avatarBg = AVATAR_COLORS[index % AVATAR_COLORS.length];
          const pulseColor = cfg?.pulse || avatarBg;
          const statusLabel = cfg ? cfg.label(elapsed, timerInfo?.toolName, timerInfo?.duration) : '';

          return jsxs('div', {
            key: botName,
            onClick: () => handleAgentClick(botName),
            onMouseEnter: () => setHoveredBot(botName),
            onMouseLeave: () => setHoveredBot(null),
            title: `${displayName} (${providerName ? providerName + '/' : ''}${modelName || 'default'})`,
            style: S.card(isFocused, hoveredBot === botName),
            children: [
              // 1行目: アバター + 指示元バッジ + ピン留め + タイマー
              jsxs('div', {
                style: { ...S.flexBetween, gap: '5px' },
                children: [
                  jsxs('div', {
                    style: { ...S.flexRow, gap: '5px' },
                    children: [
                      jsxs('div', {
                        style: {
                          position: 'relative',
                          width: '24px',
                          height: '24px',
                          borderRadius: '50%',
                          background: isBusy ? pulseColor : avatarBg,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          fontWeight: '600',
                          fontSize: '10px',
                          flexShrink: 0
                        },
                        children: [
                          avatarImg
                            ? jsx('img', { src: avatarImg, alt: displayName, style: { width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' } })
                            : jsx('span', { children: isBusy ? (cfg?.icon || '⚡') : (displayName.charAt(0).toUpperCase()) }),
                          jsx('span', {
                            style: {
                              position: 'absolute',
                              bottom: '-1px',
                              right: '-1px',
                              width: '7px',
                              height: '7px',
                              borderRadius: '50%',
                              backgroundColor: isBusy ? pulseColor : '#c7c7cc',
                              border: '1.5px solid #ffffff',
                              boxShadow: isBusy ? `0 0 5px ${pulseColor}` : 'none'
                            }
                          })
                        ]
                      }),
                      jsx('span', {
                        style: {
                          fontSize: '11px',
                          fontWeight: '600',
                          color: '#1c1c1e',
                          maxWidth: '75px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        },
                        children: displayName
                      }),
                      jsx('span', {
                        style: S.tag(
                          bState.isTeam ? 'rgba(139, 92, 246, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                          bState.isTeam ? '#8b5cf6' : '#10b981'
                        ),
                        children: bState.isTeam ? 'Team' : 'Direct'
                      }),
                      isFocused && jsx('span', { style: { fontSize: '10px' }, children: '📌' })
                    ]
                  }),
                  jsx('span', {
                    style: {
                      fontSize: '9px',
                      color: isBusy ? cfg?.color : '#8e8e93',
                      fontWeight: isBusy ? '600' : '400',
                      padding: isBusy ? '1px 4px' : '0',
                      borderRadius: '3px',
                      backgroundColor: isBusy ? 'rgba(0, 0, 0, 0.05)' : 'transparent'
                    },
                    children: isBusy ? `${elapsed}s` : 'idle'
                  })
                ]
              }),

              // 2行目: ステータスラベル
              statusLabel && jsx('div', {
                style: { fontSize: '10px', color: cfg?.color, fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
                children: statusLabel
              }),

              // 3行目: プロバイダー & モデル
              jsxs('div', {
                style: { ...S.flexRow, gap: '3px', flexWrap: 'wrap', marginTop: '1px' },
                children: [
                  providerName && jsx('span', { style: S.tag('rgba(0, 0, 0, 0.05)', '#5c5c60'), children: providerName }),
                  modelName && jsx('span', { style: S.tag('rgba(99, 102, 241, 0.08)', '#6366f1'), children: modelName })
                ]
              })
            ]
          });
        })
      }),

      // セパレータ
      jsx('div', { style: { height: '1px', background: 'rgba(0, 0, 0, 0.06)', margin: '8px 12px' } }),

      // 3. ログヘッダー
      jsxs('div', {
        style: { ...S.flexBetween, padding: '4px 14px 6px 14px' },
        children: [
          jsx('span', { style: { fontSize: '11px', fontWeight: '700', color: '#8e8e93', letterSpacing: '0.06em' }, children: 'LIVE EVENTS' }),
          jsxs('div', {
            style: { ...S.flexRow, gap: '4px' },
            children: [
              jsx('button', { onClick: () => setFilter('all'), style: S.filterBtn(filter === 'all'), children: 'すべて' }),
              jsx('button', { onClick: () => setFilter('busy'), style: S.filterBtn(filter === 'busy'), children: '推論/ツール' }),
              jsx('button', { onClick: () => setActivities([]), style: { background: 'transparent', color: '#c7c7cc', border: 'none', padding: '2px 4px', fontSize: '10px', cursor: 'pointer' }, children: '✕' })
            ]
          })
        ]
      }),

      // 4. ログ一覧
      jsx('div', {
        style: { flex: 1, overflowY: 'auto', padding: '4px 10px', display: 'flex', flexDirection: 'column', gap: '6px' },
        children: filteredActivities.length === 0
          ? jsxs('div', {
              style: { color: '#8e8e93', fontSize: '11px', textAlign: 'center', padding: '28px 16px', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' },
              children: [
                jsx('span', { style: { fontSize: '18px' }, children: '📡' }),
                jsx('span', { style: { fontWeight: '500' }, children: 'イベント待機中' }),
                jsx('span', { style: { fontSize: '10px', color: '#aeaeaf', lineHeight: '1.4' }, children: 'エージェントが思考やツール実行を行うと、ここにリアルタイムログが流れます' })
              ]
            })
          : filteredActivities.map((act) => {
              const meta = getActivityTypeMeta(act.type);
              return jsxs('div', {
                key: act.id,
                style: { padding: '7px 9px', borderRadius: '6px', background: 'rgba(0, 0, 0, 0.03)', border: '1px solid rgba(0, 0, 0, 0.05)', fontSize: '11px' },
                children: [
                  jsxs('div', {
                    style: { ...S.flexBetween, marginBottom: '4px' },
                    children: [
                      jsxs('span', {
                        style: { fontWeight: '600', fontSize: '10px', color: meta.color, ...S.flexRow, gap: '4px' },
                        children: [jsx('span', { children: meta.icon }), act.type]
                      }),
                      jsx('span', { style: { color: '#8e8e93', fontSize: '9px' }, children: act.time })
                    ]
                  }),
                  jsx('div', {
                    style: { margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace', fontSize: '11px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#2c2c2e', lineHeight: '1.4' },
                    children: act.detail
                  })
                ]
              });
            })
      })
    ]
  });
}

// --- Hermes Plugin Export ---
const PANES = PANES_AREA || 'panes';
const ROUTES = ROUTES_AREA || 'routes';

export default {
  id: 'agent-monitor',
  name: 'Agent Activity Monitor',
  description: 'Real-time activity and thinking monitor for Hermes Agent bots.',
  defaultEnabled: true,
  register(ctx) {
    const entries = [
      {
        id: 'agent-monitor-pane',
        area: PANES,
        title: 'Agent Monitor',
        data: { placement: 'right', defaultOpen: true, width: '320px' },
        render: () => jsx(AgentActivityPane, {})
      },
      {
        id: 'agent-monitor-route',
        area: ROUTES,
        data: { path: '/agent-monitor', title: 'Agent Monitor' },
        render: () => jsx(AgentActivityPane, {})
      }
    ];

    if (typeof ctx.registerMany === 'function') {
      ctx.registerMany(entries);
    } else {
      entries.forEach((e) => ctx.register(e));
    }
  }
};
