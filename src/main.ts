/// <reference types="nakama-runtime" />

const OpCodes = {
    MOVE: 1,
    UPDATE: 2,
    GAME_OVER: 3,
    OPPONENT_LEFT: 4
};

function rpcFindMatch(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
        const request = payload ? JSON.parse(payload) : {};
        
        const matchId = nk.matchCreate('tictactoe', {
            region: request.region || 'any',
            skill: request.skill || 0,
            mode: 'tictactoe'
        });
        
        logger.info('User %s created match for matchmaking: %s', ctx.userId, matchId);
        
        return JSON.stringify({
            success: true,
            matchId: matchId,
            message: 'Match created for matchmaking'
        });
    } catch (error) {
        logger.error('Error in rpcFindMatch: %s', error);
        return JSON.stringify({
            success: false,
            error: 'Failed to create match'
        });
    }
}

function rpcCancelMatchmaking(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
        const request = JSON.parse(payload);
        const matchId = request.matchId;
        
        if (!matchId) {
            return JSON.stringify({
                success: false,
                error: 'Match ID required'
            });
        }
        
        logger.info('Matchmaking cancellation requested for match %s by user %s', matchId, ctx.userId);
        
        return JSON.stringify({
            success: true,
            message: 'Matchmaking cancellation noted'
        });
    } catch (error) {
        logger.error('Error canceling matchmaking: %s', error);
        return JSON.stringify({
            success: false,
            error: 'Failed to cancel matchmaking'
        });
    }
}

function rpcCreateMatch(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
        const matchId = nk.matchCreate('tictactoe', {});
        
        logger.info('Private match created: %s', matchId);
        
        return JSON.stringify({
            success: true,
            matchId: matchId
        });
    } catch (error) {
        logger.error('Error creating match: %s', error);
        return JSON.stringify({
            success: false,
            error: 'Failed to create match'
        });
    }
}

function matchmakerMatched(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, matches: nkruntime.MatchmakerResult[]): string | void {
    logger.info('Matchmaker found %d players', matches.length);
    
    if (matches.length < 2) {
        logger.warn('Not enough players for match: %d', matches.length);
        return;
    }
    
    const matchId = nk.matchCreate('tictactoe', {
        matchedUsers: matches.map(m => ({
            userId: m.presence.userId,
            username: m.presence.username,
            sessionId: m.presence.sessionId
        }))
    });
    
    logger.info('Created match %s for matched players', matchId);
    
    matches.forEach((matchmakerResult) => {
        try {
            nk.notificationsSend([{
                userId: matchmakerResult.presence.userId,
                subject: 'Match Ready',
                content: {
                    matchId: matchId,
                    message: 'Match found! Join now.'
                },
                code: 1,
                persistent: false
            }]);
            
            logger.info('Sent match notification to user %s', matchmakerResult.presence.userId);
        } catch (error) {
            logger.error('Failed to send notification: %s', error);
        }
    });
    
    return matchId;
}

function InitModule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer) {
    initializer.registerRpc('create_match_rpc', rpcCreateMatch);
    initializer.registerRpc('find_match_rpc', rpcFindMatch);
    initializer.registerRpc('cancel_matchmaking_rpc', rpcCancelMatchmaking);
    initializer.registerRpc('get_leaderboard_rpc', rpcGetLeaderboard);
    initializer.registerRpc('get_player_stats_rpc', rpcGetPlayerStats);
    initializer.registerRpc('test_stats_rpc', rpcTestStats);
    initializer.registerRpc('health_check_rpc', rpcHealthCheck);
    

    try {
        const leaderboardId = 'tictactoe_wins';
        const authoritative = true; // Only server can submit scores
        const sortOrder = nkruntime.SortOrder.DESCENDING; // Highest wins first
        const operator = nkruntime.Operator.INCREMENTAL; // Add to existing score
        const resetSchedule = null; // Never reset (or use CRON like "0 0 * * 0" for weekly)
        const metadata = {
            name: 'Tic-Tac-Toe Wins Leaderboard'
        };
        
        nk.leaderboardCreate(leaderboardId, authoritative, sortOrder, operator, resetSchedule, metadata);
        logger.info('Leaderboard created: %s', leaderboardId);
    } catch (error) {
        logger.warn('Leaderboard may already exist: %s', error);
    }

    initializer.registerMatch('tictactoe', {
        matchInit: matchInit,
        matchJoinAttempt: matchJoinAttempt,
        matchJoin: matchJoin,
        matchLeave: matchLeave,
        matchLoop: matchLoop,
        matchSignal: matchSignal,
        matchTerminate: matchTerminate
    });
    
    initializer.registerMatchmakerMatched(matchmakerMatched);
    
    logger.info('Tic-Tac-Toe module initialized successfully');
}

