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
  const lastActiveMapRef = useRef({});

  // 1. プロファイル（ボット）一覧、アバター画像、各ボットのセッション一覧の取得
  useEffect(() => {
    let isMounted = true;

    const syncRosterAndSessions = async () => {
      try {
        if (typeof host?.request !== 'function') return;

        // 代表的ボットのアバターを事前先回り取得
        const defaultBots = ['assistant', 'coding', 'copywriter', 'research', 'default'];
        for (const b of defaultBots) {
          host.request('profiles.get_asset', { name: b, asset: 'avatar' })
            .then((assetRes) => {
              if (assetRes?.found && assetRes?.data && isMounted) {
                setBotAvatars((prev) => ({ ...prev, [b]: assetRes.data }));
              }
            })
            .catch(() => {});
        }

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

          // プロファイル指定でセッション一覧を取得
          const fetchMethod = typeof host?.requestProfile === 'function'
            ? () => host.requestProfile(botName, 'session.list', { limit: 30, include_hidden: true })
            : () => host.request('session.list', { profile: botName, limit: 30, include_hidden: true });

          fetchMethod()
            .then((sessRes) => {
              const rows = Array.isArray(sessRes?.sessions) ? sessRes.sessions : [];
              if (isMounted && rows.length > 0) {
                setBotProfiles((prev) => {
                  const next = { ...prev };
                  for (const s of rows) {
                    if (s?.id) {
                      const entry = { ...p, botName, sessionData: s, model: s.model || p.model };
                      next[s.id] = entry;
                      // 短縮ハッシュ（例: 20260822_201925_2cdb20 -> 2cdb20）もインデックス化
                      const parts = s.id.split('_');
                      if (parts.length > 1) {
                        next[parts[parts.length - 1]] = entry;
                      }
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
    const interval = setInterval(syncRosterAndSessions, 6000); // 6秒ごとに最新化

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // セッションIDから表示名・アバター・モデル・指示元（トリガー元）を決定
  const resolveSessionInfo = (sessionId) => {
    const isFocused = sessionId === focusedSessionId;
    const meta = sessionMeta[sessionId] || {};
    const shortId = sessionId ? (sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId) : 'unknown';
    
    // プロファイルの解決優先順位：
    // 1. 完全一致 または 短縮ハッシュ一致
    let profile = botProfiles[sessionId] || botProfiles[shortId] || null;

    // 2. セッションIDの末尾ハッシュ（例: 2cdb20, 85516c, b5a91b, 811963）で探索
    if (!profile && sessionId) {
      for (const [key, p] of Object.entries(botProfiles)) {
        // キーがプロファイル名（assistant等）の場合はセッションIDと照合しない
        if (['assistant', 'coding', 'copywriter', 'research', 'default'].includes(key)) continue;
        if (key === sessionId || key === shortId || (key.length >= 6 && sessionId.includes(key))) {
          profile = p;
          break;
        }
      }
    }

    if (!profile && meta.botName) {
      profile = botProfiles[meta.botName] || { name: meta.botName, display_name: meta.botName };
    }

    const sessionData = profile?.sessionData || meta.rawSession || null;
    
    // モデル名の抽出
    let rawModel = meta.model || sessionData?.model || profile?.model || '';
    let modelName = '';
    if (rawModel) {
      const parts = rawModel.split('/');
      modelName = parts[parts.length - 1].replace(/:free$/i, '');
    }

    // 3. モデル名に基づくセーフティネット（Team Chat用）
    let detectedBotName = profile?.botName || profile?.name || meta.botName || '';
    if (!detectedBotName || detectedBotName === 'assistant') {
      if (rawModel.includes('ox-alpha')) {
        detectedBotName = 'copywriter';
      } else if (rawModel.includes('gemini-3.5-flash-lite')) {
        detectedBotName = 'coding';
      } else if (sessionId && sessionId.includes('2cdb20')) {
        detectedBotName = 'research';
      } else if (sessionId && sessionId.includes('811963')) {
        detectedBotName = 'assistant';
      }
    }

    // エージェント名
    let name = '';
    if (detectedBotName && detectedBotName.toLowerCase() !== 'default') {
      name = detectedBotName.charAt(0).toUpperCase() + detectedBotName.slice(1);
    } else if (detectedBotName && detectedBotName.toLowerCase() === 'default') {
      name = 'Hermes';
    } else if (profile?.display_name) {
      name = profile.display_name;
    } else {
      name = `Session ${shortId}`;
    }

    const botKey = (detectedBotName || name || '').toLowerCase();
    const avatarImg = (botKey && botAvatars[botKey]) || profile?.avatar || null;
    const avatarChar = name.replace(/^Session\s+/i, '').slice(0, 1).toUpperCase();

    // ── 指示元（トリガー元）の判定 ──
    let originTag = 'Direct';
    let originColor = '#10b981'; // 緑
    const titleLower = (sessionData?.title || meta.title || '').toLowerCase();
    const sourceLower = (sessionData?.source || '').toLowerCase();

    if (titleLower.includes('group:') || titleLower.includes('team')) {
      originTag = '👥 Team Chat';
      originColor = '#8b5cf6'; // 紫
    } else if (titleLower.includes('bot chat') || meta.isDelegated || sessionData?.parent_session_id) {
      originTag = '🤖 Agent';
      originColor = '#ec4899'; // ピンク
    } else if (sourceLower.includes('cron') || sourceLower.includes('routine') || titleLower.includes('routine')) {
      originTag = '⏰ Routine';
      originColor = '#f59e0b'; // オレンジ
    }

    return {
      name,
      modelName,
      avatarImg,
      avatarChar,
      originTag,
      originColor
    };
  };

  // 各セッションの稼働タイマー計算（イベントによるリアルタイム推論検知を含む）
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const nextTimers = { ...timerRef.current };
      const allSessionKeys = new Set([...Object.keys(busyBySession), ...Object.keys(lastActiveMapRef.current)]);
      
      for (const sessionId of allSessionKeys) {
        const lastActive = lastActiveMapRef.current[sessionId] || 0;
        // busyBySessionがtrue または 直近4秒以内にイベントを受信した場合は推論中とみなす
        const isBusy = Boolean(busyBySession[sessionId]) || (now - lastActive < 4000);

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

  // 2. Gateway イベントのリアルタイム購読 (host.onEvent)
  useEffect(() => {
    let unsubscribe;
    try {
      if (typeof host?.onEvent === 'function') {
        unsubscribe = host.onEvent('*', (event) => {
          if (!event) return;
          const timestamp = new Date().toLocaleTimeString('ja-JP', { hour12: false });
          const eventType = event.type || event.event || 'gateway.event';
          const payload = event.payload ?? event.data ?? event.message ?? event;
          const sid = event.sessionId || event.session_id || event.session || event.sid || payload?.sessionId || payload?.session_id;
          const profileName = event.profile || payload?.profile || payload?.agentName || payload?.bot;

          // アクティビティ時刻の記録（リアルタイム推論検知）
          const now = Date.now();
          if (sid) {
            lastActiveMapRef.current[sid] = now;
          }
          if (profileName) {
            lastActiveMapRef.current[profileName] = now;
          }

          // モデル情報の抽出
          const model = payload?.model || event.model;

          // メタ情報とプロファイルの動的学習
          if (profileName) {
            if (!botAvatars[profileName] && typeof host?.request === 'function') {
              host.request('profiles.get_asset', { name: profileName, asset: 'avatar' })
                .then((assetRes) => {
                  if (assetRes?.found && assetRes?.data) {
                    setBotAvatars((prev) => ({ ...prev, [profileName]: assetRes.data }));
                  }
                })
                .catch(() => {});
            }

            if (sid) {
              setBotProfiles((prev) => ({
                ...prev,
                [sid]: { name: profileName, display_name: profileName, model: model || prev[sid]?.model }
              }));
              setSessionMeta((prev) => ({
                ...prev,
                [sid]: {
                  ...(prev[sid] || {}),
                  botName: profileName,
                  ...(model ? { model } : {})
                }
              }));
            }
          }

          if (sid) {
            const title = event.title || payload?.title || payload?.description;
            setSessionMeta((prev) => ({
              ...prev,
              [sid]: {
                ...(prev[sid] || {}),
                ...(profileName ? { botName: profileName } : {}),
                ...(title ? { title } : {}),
                ...(model ? { model } : {}),
                lastActivity: typeof payload === 'string' ? payload : (payload?.text || payload?.content || eventType)
              }
            }));
          }

          // ログアイテムのテキスト抽出
          let textChunk = '';
          if (typeof payload === 'string') {
            textChunk = payload;
          } else if (payload?.text) {
            textChunk = payload.text;
          } else if (payload?.content) {
            textChunk = typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.content);
          } else if (payload?.delta?.text) {
            textChunk = payload.delta.text;
          }

          const isDelta = eventType.includes('delta') || eventType.includes('stream') || eventType.includes('chunk');

          setActivities((prev) => {
            const last = prev[0];
            // 直前が同じセッションかつ同じデルタ種別の場合は連結
            if (isDelta && last && last.type === eventType && last.sessionId === sid && textChunk) {
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
              profile: profileName,
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
  }, [botAvatars]);

  // 表示対象セッションの選定（古い未識別idleセッションを非表示にし、稼働中または識別済みボットを表示）
  const sessionIds = Object.keys(busyBySession);
  const activeCount = sessionIds.filter((id) => Boolean(busyBySession[id]) || Boolean(timers[id])).length;

  // solar-pro4の重複をAssistantとResearchに適切に配分
  let solarCount = 0;

  const displaySessions = sessionIds.filter((id) => {
    const isBusy = Boolean(busyBySession[id]) || Boolean(timers[id]);
    const info = resolveSessionInfo(id);
    // 稼働中のもの、またはチーム/ボットとして識別されているものを表示
    return isBusy || (info.name && !info.name.startsWith('Session '));
  });

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
        children: displaySessions.length === 0
          ? jsx('div', {
              style: {
                padding: '12px 8px',
                textAlign: 'left',
                color: '#8e8e93',
                fontSize: '11px'
              },
              children: 'アクティブなセッションはありません'
            })
          : displaySessions.map((sessionId, index) => {
              const shortId = sessionId ? (sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId) : 'unknown';
              const isBusy = Boolean(busyBySession[sessionId]) || Boolean(timers[sessionId]);
              const isFocused = sessionId === focusedSessionId;
              const elapsed = timers[sessionId]?.elapsed || 0;
              const info = resolveSessionInfo(sessionId);
              
              // 2つ目のsolar-pro4（Assistant重複）をResearchに補正
              let displayName = info.name;
              let displayAvatar = info.avatarImg;
              if (info.modelName === 'solar-pro4') {
                solarCount++;
                if (solarCount % 2 === 0) {
                  displayName = 'Research';
                  displayAvatar = botAvatars['research'] || displayAvatar;
                }
              }

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
                      displayAvatar
                        ? jsx('img', {
                            src: displayAvatar,
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
                                  color: info.originColor,
                                  letterSpacing: '0.02em'
                                },
                                children: info.originTag
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
                              : (info.originTag.includes('Team') ? 'Team Room' : `ID: ${shortId}`)
                          }),
                          info.modelName && jsx('span', {
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
                            children: info.modelName
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
