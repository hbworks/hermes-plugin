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
  const [roster, setRoster] = useState([]);
  const [botAvatars, setBotAvatars] = useState({});
  const [botStates, setBotStates] = useState({});
  const [filter, setFilter] = useState('all');
  const [timers, setTimers] = useState({});
  const timerRef = useRef({});
  const lastActiveMapRef = useRef({});

  // 1. プロファイル（ボット）一覧とアバター画像の取得
  useEffect(() => {
    let isMounted = true;

    const syncRoster = async () => {
      try {
        if (typeof host?.request !== 'function') return;

        // 全プロファイルの取得
        const res = await host.request('profiles.list', {});
        const profiles = Array.isArray(res?.profiles) ? res.profiles : [];
        if (!isMounted) return;

        // 代表ボット順にソート（assistant, research, coding, copywriter, default）
        const order = ['assistant', 'research', 'coding', 'copywriter', 'default'];
        const sorted = [...profiles].sort((a, b) => {
          const ia = order.indexOf(a.name);
          const ib = order.indexOf(b.name);
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        });

        setRoster(sorted);

        // 各ボットのアバター画像と最新セッション・モデルを取得
        for (const p of sorted) {
          const botName = p.name;
          if (!botName) continue;

          // アバター取得
          if (p.has_avatar || p.avatar || !botAvatars[botName]) {
            host.request('profiles.get_asset', { name: botName, asset: 'avatar' })
              .then((assetRes) => {
                if (assetRes?.found && assetRes?.data && isMounted) {
                  setBotAvatars((prev) => ({ ...prev, [botName]: assetRes.data }));
                }
              })
              .catch(() => {});
          }

          // 各プロファイルの最新セッション情報を取得してモデルとセッション種別を特定
          const fetchMethod = typeof host?.requestProfile === 'function'
            ? () => host.requestProfile(botName, 'session.list', { limit: 5, include_hidden: true })
            : () => host.request('session.list', { profile: botName, limit: 5, include_hidden: true });

          fetchMethod()
            .then((sessRes) => {
              const rows = Array.isArray(sessRes?.sessions) ? sessRes.sessions : [];
              if (isMounted && rows.length > 0) {
                const latest = rows[0];
                const teamSession = rows.find((r) => (r.title || '').toLowerCase().includes('team') || (r.title || '').toLowerCase().includes('group:'));
                const activeSess = teamSession || latest;

                setBotStates((prev) => ({
                  ...prev,
                  [botName]: {
                    model: activeSess?.model || p.model || '',
                    lastSessionId: activeSess?.id,
                    isTeam: Boolean(teamSession),
                    title: activeSess?.title || ''
                  }
                }));
              }
            })
            .catch(() => {});
        }
      } catch (err) {
        console.debug('[AgentMonitor] sync error:', err);
      }
    };

    syncRoster();
    const interval = setInterval(syncRoster, 5000); // 5秒ごとに最新化

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // 2. 各ボットの稼働タイマー計算
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const nextTimers = { ...timerRef.current };
      const anySessionBusy = Object.values(busyBySession).some(Boolean);

      for (const bot of roster) {
        const botName = bot.name;
        const bState = botStates[botName] || {};
        const lastActive = lastActiveMapRef.current[botName] || 0;
        
        // 1. 直近4秒以内に推論・ツールイベントを受信した
        const eventBusy = (now - lastActive < 4000);
        // 2. このボットのセッション、またはフォーカス中かつGateway全体がbusy
        const sessBusy = bState.lastSessionId ? Boolean(busyBySession[bState.lastSessionId]) : false;
        const focusBusy = (focusedProfileName === botName) && anySessionBusy;

        const isBusy = eventBusy || sessBusy || focusBusy;

        if (isBusy) {
          if (!nextTimers[botName]) {
            nextTimers[botName] = { start: now, elapsed: 0 };
          } else {
            nextTimers[botName].elapsed = Math.floor((now - nextTimers[botName].start) / 1000);
          }
        } else {
          if (nextTimers[botName]) {
            delete nextTimers[botName];
          }
        }
      }
      timerRef.current = nextTimers;
      setTimers({ ...nextTimers });
    }, 1000);

    return () => clearInterval(interval);
  }, [roster, botStates, busyBySession, focusedProfileName]);

  // 3. Gateway イベントのリアルタイム購読 (host.onEvent)
  useEffect(() => {
    let unsubscribe;
    try {
      if (typeof host?.onEvent === 'function') {
        unsubscribe = host.onEvent('*', (event) => {
          if (!event) return;
          const timestamp = new Date().toLocaleTimeString('ja-JP', { hour12: false });
          const eventType = (event.type || event.event || 'gateway.event').toLowerCase();
          const payload = event.payload ?? event.data ?? event.message ?? event;
          const sid = event.sessionId || event.session_id || event.session || event.sid || payload?.sessionId || payload?.session_id;
          
          // チームチャットや各種イベントからプロファイル名を確実に抽出
          let rawProfile = (
            event.profile ||
            payload?.profile ||
            payload?.member ||
            payload?.speaker ||
            payload?.from?.name ||
            payload?.agentName ||
            payload?.bot ||
            event.speaker ||
            ''
          ).toLowerCase();

          // ログアイテムのテキスト抽出
          let textChunk = '';
          if (typeof payload === 'string') {
            textChunk = payload;
          } else if (payload?.text) {
            textChunk = payload.text;
          } else if (payload?.content) {
            textChunk = typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.content);
          const isDelta = eventType.includes('delta') || eventType.includes('stream') || eventType.includes('chunk');

          // 推論・生成中イベントの厳密判定
          const isThinkingEvent = eventType.includes('reason') || 
            eventType.includes('delta') || 
            eventType.includes('tool') || 
            eventType.includes('turn.start') || 
            eventType.includes('step') ||
            eventType.includes('working') ||
            Boolean(textChunk && isDelta);

          const isFinishedEvent = eventType.includes('finish') || 
            eventType.includes('end') || 
            eventType.includes('stop') || 
            eventType.includes('complete');

          const now = Date.now();
          if (rawProfile) {
            if (isThinkingEvent && !isFinishedEvent) {
              lastActiveMapRef.current[rawProfile] = now;
            } else if (isFinishedEvent) {
              lastActiveMapRef.current[rawProfile] = 0;
            }
          } else if (isThinkingEvent && !isFinishedEvent && focusedProfileName) {
            // プロファイル未記載だが推論中の場合はフォーカス中ボットに適用
            lastActiveMapRef.current[focusedProfileName] = now;
            rawProfile = focusedProfileName;
          }

          setActivities((prev) => {
            const last = prev[0];
            if (isDelta && last && last.type === eventType && last.profile === rawProfile && textChunk) {
              const updatedLast = {
                ...last,
                time: timestamp,
                detail: last.detail + textChunk
              };
              return [updatedLast, ...prev.slice(1)];
            }

            const newEvent = {
              id: `${Date.now()}-${Math.random().toString(36).substr(2, 7)}`,
              time: timestamp,
              type: eventType,
              sessionId: sid,
              profile: rawProfile,
              detail: textChunk || (typeof payload === 'object' ? JSON.stringify(payload, null, 2) : String(payload))
            };

            return [newEvent, ...prev.slice(0, 99)];
          });
        });
      }
    } catch (err) {
      console.error('[AgentMonitor] Failed to subscribe via host.onEvent:', err);
    }

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const activeCount = Object.keys(timers).length;

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

      // 2. エージェント一覧（重複ゼロ・固定ロスター）
      jsxs('div', {
        style: {
          display: 'flex',
          flexDirection: 'column',
          padding: '4px 8px',
          gap: '2px'
        },
        children: roster.length === 0
          ? jsx('div', {
              style: {
                padding: '12px 8px',
                textAlign: 'left',
                color: '#8e8e93',
                fontSize: '11px'
              },
              children: 'エージェントを読み込み中...'
            })
          : roster.map((bot, index) => {
              const botName = bot.name;
              const isBusy = Boolean(timers[botName]);
              const elapsed = timers[botName]?.elapsed || 0;
              const isFocused = focusedProfileName === botName;
              const bState = botStates[botName] || {};
              
              // 表示名
              let displayName = bot.display_name || bot.name || 'Agent';
              if (displayName.toLowerCase() === 'default') displayName = 'Hermes';
              else displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);

              // モデル名
              let rawModel = bState.model || bot.model || '';
              let modelName = '';
              if (rawModel) {
                const parts = rawModel.split('/');
                modelName = parts[parts.length - 1].replace(/:free$/i, '');
              }

              // アバター画像
              const avatarImg = botAvatars[botName] || bot.avatar || null;
              const avatarChar = displayName.slice(0, 1).toUpperCase();

              // 指示元バッジ
              const originTag = bState.isTeam ? '👥 Team Chat' : '👤 Direct';
              const originColor = bState.isTeam ? '#8b5cf6' : '#10b981';

              // アバターカラー
              const colors = ['#6366f1', '#ec4899', '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b'];
              const avatarBg = colors[index % colors.length];

              return jsxs('div', {
                key: botName,
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
                      avatarImg
                        ? jsx('img', {
                            src: avatarImg,
                            alt: displayName,
                            style: {
                              width: '100%',
                              height: '100%',
                              borderRadius: '50%',
                              objectFit: 'cover'
                            }
                          })
                        : jsx('span', { children: isBusy ? '⚡' : avatarChar }),
                      // 稼働中インジケータ（緑のパルス）
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
                          boxShadow: isBusy ? '0 0 6px rgba(16, 185, 129, 0.8)' : 'none',
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
                          jsxs('div', {
                            style: { display: 'flex', alignItems: 'center', gap: '6px' },
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
                                  fontSize: '9px',
                                  fontWeight: '600',
                                  padding: '1px 5px',
                                  borderRadius: '4px',
                                  backgroundColor: `rgba(0, 0, 0, 0.04)`,
                                  color: originColor,
                                  letterSpacing: '0.02em'
                                },
                                children: originTag
                              })
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
                      jsxs('div', {
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '6px',
                          marginTop: '1px'
                        },
                        children: [
                          jsx('span', {
                            style: {
                              fontSize: '11px',
                              color: isBusy ? '#059669' : '#8e8e93',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              flex: 1
                            },
                            children: isBusy
                              ? `● 推論中 (${elapsed}s 経過)`
                              : (bState.isTeam ? 'Team Room' : 'Direct Chat')
                          }),
                          modelName && jsx('span', {
                            style: {
                              fontSize: '9px',
                              fontWeight: '600',
                              padding: '1px 5px',
                              borderRadius: '3px',
                              background: 'rgba(99, 102, 241, 0.08)',
                              color: '#6366f1',
                              fontFamily: 'ui-monospace, monospace',
                              letterSpacing: '0.02em',
                              flexShrink: 0
                            },
                            children: modelName
                          })
                        ]
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
          : filteredActivities.map((act) => {
              let typeIcon = '⚡';
              let badgeColor = '#6366f1';
              const t = act.type.toLowerCase();
              if (t.includes('reason') || t.includes('think')) {
                typeIcon = '🧠';
                badgeColor = '#8b5cf6';
              } else if (t.includes('tool')) {
                typeIcon = '🛠';
                badgeColor = '#f59e0b';
              } else if (t.includes('message') || t.includes('turn')) {
                typeIcon = '💬';
                badgeColor = '#3b82f6';
              }

              return jsxs('div', {
                key: act.id,
                style: {
                  padding: '7px 9px',
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
                      marginBottom: '4px'
                    },
                    children: [
                      jsxs('span', {
                        style: {
                          fontWeight: '600',
                          fontSize: '10px',
                          color: badgeColor,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        },
                        children: [
                          jsx('span', { children: typeIcon }),
                          act.type
                        ]
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
                  jsx('div', {
                    style: {
                      margin: 0,
                      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace',
                      fontSize: '11px',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      color: '#2c2c2e',
                      lineHeight: '1.4'
                    },
                    children: act.detail
                  })
                ]
              });
            })
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
