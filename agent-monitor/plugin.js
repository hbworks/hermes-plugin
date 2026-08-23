import { host, useValue } from '@hermes/plugin-sdk';
import { jsx, jsxs } from 'react/jsx-runtime';
import React, { useState, useEffect, useRef } from 'react';

/**
 * Agent Activity Monitor コンポーネント
 * Hermes Desktop のネイティブUIに合わせたライト/システムテーマ追従デザイン
 */
function AgentActivityPane() {
  const busyBySession = useValue(host.state.busyBySession) || {};
  const focusedSessionId = useValue(host.state.focusedSessionId);
  const focusedProfileAtom = host.state.focusedSessionProfile || host.state.profile;
  const focusedProfileName = useValue(focusedProfileAtom) || 'default';
  
  const [activities, setActivities] = useState([]);
  const [sessionMeta, setSessionMeta] = useState({});
  const [botProfiles, setBotProfiles] = useState({});
  const [botAvatars, setBotAvatars] = useState({});
  const [filter, setFilter] = useState('all');
  const [timers, setTimers] = useState({});
  const timerRef = useRef({});

  // 1. プロファイル（ボット）一覧、アバター画像、各ボットのセッション一覧の取得
  useEffect(() => {
    let isMounted = true;

    const syncRosterAndSessions = async () => {
      try {
        if (typeof host?.request !== 'function') return;

        // 全プロファイルの取得
        const res = await host.request('profiles.list', {});
        const profiles = Array.isArray(res?.profiles) ? res.profiles : [];
        if (!isMounted) return;

        const pMap = {};
        for (const p of profiles) {
          if (p?.name) {
            pMap[p.name] = p;
            if (p.last_session) {
              pMap[p.last_session] = p;
            }
          }
        }

        // 各ボットのアバター画像とセッションリストを取得
        for (const p of profiles) {
          const botName = p.name;
          if (!botName) continue;

          // アバター取得
          if (p.has_avatar || p.avatar) {
            host.request('profiles.get_asset', { name: botName, asset: 'avatar' })
              .then((assetRes) => {
                if (assetRes?.found && assetRes?.data && isMounted) {
                  setBotAvatars((prev) => ({
                    ...prev,
                    [botName]: assetRes.data
                  }));
                }
              })
              .catch(() => {});
          }

          // 各プロファイルのセッション一覧を取得してセッションIDを紐付け
          host.request('session.list', { profile: botName, limit: 20, include_hidden: true })
            .then((sessRes) => {
              const rows = Array.isArray(sessRes?.sessions) ? sessRes.sessions : [];
              if (isMounted && rows.length > 0) {
                setBotProfiles((prev) => {
                  const next = { ...prev };
                  for (const s of rows) {
                    if (s?.id) {
                      next[s.id] = p;
                    }
                  }
                  return next;
                });
              }
            })
            .catch(() => {});
        }

        setBotProfiles((prev) => ({ ...pMap, ...prev }));
      } catch (err) {
        console.debug('[AgentMonitor] sync error:', err);
      }
    };

    syncRosterAndSessions();
    const interval = setInterval(syncRosterAndSessions, 8000); // 8秒ごとに最新化

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // セッションIDから表示名・アバター・サブテキストを決定
  const resolveSessionInfo = (sessionId) => {
    const isFocused = sessionId === focusedSessionId;
    const meta = sessionMeta[sessionId] || {};
    
    // プロファイルの解決優先順位：
    // 1. セッションIDマッピング
    // 2. 選択中セッションなら focusedProfileName
    // 3. イベントから抽出した botName / agentName
    let profile = botProfiles[sessionId] || null;
    if (!profile && isFocused && focusedProfileName) {
      profile = botProfiles[focusedProfileName] || { name: focusedProfileName, display_name: focusedProfileName };
    }
    if (!profile && meta.botName) {
      profile = botProfiles[meta.botName] || null;
    }

    const shortId = sessionId ? (sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId) : 'unknown';
    
    // 表示名
    let name = profile?.display_name || profile?.name || meta.agentName || meta.botName;
    if (name) {
      // "default" は "Hermes" として表示
      if (name.toLowerCase() === 'default') name = 'Hermes';
      else name = name.charAt(0).toUpperCase() + name.slice(1);
    } else {
      name = `Session ${shortId}`;
    }

    const botKey = profile?.name || (name && name !== `Session ${shortId}` ? name.toLowerCase() : null);
    const avatarImg = (botKey && botAvatars[botKey]) || profile?.avatar || null;
    const subtitle = meta.lastActivity || meta.title || profile?.title || (profile?.model ? profile.model.split('/').pop() : `ID: ${shortId}`);
    const avatarChar = name.replace(/^Session\s+/i, '').slice(0, 1).toUpperCase();

    return {
      name,
      subtitle,
      avatarImg,
      avatarChar
    };
  };

  // 各セッションの稼働タイマー計算
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const nextTimers = { ...timerRef.current };
      
      for (const [sessionId, isBusy] of Object.entries(busyBySession)) {
        if (isBusy) {
          if (!nextTimers[sessionId]) {
            nextTimers[sessionId] = { start: now, elapsed: 0 };
          } else {
            nextTimers[sessionId].elapsed = Math.floor((now - nextTimers[sessionId].start) / 1000);
          }
        } else {
          if (nextTimers[sessionId]) {
            delete nextTimers[sessionId];
          }
        }
      }
      timerRef.current = nextTimers;
      setTimers({ ...nextTimers });
    }, 1000);

    return () => clearInterval(interval);
  }, [busyBySession]);

  // Gateway イベントのリアルタイム購読
  useEffect(() => {
    let unsubscribe;
    try {
      if (typeof host.subscribe === 'function') {
        unsubscribe = host.subscribe((event) => {
          if (!event) return;
          const timestamp = new Date().toLocaleTimeString('ja-JP', { hour12: false });
          const eventType = event.type || event.event || 'message';
          const payload = event.message || event.data || event.payload || event;
          const sid = event.sessionId || event.session_id || event.sid;

          // メタ情報の動的抽出
          if (sid) {
            const agentName = event.agentName || event.botName || event.profile || event.agent || event.bot;
            const title = event.title || event.sessionTitle;
            if (agentName || title) {
              setSessionMeta((prev) => ({
                ...prev,
                [sid]: {
                  ...(prev[sid] || {}),
                  ...(agentName ? { agentName } : {}),
                  ...(title ? { title } : {})
                }
              }));
            }
          }

          const eventItem = {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 7)}`,
            time: timestamp,
            type: eventType,
            sessionId: sid,
            detail: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
          };

          setActivities((prev) => [eventItem, ...prev.slice(0, 99)]);
        });
      }
    } catch (err) {
      console.error('[AgentMonitor] Failed to subscribe to gateway events:', err);
    }

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const sessionIds = Object.keys(busyBySession);
  const activeCount = sessionIds.filter((id) => !!busyBySession[id]).length;

  const filteredActivities = activities.filter((act) => {
    if (filter === 'all') return true;
    if (filter === 'busy') {
      const t = act.type?.toLowerCase() || '';
      return t.includes('think') || t.includes('tool') || t.includes('run') || t.includes('step') || t.includes('turn');
    }
    return act.type?.toLowerCase().includes(filter);
  });

  return jsxs('div', {
    style: {
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
    children: [
      // 1. 本家スタイルのセクションヘッダー（大文字・サブ見出し）
      jsxs('div', {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 14px 6px 14px',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          fontSize: '11px',
          fontWeight: '700',
          color: '#8e8e93'
        },
        children: [
          jsxs('div', {
            style: { display: 'flex', alignItems: 'center', gap: '6px' },
            children: [
              jsx('span', {
                style: {
                  display: 'inline-block',
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
            style: {
              fontSize: '10px',
              fontWeight: '500',
              textTransform: 'none',
              letterSpacing: 'normal',
              color: activeCount > 0 ? '#10b981' : '#8e8e93'
            },
            children: activeCount > 0 ? `${activeCount} 稼働中` : 'Idle'
          })
        ]
      }),

      // 2. セッション一覧（本家ボットリスト風デザイン）
      jsxs('div', {
        style: {
          display: 'flex',
          flexDirection: 'column',
          padding: '4px 8px',
          gap: '2px'
        },
        children: sessionIds.length === 0
          ? jsx('div', {
              style: {
                padding: '12px 8px',
                textAlign: 'left',
                color: '#8e8e93',
                fontSize: '11px'
              },
              children: 'アクティブなセッションはありません'
            })
          : sessionIds.map((sessionId, index) => {
              const isBusy = !!busyBySession[sessionId];
              const isFocused = sessionId === focusedSessionId;
              const elapsed = timers[sessionId]?.elapsed || 0;
              const info = resolveSessionInfo(sessionId);
              const displayName = info.name;
              const subtitleText = isBusy ? `● 推論中 (${elapsed}s 経過)` : (info.subtitle || '待機中');

              // アバターカラーをインデックスに基づいて生成
              const colors = ['#6366f1', '#ec4899', '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b'];
              const avatarBg = colors[index % colors.length];

              return jsxs('div', {
                key: sessionId,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '7px 10px',
                  borderRadius: '8px',
                  background: isFocused ? 'rgba(0, 0, 0, 0.05)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease'
                },
                children: [
                  // 本家風丸型アバター（画像 or イニシャル）
                  jsxs('div', {
                    style: {
                      position: 'relative',
                      width: '32px',
                      height: '32px',
                      minWidth: '32px',
                      borderRadius: '50%',
                      background: isBusy ? '#10b981' : avatarBg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#ffffff',
                      fontWeight: '600',
                      fontSize: '12px',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                      overflow: 'visible'
                    },
                    children: [
                      info.avatarImg
                        ? jsx('img', {
                            src: info.avatarImg,
                            alt: displayName,
                            style: {
                              width: '100%',
                              height: '100%',
                              borderRadius: '50%',
                              objectFit: 'cover'
                            }
                          })
                        : jsx('span', { children: isBusy ? '⚡' : info.avatarChar }),
                      // 稼働中インジケータ
                      jsx('span', {
                        style: {
                          position: 'absolute',
                          bottom: '-1px',
                          right: '-1px',
                          width: '9px',
                          height: '9px',
                          borderRadius: '50%',
                          backgroundColor: isBusy ? '#10b981' : '#c7c7cc',
                          border: '2px solid #ffffff',
                          zIndex: 2
                        }
                      })
                    ]
                  }),

                  // テキスト情報
                  jsxs('div', {
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      flex: 1,
                      overflow: 'hidden',
                      gap: '2px'
                    },
                    children: [
                      jsxs('div', {
                        style: {
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        },
                        children: [
                          jsxs('span', {
                            style: {
                              fontWeight: isFocused ? '600' : '500',
                              fontSize: '12px',
                              color: '#1c1c1e',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            },
                            children: [
                              isFocused && jsx('span', { style: { fontSize: '10px' }, children: '📌' }),
                              displayName
                            ]
                          }),
                          jsx('span', {
                            style: {
                              fontSize: '10px',
                              color: isBusy ? '#059669' : '#8e8e93',
                              fontWeight: isBusy ? '600' : '400'
                            },
                            children: isBusy ? `${elapsed}s` : 'idle'
                          })
                        ]
                      }),
                      jsx('span', {
                        style: {
                          fontSize: '11px',
                          color: isBusy ? '#059669' : '#8e8e93',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        },
                        children: subtitleText
                      })
                    ]
                  })
                ]
              });
            })
      }),

      // セパレータ
      jsx('div', {
        style: {
          height: '1px',
          background: 'rgba(0, 0, 0, 0.06)',
          margin: '8px 12px'
        }
      }),

      // 3. ライブイベントログヘッダー（本家タブ風）
      jsxs('div', {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '4px 14px 6px 14px'
        },
        children: [
          jsx('span', {
            style: {
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              fontSize: '11px',
              fontWeight: '700',
              color: '#8e8e93'
            },
            children: 'LIVE EVENTS'
          }),
          jsxs('div', {
            style: { display: 'flex', gap: '4px', alignItems: 'center' },
            children: [
              jsx('button', {
                onClick: () => setFilter('all'),
                style: {
                  background: filter === 'all' ? 'rgba(0, 0, 0, 0.08)' : 'transparent',
                  color: filter === 'all' ? '#1c1c1e' : '#8e8e93',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontSize: '10px',
                  fontWeight: filter === 'all' ? '600' : '500',
                  cursor: 'pointer'
                },
                children: 'すべて'
              }),
              jsx('button', {
                onClick: () => setFilter('busy'),
                style: {
                  background: filter === 'busy' ? 'rgba(0, 0, 0, 0.08)' : 'transparent',
                  color: filter === 'busy' ? '#1c1c1e' : '#8e8e93',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontSize: '10px',
                  fontWeight: filter === 'busy' ? '600' : '500',
                  cursor: 'pointer'
                },
                children: '推論/ツール'
              }),
              jsx('button', {
                onClick: () => setActivities([]),
                style: {
                  background: 'transparent',
                  color: '#c7c7cc',
                  border: 'none',
                  padding: '2px 4px',
                  fontSize: '10px',
                  cursor: 'pointer'
                },
                children: '✕'
              })
            ]
          })
        ]
      }),

      // 4. ログ一覧エリア
      jsx('div', {
        style: {
          flex: 1,
          overflowY: 'auto',
          padding: '4px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        },
        children: filteredActivities.length === 0
          ? jsxs('div', {
              style: {
                color: '#8e8e93',
                fontSize: '11px',
                textAlign: 'center',
                padding: '28px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                alignItems: 'center'
              },
              children: [
                jsx('span', { style: { fontSize: '18px' }, children: '📡' }),
                jsx('span', { style: { fontWeight: '500' }, children: 'イベント待機中' }),
                jsx('span', {
                  style: { fontSize: '10px', color: '#aeaeaf', lineHeight: '1.4' },
                  children: 'エージェントが思考やツール実行を行うと、ここにリアルタイムログが流れます'
                })
              ]
            })
          : filteredActivities.map((act) =>
              jsxs('div', {
                key: act.id,
                style: {
                  padding: '6px 8px',
                  borderRadius: '6px',
                  background: 'rgba(0, 0, 0, 0.03)',
                  border: '1px solid rgba(0, 0, 0, 0.05)',
                  fontSize: '11px',
                  lineHeight: '1.4'
                },
                children: [
                  jsxs('div', {
                    style: {
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '2px'
                    },
                    children: [
                      jsx('span', {
                        style: {
                          fontWeight: '600',
                          fontSize: '10px',
                          color: '#3a3a3c'
                        },
                        children: act.type
                      }),
                      jsx('span', {
                        style: {
                          color: '#8e8e93',
                          fontSize: '9px'
                        },
                        children: act.time
                      })
                    ]
                  }),
                  jsx('pre', {
                    style: {
                      margin: 0,
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: '10px',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      color: '#48484a'
                    },
                    children: act.detail
                  })
                ]
              })
            )
      })
    ]
  });
}

/**
 * Hermes Plugin Export
 */
export default {
  id: 'agent-monitor',
  name: 'Agent Activity Monitor',
  register(ctx) {
    // 1. 右ペインとして常駐登録
    ctx.register({
      id: 'agent-monitor-pane',
      area: 'panes',
      title: 'Agent Monitor',
      data: {
        placement: 'right',
        defaultOpen: true,
        width: '320px'
      },
      render: () => jsx(AgentActivityPane, {})
    });

    // 2. ナビゲーションルートとしても登録
    ctx.register({
      id: 'agent-monitor-route',
      area: 'routes',
      data: {
        path: '/agent-monitor',
        title: 'Agent Monitor'
      },
      render: () => jsx(AgentActivityPane, {})
    });
  }
};