function matchInit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, params: {[key: string]: any}): {state: nkruntime.MatchState, tickRate: number, label: string} {
    const state: any = {
        board: Array(9).fill(null),
        players: [],
        reservedPlayers: [],
        currentTurn: 0,
        winner: null,
        gameStatus: 'waiting',
        startTime: Date.now(),
        moveHistory: [],
        matchedUsers: params.matchedUsers || []
    };
    
    if (state.matchedUsers && state.matchedUsers.length > 0) {
        state.reservedPlayers = state.matchedUsers.map((user: any) => user.userId);
        logger.info('Match initialized with %d reserved players', state.reservedPlayers.length);
    }
    
    const label = JSON.stringify({
        mode: 'tictactoe',
        status: 'waiting',
        players: state.players.length,
        maxPlayers: 2
    });
    
    logger.info('Match initialized');
    
    return {
        state,
        tickRate: 1,
        label
    };
}

function matchJoinAttempt(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, presence: nkruntime.Presence, metadata: {[key: string]: any}): {state: nkruntime.MatchState, accept: boolean, rejectMessage?: string} | null {
    const gameState = state as any;
    
    if (gameState.players.length >= 2) {
        return {
            state,
            accept: false,
            rejectMessage: 'Match is full'
        };
    }
    
    if (gameState.reservedPlayers.length > 0) {
        if (!gameState.reservedPlayers.includes(presence.userId)) {
            logger.warn('User %s attempted to join reserved match', presence.userId);
            return {
                state,
                accept: false,
                rejectMessage: 'Match is reserved for matched players'
            };
        }
    }
    
    logger.info('Player join attempt accepted: %s', presence.userId);
    
    return {
        state,
        accept: true
    };
}

function matchJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, presences: nkruntime.Presence[]): {state: nkruntime.MatchState} | null {
    const gameState = state as any;
    
    presences.forEach((presence) => {
        let username = presence.username || 'Player';
        try {
            const account = nk.accountGetId(presence.userId);
            if (account && account.user && account.user.username) {
                username = account.user.username;
            }
        } catch (e) {
            logger.warn('Account lookup failed for user %s, using presence username', presence.userId);
        }
        const symbol = gameState.players.length === 0 ? 'X' : 'O';
        
        gameState.players.push({
            userId: presence.userId,
            username: username,
            symbol: symbol,
            sessionId: presence.sessionId
        });
        
        logger.info('Player joined: %s as %s', presence.userId, symbol);
    });
    
    if (gameState.players.length === 2) {
        gameState.gameStatus = 'active';
        
        const startMessage = JSON.stringify({
            type: 'game_start',
            players: gameState.players,
            currentTurn: gameState.currentTurn,
            board: gameState.board
        });
        
        dispatcher.broadcastMessage(OpCodes.UPDATE, startMessage, null, null);
        logger.info('Game started with 2 players');
        
        const newLabel = JSON.stringify({
            mode: 'tictactoe',
            status: 'active',
            players: 2,
            maxPlayers: 2
        });
        dispatcher.matchLabelUpdate(newLabel);
    }
    
    return { state: gameState };
}

function matchLeave(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, presences: nkruntime.Presence[]): {state: nkruntime.MatchState} | null {
    const gameState = state as any;
    
    presences.forEach((presence) => {
        gameState.players = gameState.players.filter((p: any) => p.sessionId !== presence.sessionId);
        logger.info('Player left: %s', presence.userId);
    });
    
    if (gameState.gameStatus === 'active' && gameState.players.length > 0) {
        const message = JSON.stringify({
            type: 'opponent_left'
        });
        dispatcher.broadcastMessage(OpCodes.OPPONENT_LEFT, message, null, null);
        gameState.gameStatus = 'completed';
        
        if (gameState.players.length === 1) {
            const remainingPlayer = gameState.players[0];
            updatePlayerStats(nk, logger, gameState, remainingPlayer.symbol);
        }
    }
    
    return { state: gameState };
}

