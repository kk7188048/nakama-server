//tic tac toe implemenation for types of it
interface GameState {
    board: (string | null)[];  // 9 cells: null, 'X', or 'O'
    players: PlayerInfo[];
    currentTurn: number;       // 0 or 1
    winner: string | null;
    gameStatus: 'waiting' | 'active' | 'completed';
    startTime: number;
    moveHistory: Move[];
}

interface PlayerInfo {
    userId: string;
    username: string;
    symbol: 'X' | 'O';
    sessionId: string;
}

interface Move {
    player: string;
    position: number;
    timestamp: number;
}

enum OpCode {
    MOVE = 1,
    UPDATE = 2,
    GAME_OVER = 3,
    OPPONENT_LEFT = 4
}
