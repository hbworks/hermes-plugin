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
  const agentStatusMapRef = useRef({});
  const rosterRef = useRef([]);
  const sessionBotMapRef = useRef({});

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
        rosterRef.current = sorted;

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
                const isTeam = Boolean(teamSession);

                // ダイレクト（1:1）セッションのみボットと1対1でマップ
                if (!isTeam && latest?.id) {
                  sessionBotMapRef.current[latest.id] = botName;
                }

                setBotStates((prev) => ({
                  ...prev,
                  [botName]: {
                    model: activeSess?.model || p.model || '',
                    lastSessionId: activeSess?.id,
                    isTeam: isTeam,
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

  // 2. 各ボットの稼働タイマー計算（推論中・ツール実行中・出力中の管理）
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const nextTimers = {};

      for (const bot of roster) {
        const botName = bot.name;
        const bState = botStates[botName] || {};
        const curStatus = agentStatusMapRef.current[botName];
        const lastActive = lastActiveMapRef.current[botName] || 0;
        
        // 1. 直近4秒以内に該当ボットのイベントを受信した
        const eventBusy = (now - lastActive < 4000) && Boolean(curStatus);
        // 2. 該当ボット専有の1:1ダイレクトセッションがbusy
        const directSessBusy = (!bState.isTeam && bState.lastSessionId) ? Boolean(busyBySession[bState.lastSessionId]) : false;

        if (eventBusy) {
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
        } else {
          // 期限切れでクリア
          if (agentStatusMapRef.current[botName] && (now - lastActive >= 4000)) {
            delete agentStatusMapRef.current[botName];
          }
        }
      }
      timerRef.current = nextTimers;
      setTimers({ ...nextTimers });
    }, 1000);

    return () => clearInterval(interval);
  }, [roster, botStates, busyBySession]);

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

          // システム初期化、内部状態通知（sessions.changed等）、skin/CSS等のノイズを除外
          if (
            eventType.startsWith('gateway.') ||
            eventType.startsWith('sessions.') ||
            eventType.startsWith('profiles.') ||
            eventType.startsWith('skin.') ||
            eventType.startsWith('theme.') ||
            payload?.skin ||
            payload?.colors
          ) {
            // ただし推論・ツール・メッセージなどの実アクティビティが含まれる場合は例外として通す
            const hasActivity = payload?.text || payload?.content || payload?.delta || payload?.tool || payload?.error;
            if (!hasActivity) {
              return;
            }
          }
          
          const sid = event.sessionId || event.session_id || event.session || event.sid || payload?.sessionId || payload?.session_id;
          
          // エージェント名・プロファイル名の多角的な特定
          let rawProfile = '';
          const candidateFields = [
            event.profile,
            event.profile_name,
            event.agent,
            event.agent_name,
            event.bot,
            event.speaker,
            event.sender,
            payload?.profile,
            payload?.profile_name,
            payload?.agent,
            payload?.agent_name,
            payload?.agentName,
            payload?.bot,
            payload?.speaker,
            payload?.member,
            payload?.author,
            payload?.sender,
            payload?.role,
            payload?.name,
            payload?.from?.name,
            payload?.from?.profile,
            typeof payload?.from === 'string' ? payload?.from : null,
            payload?.actor
          ];

          for (const cand of candidateFields) {
            if (cand && typeof cand === 'string' && cand.trim()) {
              rawProfile = cand.trim().toLowerCase();
              break;
            }
          }

          // ログアイテムのテキスト抽出
          let textChunk = '';
          if (typeof payload === 'string') {
            textChunk = payload;
          } else if (payload?.text) {
            textChunk = payload.text;
          } else if (payload?.content) {
            textChunk = typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.content);
          }
          const isDelta = eventType.includes('delta') || eventType.includes('stream') || eventType.includes('chunk');

          // プロファイル未特定の場合、イベント文字列やセッションマップから照合
          if (!rawProfile && rosterRef.current && rosterRef.current.length > 0) {
            const rawEventStr = `${eventType} ${textChunk} ${typeof payload === 'object' ? JSON.stringify(payload) : String(payload)}`.toLowerCase();
            for (const bot of rosterRef.current) {
              const bName = bot.name.toLowerCase();
              if (bName !== 'default' && (
                rawEventStr.includes(`"${bName}"`) ||
                rawEventStr.includes(`${bName} is thinking`) ||
                rawEventStr.includes(`[${bName}]`) ||
                rawEventStr.includes(`@${bName}`) ||
                rawEventStr.includes(`${bName}:`)
              )) {
                rawProfile = bName;
                break;
              }
            }
          }

          // それでも未特定でダイレクトセッションIDが存在する場合はマッピングから取得
          if (!rawProfile && sid && sessionBotMapRef.current[sid]) {
            rawProfile = sessionBotMapRef.current[sid];
          }

          // 状態の厳密判定（ツール実行中 / 推論中 / 出力中 / 完了）
          const isToolEvent = eventType.includes('tool') || 
            eventType.includes('exec') || 
            eventType.includes('action') || 
            Boolean(payload?.tool || payload?.tool_call || payload?.function);

          let toolName = '';
          if (isToolEvent) {
            toolName = payload?.tool?.name || payload?.tool || payload?.name || payload?.function?.name || payload?.action || 'tool';
            if (typeof toolName !== 'string') toolName = 'tool';
          }

          const isThinkingEvent = eventType.includes('reason') || 
            eventType.includes('think') || 
            eventType.includes('thought') ||
            Boolean(payload?.reasoning) ||
            Boolean(payload?.thought) ||
            eventType.includes('turn.start');

          const isGeneratingEvent = isDelta || 
            eventType.includes('stream') || 
            eventType.includes('chunk') || 
            eventType.includes('message') ||
            Boolean(textChunk && !isThinkingEvent && !isToolEvent);

          const isFinishedEvent = eventType.includes('finish') || 
            eventType.includes('end') || 
            eventType.includes('stop') || 
            eventType.includes('complete');

          const now = Date.now();
          if (rawProfile) {
            if (isFinishedEvent) {
              lastActiveMapRef.current[rawProfile] = 0;
              if (agentStatusMapRef.current[rawProfile]) {
                delete agentStatusMapRef.current[rawProfile];
              }
            } else if (isToolEvent) {
              lastActiveMapRef.current[rawProfile] = now;
              const prev = agentStatusMapRef.current[rawProfile];
              agentStatusMapRef.current[rawProfile] = {
                status: 'tool',
                toolName: toolName || prev?.toolName || 'tool',
                start: prev?.start || now,
                lastActive: now
              };
            } else if (isThinkingEvent) {
              lastActiveMapRef.current[rawProfile] = now;
              const prev = agentStatusMapRef.current[rawProfile];
              agentStatusMapRef.current[rawProfile] = {
                status: 'thinking',
                toolName: '',
                start: prev?.start || now,
                lastActive: now
              };
            } else if (isGeneratingEvent) {
              lastActiveMapRef.current[rawProfile] = now;
              const prev = agentStatusMapRef.current[rawProfile];
              agentStatusMapRef.current[rawProfile] = {
                status: 'generating',
                toolName: '',
                start: prev?.start || now,
                lastActive: now
              };
            }
          }

          let detailStr = '';
          if (eventType.includes('session.info') || (eventType.startsWith('session') && (payload?.model || payload?.provider || payload?.reasoning_effort))) {
            const cleanInfo = {};
            if (payload?.model) cleanInfo.model = payload.model;
            if (payload?.provider) cleanInfo.provider = payload.provider;
            if (payload?.reasoning_effort) cleanInfo.reasoning_effort = payload.reasoning_effort;
            
            if (Object.keys(cleanInfo).length > 0) {
              detailStr = JSON.stringify(cleanInfo, null, 2);
            }
          } else {
            detailStr = textChunk || (typeof payload === 'object' ? JSON.stringify(payload, null, 2) : String(payload));
          }
          
          // 内容が空（{} や空文字、null等）の無意味なイベントはログに追加しない
          if (!detailStr || detailStr.trim() === '{}' || detailStr.trim() === '""' || detailStr === 'null' || detailStr === 'undefined') {
            return;
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
              detail: detailStr
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
      return t.includes('think') || t.includes('reason') || t.includes('tool') || t.includes('run') || t.includes('step') || t.includes('turn') || t.includes('delta') || t.includes('stream');
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
              const timerInfo = timers[botName];
              const isBusy = Boolean(timerInfo);
              const elapsed = timerInfo?.elapsed || 0;
              const statusType = timerInfo?.status || 'idle';
              const toolName = timerInfo?.toolName || '';
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

              // ステータスに応じた色・ラベル・アイコン
              let statusColor = '#8e8e93';
              let statusLabel = bState.isTeam ? 'Team Room' : 'Direct Chat';
              let statusIcon = '';
              let pulseColor = '#c7c7cc';

              if (statusType === 'thinking') {
                statusColor = '#10b981'; // 緑
                pulseColor = '#10b981';
                statusIcon = '●';
                statusLabel = `● 推論中 (${elapsed}s 経過)`;
              } else if (statusType === 'tool') {
                statusColor = '#8b5cf6'; // 紫
                pulseColor = '#8b5cf6';
                statusIcon = '⚡';
                statusLabel = `⚡ ツール実行中: ${toolName || 'tool'} (${elapsed}s)`;
              } else if (statusType === 'generating') {
                statusColor = '#3b82f6'; // 青
                pulseColor = '#3b82f6';
                statusIcon = '✍️';
                statusLabel = `✍️ 出力中 (${elapsed}s 経過)`;
              }

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
                      background: isBusy ? pulseColor : avatarBg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#ffffff',
                      fontWeight: '600',
                      fontSize: '12px',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                      overflow: 'visible',
                      transition: 'background-color 0.2s ease'
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
                        : jsx('span', { children: isBusy ? (statusIcon || '⚡') : avatarChar }),
                      // 稼働中インジケータ（状態別カラー）
                      jsx('span', {
                        style: {
                          position: 'absolute',
                          bottom: '-1px',
                          right: '-1px',
                          width: '9px',
                          height: '9px',
                          borderRadius: '50%',
                          backgroundColor: isBusy ? pulseColor : '#c7c7cc',
                          border: '2px solid #ffffff',
                          boxShadow: isBusy ? `0 0 6px ${pulseColor}` : 'none',
                          zIndex: 2,
                          transition: 'background-color 0.2s ease, box-shadow 0.2s ease'
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
                              color: isBusy ? statusColor : '#8e8e93',
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
                              color: isBusy ? statusColor : '#8e8e93',
                              fontWeight: isBusy ? '500' : '400',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              flex: 1
                            },
                            children: statusLabel
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