function matchLoop(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, messages: nkruntime.MatchMessage[]): {state: nkruntime.MatchState} | null {
    const gameState = state as any;
    
    messages.forEach((message) => {
        if (message.opCode === OpCodes.MOVE) {
            const data = JSON.parse(nk.binaryToString(message.data));
            const position = data.position;
            
            const currentPlayer = gameState.players[gameState.currentTurn];
            
            if (!currentPlayer || message.sender.userId !== currentPlayer.userId) {
                logger.warn('Not player turn: %s', message.sender.userId);
                return;
            }
            
            if (position < 0 || position > 8 || gameState.board[position] !== null) {
                logger.warn('Invalid move at position: %d', position);
                return;
            }
            
            gameState.board[position] = currentPlayer.symbol;
            gameState.moveHistory.push({
                player: currentPlayer.userId,
                position: position,
                timestamp: Date.now()
            });
            
            logger.info('Move made: %s at position %d', currentPlayer.symbol, position);
            
            const winner = checkWinner(gameState.board);
            
            if (winner) {
                gameState.winner = winner;
                gameState.gameStatus = 'completed';
                
                const winMessage = JSON.stringify({
                    type: 'game_over',
                    winner: winner,
                    board: gameState.board,
                    reason: 'win'
                });
                
                dispatcher.broadcastMessage(OpCodes.GAME_OVER, winMessage, null, null);
                logger.info('Game over! Winner: %s', winner);
                
                updatePlayerStats(nk, logger, gameState, winner);
                
            } else if (gameState.moveHistory.length === 9) {
                gameState.gameStatus = 'completed';
                
                const drawMessage = JSON.stringify({
                    type: 'game_over',
                    winner: null,
                    board: gameState.board,
                    reason: 'draw'
                });
                
                dispatcher.broadcastMessage(OpCodes.GAME_OVER, drawMessage, null, null);
                logger.info('Game over! Draw');
                
                updatePlayerStats(nk, logger, gameState, null);
                
            } else {
                gameState.currentTurn = gameState.currentTurn === 0 ? 1 : 0;
                
                const updateMessage = JSON.stringify({
                    type: 'board_update',
                    board: gameState.board,
                    currentTurn: gameState.currentTurn,
                    lastMove: position
                });
                
                dispatcher.broadcastMessage(OpCodes.UPDATE, updateMessage, null, null);
            }
        }
    });
    
    return { state: gameState };
}

function matchSignal(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, data: string): {state: nkruntime.MatchState} | null {
    const gameState = state as any;
    
    try {
        const signalData = JSON.parse(data);
        
        if (signalData.type === 'reserve') {
            const userId = signalData.userId;
            if (userId && !gameState.reservedPlayers.includes(userId)) {
                gameState.reservedPlayers.push(userId);
                logger.info('Reserved spot for user: %s', userId);
            }
        }
    } catch (error) {
        logger.error('Error processing match signal: %s', error);
    }
    
    return { state: gameState };
}

function matchTerminate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, graceSeconds: number): {state: nkruntime.MatchState} | null {
    logger.info('Match terminated');
    return { state };
}

function checkWinner(board: (string | null)[]): string | null {
    const winPatterns = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6]
    ];
    
    for (const pattern of winPatterns) {
        const [a, b, c] = pattern;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }
    
    return null;
}



function updatePlayerStats(nk: nkruntime.Nakama, logger: nkruntime.Logger, gameState: any, winner: string | null) {
    logger.info('Starting stats update. Winner: %s', winner || 'DRAW');
    
    const leaderboardId = 'tictactoe_wins';
    
    gameState.players.forEach((player: any) => {
        try {
            const isWinner = winner !== null && player.symbol === winner;
            
            let username = player.username;
            if (!username || username === 'Unknown') {
                try {
                    const account = nk.accountGetId(player.userId);
                    username = account.user?.username || player.userId.substring(0, 8);
                } catch (e) {
                    username = player.userId.substring(0, 8);
                    logger.warn('Could not fetch username for %s', player.userId);
                }
            }
            
          
            nk.leaderboardRecordWrite(
                leaderboardId,
                player.userId,
                username, 
                isWinner ? 1 : 0, 
                1
            );
            
            logger.info('Leaderboard updated for %s: username=%s, isWinner=%s', 
                player.userId, username, isWinner);
            
            updateDetailedStats(nk, logger, player, isWinner, winner);
            
        } catch (error) {
            logger.error('Failed to update stats for player %s: %s', player.userId, error);
        }
    });
    
    logger.info('Stats update completed');
}


