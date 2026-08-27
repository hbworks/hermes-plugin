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
  const [hoveredBot, setHoveredBot] = useState(null);
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

          // アバター画像取得
          if (p.has_avatar || p.avatar || !botAvatars[botName]) {
            host.request('profiles.get_asset', { name: botName, asset: 'avatar' })
              .then((assetRes) => {
                if (assetRes?.found && assetRes?.data && isMounted) {
                  setBotAvatars((prev) => ({ ...prev, [botName]: assetRes.data }));
                }
              })
              .catch(() => {});
          }

          // profiles.list の last_session または canonical_session から初期セッションIDを設定
          const initSession = p.last_session || p.canonical_session;
          const initSessionId = initSession?.resolved_id || initSession?.id;
          if (initSessionId) {
            setBotStates((prev) => ({
              ...prev,
              [botName]: {
                ...(prev[botName] || {}),
                model: p.model || '',
                provider: p.provider || '',
                lastSessionId: initSessionId,
                title: initSession?.title || ''
              }
            }));
          }

          // 各プロファイルの最新セッション情報を取得してモデルとセッション種別を特定（常に各プロファイル専用ソケットに問い合わせる）
          const fetchMethod = typeof host?.requestProfile === 'function'
            ? () => host.requestProfile(botName, 'session.list', { limit: 5, include_hidden: true })
            : () => host.request('session.list', { profile: botName, limit: 5, include_hidden: true });

          fetchMethod()
            .then((sessRes) => {
              const rows = Array.isArray(sessRes?.sessions) ? sessRes.sessions : [];
              if (isMounted && rows.length > 0) {
                // 最新のセッション（時系列で一番新しい会話）を基準に判定
                const latest = rows[0];
                const latestTitle = (latest?.title || '').toLowerCase();
                const isTeam = latestTitle.includes('group:') || latestTitle.includes('team');

                if (!isTeam && latest?.id) {
                  sessionBotMapRef.current[latest.id] = botName;
                }

                setBotStates((prev) => ({
                  ...prev,
                  [botName]: {
                    model: latest?.model || p.model || '',
                    provider: latest?.provider || p.provider || '',
                    lastSessionId: latest?.id,
                    isTeam: isTeam,
                    title: latest?.title || ''
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
        
        // ツール完了状態は3秒間キープ
        const isToolCompleted = curStatus?.status === 'tool_completed' && (now - (curStatus.completedAt || 0) < 3000);
        
        // 推論中・実行中・出力中は15秒間キープ（クラウドのレスポンス待ちや長考に対応）
        const eventBusy = (now - lastActive < 15000) && Boolean(curStatus) && !curStatus.isFinished;
        
        // 該当ボット専有の1:1ダイレクトセッションがbusy
        const directSessBusy = (!bState.isTeam && bState.lastSessionId) ? Boolean(busyBySession[bState.lastSessionId]) : false;

        if (isToolCompleted) {
          nextTimers[botName] = {
            status: 'tool_completed',
            toolName: curStatus.toolName,
            duration: curStatus.duration,
            start: curStatus.start,
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
        } else {
          // タイムアウトでクリア
          if (agentStatusMapRef.current[botName] && (now - lastActive >= 15000)) {
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

          // 状態の厳密判定（ツール開始 / ツール実行中 / ツール完了 / 推論中 / 出力中）
          const isToolResultEvent = eventType.includes('tool_result') || 
            eventType.includes('tool.result') || 
            eventType.includes('tool_output') || 
            eventType.includes('tool_response') ||
            Boolean(payload?.tool_result) || 
            payload?.role === 'tool' ||
            eventType === 'tool_result';

          const isToolCallEvent = !isToolResultEvent && (
            eventType.includes('tool_call') || 
            eventType.includes('tool.start') || 
            eventType.includes('tool_start') ||
            eventType.includes('tool') || 
            eventType.includes('exec') || 
            eventType.includes('action') || 
            Boolean(payload?.tool || payload?.tool_call || payload?.function)
          );

          let toolName = '';
          if (isToolCallEvent || isToolResultEvent) {
            toolName = payload?.tool?.name || payload?.tool || payload?.name || payload?.function?.name || payload?.action || payload?.tool_name || 'tool';
            if (typeof toolName !== 'string') toolName = 'tool';
          }

          const isThinkingEvent = !isToolCallEvent && !isToolResultEvent && (
            eventType.includes('reason') || 
            eventType.includes('think') || 
            eventType.includes('thought') ||
            Boolean(payload?.reasoning) ||
            Boolean(payload?.thought) ||
            eventType.includes('turn.start')
          );

          const isGeneratingEvent = !isToolCallEvent && !isToolResultEvent && !isThinkingEvent && (
            isDelta || 
            eventType.includes('stream') || 
            eventType.includes('chunk') || 
            eventType.includes('message') ||
            Boolean(textChunk)
          );

          const isFinishedEvent = eventType === 'turn.finish' || 
            eventType === 'turn.end' || 
            eventType === 'turn.complete' ||
            eventType === 'chat.complete' ||
            eventType === 'session.idle' ||
            eventType.endsWith('.finish') ||
            eventType.endsWith('.complete');

          const now = Date.now();
          if (rawProfile) {
            if (isFinishedEvent) {
              lastActiveMapRef.current[rawProfile] = 0;
              if (agentStatusMapRef.current[rawProfile]) {
                delete agentStatusMapRef.current[rawProfile];
              }
            } else if (isToolResultEvent) {
              lastActiveMapRef.current[rawProfile] = now;
              const prev = agentStatusMapRef.current[rawProfile];
              const startT = prev?.start || (now - 1000);
              const dur = Math.max(1, Math.round((now - startT) / 1000));
              agentStatusMapRef.current[rawProfile] = {
                status: 'tool_completed',
                toolName: toolName || prev?.toolName || 'tool',
                start: startT,
                duration: dur,
                completedAt: now,
                lastActive: now
              };
            } else if (isToolCallEvent) {
              lastActiveMapRef.current[rawProfile] = now;
              const prev = agentStatusMapRef.current[rawProfile];
              const isNew = !prev || prev.status !== 'tool';
              agentStatusMapRef.current[rawProfile] = {
                status: isNew ? 'tool_start' : 'tool',
                toolName: toolName || prev?.toolName || 'tool',
                start: prev?.start || now,
                lastActive: now
              };
            } else if (isThinkingEvent) {
              lastActiveMapRef.current[rawProfile] = now;
              const prev = agentStatusMapRef.current[rawProfile];
              // ツール完了表示の直後はすぐに上書きせず少し余韻を残す
              if (!prev || prev.status !== 'tool_completed' || (now - (prev.completedAt || 0) > 2000)) {
                agentStatusMapRef.current[rawProfile] = {
                  status: 'thinking',
                  toolName: '',
                  start: prev?.start || now,
                  lastActive: now
                };
              }
            } else if (isGeneratingEvent) {
              lastActiveMapRef.current[rawProfile] = now;
              const prev = agentStatusMapRef.current[rawProfile];
              if (!prev || prev.status !== 'tool_completed' || (now - (prev.completedAt || 0) > 2000)) {
                agentStatusMapRef.current[rawProfile] = {
                  status: 'generating',
                  toolName: '',
                  start: prev?.start || now,
                  lastActive: now
                };
              }
            }
          }

          let detailStr = '';
          if (eventType.includes('session.info') || (eventType.startsWith('session') && (payload?.model || payload?.provider || payload?.reasoning_effort))) {
            const cleanInfo = {};
            if (payload?.model) cleanInfo.model = payload.model;
            if (payload?.provider) cleanInfo.provider = payload.provider;
            if (payload?.reasoning_effort) cleanInfo.reasoning_effort = payload.reasoning_effort;
            
            // 対象ボットのモデル・プロバイダー情報を最新化
            if (rawProfile) {
              setBotStates((prev) => ({
                ...prev,
                [rawProfile]: {
                  ...(prev[rawProfile] || {}),
                  ...(payload?.model ? { model: payload.model } : {}),
                  ...(payload?.provider ? { provider: payload.provider } : {})
                }
              }));
            }

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

  // 4. エージェントクリック時のチャット・セッション遷移処理
  const handleAgentClick = async (botName) => {
    try {
      const targetBot = botName || 'default';

      // 1. rosterRef から対象プロファイルの正規セッションIDを取得（他プロファイルの混入を完全防止）
      const matchedProfile = (rosterRef.current || []).find((p) => p.name === targetBot);
      let targetSessionId =
        matchedProfile?.canonical_session?.resolved_id ||
        matchedProfile?.canonical_session?.id ||
        matchedProfile?.last_session?.resolved_id ||
        matchedProfile?.last_session?.id ||
        botStates[targetBot]?.lastSessionId;

      // キャッシュにない場合、対象プロファイル専用ソケットから即座に取得
      if (!targetSessionId) {
        try {
          let rows = [];
          if (typeof host?.requestProfile === 'function') {
            const sessRes = await host.requestProfile(targetBot, 'session.list', { limit: 5, include_hidden: true }).catch(() => null);
            rows = Array.isArray(sessRes?.sessions) ? sessRes.sessions : [];
          } else if (typeof host?.request === 'function') {
            const sessRes = await host.request('session.list', { profile: targetBot, limit: 5, include_hidden: true }).catch(() => null);
            rows = Array.isArray(sessRes?.sessions) ? sessRes.sessions : [];
          }

          if (rows.length > 0) {
            targetSessionId = rows[0].resolved_id || rows[0].id;
          }
        } catch (e) {
          console.debug('[AgentMonitor] session.list fetch error:', e);
        }
      }

      // 2. セッションが存在する場合はそのセッションをメインチャットに開く
      if (targetSessionId) {
        if (typeof host?.openSession === 'function') {
          try {
            await host.openSession(targetSessionId, {
              profile: targetBot,
              intent: 'main',
              awaitHydration: true,
              keepAllProfilesScope: false
            });
            return;
          } catch (openErr) {
            console.warn('[AgentMonitor] host.openSession fallback:', openErr);
          }
        }

        // フォールバック
        if (typeof host?.ensureAgent === 'function') {
          await host.ensureAgent(null, targetBot).catch(() => {});
        }
        if (typeof window !== 'undefined') {
          window.location.hash = `#/${targetSessionId}`;
        }
        if (typeof host?.navigate === 'function') {
          host.navigate(`/${targetSessionId}`);
        }
        return;
      }

      // 3. セッションが存在しない場合は、新規セッションを作成してメインチャットに開く
      let newSessionId = null;
      if (typeof host?.requestProfile === 'function') {
        const createRes = await host.requestProfile(targetBot, 'session.create', {}).catch(() => null);
        newSessionId = createRes?.stored_session_id || createRes?.session?.id || createRes?.id || createRes?.session_id;
      } else if (typeof host?.request === 'function') {
        const createRes = await host.request('session.create', { profile: targetBot }).catch(() => null);
        newSessionId = createRes?.stored_session_id || createRes?.session?.id || createRes?.id || createRes?.session_id;
      }

      if (newSessionId) {
        if (typeof host?.openSession === 'function') {
          try {
            await host.openSession(newSessionId, {
              profile: targetBot,
              intent: 'main',
              awaitHydration: true,
              keepAllProfilesScope: false
            });
            return;
          } catch (e) {}
        }
        if (typeof window !== 'undefined') {
          window.location.hash = `#/${newSessionId}`;
        }
        if (typeof host?.navigate === 'function') {
          host.navigate(`/${newSessionId}`);
        }
      } else {
        if (typeof host?.ensureAgent === 'function') {
          await host.ensureAgent(null, targetBot).catch(() => {});
        }
        if (typeof window !== 'undefined') {
          window.location.hash = '#/';
        }
        if (typeof host?.navigate === 'function') {
          host.navigate('/');
        }
      }
    } catch (err) {
      console.error('[AgentMonitor] handleAgentClick error:', err);
    }
  };

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

      // 2. エージェント一覧（2カラムグリッド配置）
      jsxs('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          padding: '4px 8px',
          gap: '4px 6px'
        },
        children: roster.length === 0
          ? jsx('div', {
              style: {
                gridColumn: '1 / -1',
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

              // モデル名とプロバイダー名
              let rawModel = bState.model || bot.model || '';
              let providerName = bState.provider || '';
              let modelName = '';
              if (rawModel) {
                const parts = rawModel.split('/');
                if (parts.length > 1) {
                  if (!providerName) providerName = parts[0];
                  modelName = parts[parts.length - 1].replace(/:free$/i, '');
                } else {
                  modelName = rawModel.replace(/:free$/i, '');
                }
              }

              // アバター画像
              const avatarImg = botAvatars[botName] || bot.avatar || null;
              const avatarChar = displayName.slice(0, 1).toUpperCase();

              // 指示元バッジ
              const originTag = bState.isTeam ? '👥 Team' : '👤 Direct';
              const originColor = bState.isTeam ? '#8b5cf6' : '#10b981';

              // ステータスに応じた色・ラベル・アイコン（推論中 / ツール呼出 / ツール実行中 / ツール完了 / 出力中）
              let statusColor = '#8e8e93';
              let statusLabel = '';
              let statusIcon = '';
              let pulseColor = '#c7c7cc';

              if (statusType === 'thinking') {
                statusColor = '#10b981'; // 緑
                pulseColor = '#10b981';
                statusIcon = '●';
                statusLabel = `● 推論中 (${elapsed}s 経過)`;
              } else if (statusType === 'tool_start') {
                statusColor = '#f59e0b'; // オレンジ
                pulseColor = '#f59e0b';
                statusIcon = '🚀';
                statusLabel = `🚀 呼出: ${toolName || 'tool'}`;
              } else if (statusType === 'tool') {
                statusColor = '#8b5cf6'; // 紫
                pulseColor = '#8b5cf6';
                statusIcon = '⚡';
                statusLabel = `⚡ 実行中: ${toolName || 'tool'} (${elapsed}s)`;
              } else if (statusType === 'tool_completed') {
                statusColor = '#10b981'; // 緑
                pulseColor = '#10b981';
                statusIcon = '✅';
                statusLabel = `✅ 完了: ${toolName || 'tool'} (${timerInfo?.duration || elapsed}s)`;
              } else if (statusType === 'generating') {
                statusColor = '#3b82f6'; // 青
                pulseColor = '#3b82f6';
                statusIcon = '✍️';
                statusLabel = `✍️ 出力中 (${elapsed}s 経過)`;
              }

              // アバターカラー
              const colors = ['#6366f1', '#ec4899', '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b'];
              const avatarBg = colors[index % colors.length];

              const isHovered = hoveredBot === botName;

              return jsxs('div', {
                key: botName,
                onClick: () => handleAgentClick(botName),
                onMouseEnter: () => setHoveredBot(botName),
                onMouseLeave: () => setHoveredBot(null),
                title: `${displayName} (${providerName ? providerName + '/' : ''}${modelName || 'default'}) - クリックしてチャットを開く`,
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  padding: '7px 8px',
                  borderRadius: '8px',
                  background: isFocused
                    ? 'rgba(0, 0, 0, 0.08)'
                    : isHovered
                    ? 'rgba(0, 0, 0, 0.04)'
                    : 'rgba(0, 0, 0, 0.02)',
                  border: isFocused
                    ? '1px solid rgba(0, 0, 0, 0.15)'
                    : '1px solid rgba(0, 0, 0, 0.05)',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease, border-color 0.15s ease, transform 0.1s ease',
                  userSelect: 'none',
                  minWidth: 0,
                  overflow: 'hidden'
                },
                children: [
                  // 1行目: アバター + 指示元バッジ（Team / Direct） + ピン留め + タイマー/idle
                  jsxs('div', {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '5px'
                    },
                    children: [
                      jsxs('div', {
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px'
                        },
                        children: [
                          // 丸型アバター（24px）
                          jsxs('div', {
                            style: {
                              position: 'relative',
                              width: '24px',
                              height: '24px',
                              minWidth: '24px',
                              borderRadius: '50%',
                              background: isBusy ? pulseColor : avatarBg,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#ffffff',
                              fontWeight: '600',
                              fontSize: '10px',
                              boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                              overflow: 'visible',
                              flexShrink: 0
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
                              // 稼働中インジケータ
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
                                  boxShadow: isBusy ? `0 0 5px ${pulseColor}` : 'none',
                                  zIndex: 2
                                }
                              })
                            ]
                          }),
                          // 指示元バッジ (Team / Direct)
                          jsx('span', {
                            style: {
                              fontSize: '9px',
                              fontWeight: '600',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              backgroundColor: bState.isTeam ? 'rgba(139, 92, 246, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                              color: originColor,
                              letterSpacing: '0.01em',
                              whiteSpace: 'nowrap'
                            },
                            children: originTag
                          }),
                          // フォーカス時のピン留めアイコン
                          isFocused && jsx('span', { style: { fontSize: '10px', flexShrink: 0 }, children: '📌' })
                        ]
                      }),
                      // タイマー / idle
                      jsx('span', {
                        style: {
                          fontSize: '9px',
                          color: isBusy ? statusColor : '#8e8e93',
                          fontWeight: isBusy ? '600' : '400',
                          padding: isBusy ? '1px 4px' : '0',
                          borderRadius: '3px',
                          backgroundColor: isBusy ? 'rgba(0, 0, 0, 0.05)' : 'transparent',
                          flexShrink: 0
                        },
                        children: isBusy ? `${elapsed}s` : 'idle'
                      })
                    ]
                  }),

                  // 2行目: ステータス詳細（推論中/ツール呼出/実行中/完了/出力中）
                  statusLabel
                    ? jsx('div', {
                        style: {
                          fontSize: '10px',
                          color: statusColor,
                          fontWeight: '500',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          lineHeight: '1.3'
                        },
                        children: statusLabel
                      })
                    : null,

                  // 3行目: プロバイダー名 & モデル名
                  jsxs('div', {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                      flexWrap: 'wrap',
                      marginTop: '1px'
                    },
                    children: [
                      // providerName
                      providerName && jsx('span', {
                        style: {
                          fontSize: '8.5px',
                          fontWeight: '500',
                          padding: '1px 4px',
                          borderRadius: '3px',
                          background: 'rgba(0, 0, 0, 0.05)',
                          color: '#5c5c60',
                          fontFamily: 'ui-monospace, monospace',
                          letterSpacing: '0.01em',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '100%'
                        },
                        children: providerName
                      }),
                      // modelName
                      modelName && jsx('span', {
                        style: {
                          fontSize: '8.5px',
                          fontWeight: '600',
                          padding: '1px 4px',
                          borderRadius: '3px',
                          background: 'rgba(99, 102, 241, 0.08)',
                          color: '#6366f1',
                          fontFamily: 'ui-monospace, monospace',
                          letterSpacing: '0.01em',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '100%'
                        },
                        children: modelName
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
              if (t.includes('tool_result') || t.includes('tool.result') || t.includes('tool_output')) {
                typeIcon = '✅';
                badgeColor = '#10b981';
              } else if (t.includes('tool_call') || t.includes('tool.start') || t.includes('tool_start')) {
                typeIcon = '🚀';
                badgeColor = '#f59e0b';
              } else if (t.includes('tool') || t.includes('exec') || t.includes('action')) {
                typeIcon = '⚡';
                badgeColor = '#8b5cf6';
              } else if (t.includes('reason') || t.includes('think') || t.includes('thought')) {
                typeIcon = '🧠';
                badgeColor = '#8b5cf6';
              } else if (t.includes('message') || t.includes('turn') || t.includes('chunk')) {
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