function updateDetailedStats(nk: nkruntime.Nakama, logger: nkruntime.Logger, player: any, isWinner: boolean, winner: string | null) {
    try {
        const storageKey = `stats_${player.userId}`;
        let stats = { wins: 0, losses: 0, draws: 0, totalGames: 0 };
        
        // Read existing stats
        const objects = nk.storageRead([{
            collection: 'player_stats',
            key: storageKey,
            userId: player.userId
        }]);
        
        if (objects && objects.length > 0) {
            stats = objects[0].value as typeof stats;
        }
        
        // Update based on result
        if (isWinner) {
            stats.wins++;
        } else if (winner === null) {
            stats.draws++;
        } else {
            stats.losses++;
        }
        stats.totalGames++;
        
        nk.storageWrite([{
            collection: 'player_stats',
            key: storageKey,
            userId: player.userId,
            value: stats,
            permissionRead: 2, // Public read
            permissionWrite: 0 // Server-only write
        }]);
        
        logger.info('Detailed stats for %s: W:%d L:%d D:%d', player.username, stats.wins, stats.losses, stats.draws);
    } catch (error) {
        logger.error('Failed to update detailed stats: %s', error);
    }
}


function rpcGetLeaderboard(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
        logger.info('Leaderboard request from user: %s', ctx.userId);
        
        const leaderboardId = 'tictactoe_wins';
        const ownerIds: string[] = [];
        const limit = 100;
        
        const records = nk.leaderboardRecordsList(
            leaderboardId, 
            ownerIds, 
            limit
        );
        
        logger.info('Found %d leaderboard records', records.records?.length || 0);
        
        if (!records.records || records.records.length === 0) {
            return JSON.stringify({ success: true, leaderboard: [] });
        }
        
        const leaderboard = records.records.map((record: any) => {
            const wins = record.score || 0;
            const totalGames = record.subscore || 0;
            const winRate = totalGames > 0 ? (wins / totalGames) * 100 : 0;
            
            return {
                userId: record.ownerId,
                username: record.username?.value || 'Unknown', 
                wins: wins,
                totalGames: totalGames, 
                winRate: Math.round(winRate * 100) / 100, 
                rank: record.rank
            };
        });
        
        logger.info('Leaderboard fetched with %d entries', leaderboard.length);
        
        return JSON.stringify({ 
            success: true, 
            leaderboard: leaderboard
        });
    } catch (error) {
        logger.error('Error fetching leaderboard: %s', error);
        return JSON.stringify({ 
            success: false, 
            error: 'Failed to fetch leaderboard' 
        });
    }
}


function rpcGetPlayerStats(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
        logger.info('Player stats request from user: %s', ctx.userId);
        
        const objects = nk.storageRead([{
            collection: 'player_stats',
            key: `stats_${ctx.userId}`,
            userId: ctx.userId || ''
        }]);
        
        let stats = { wins: 0, losses: 0, draws: 0 };
        
        if (objects && objects.length > 0) {
            stats = objects[0].value as { wins: number; losses: number; draws: number };
            logger.info('Stats for %s: W:%d L:%d D:%d', ctx.userId, stats.wins, stats.losses, stats.draws);
        } else {
            logger.info('No stats found for user: %s', ctx.userId);
        }
        
        return JSON.stringify({ success: true, stats: stats });
    } catch (error) {
        logger.error('Error fetching player stats: %s', error);
        return JSON.stringify({ success: false, error: 'Failed to fetch stats' });
    }
}

function rpcHealthCheck(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    logger.info('Health check from user: %s', ctx.userId);
    return JSON.stringify({ success: true, message: 'Server is healthy', timestamp: Date.now() });
}

function rpcTestStats(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
        logger.info('Test stats request from user: %s', ctx.userId);
        
        const testStats = { wins: 5, losses: 2, draws: 1 };
        
        nk.storageWrite([{
            collection: 'player_stats',
            key: `stats_${ctx.userId}`,
            userId: ctx.userId,
            value: testStats,
            permissionRead: 2,
            permissionWrite: 0
        }]);
        
        logger.info('Test stats created for user %s: %s', ctx.userId, JSON.stringify(testStats));
        return JSON.stringify({ success: true, message: 'Test stats created', stats: testStats });
    } catch (error) {
        logger.error('Error creating test stats: %s', error);
        return JSON.stringify({ success: false, error: 'Failed to create test stats' });
    }
}

