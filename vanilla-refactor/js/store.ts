import type { AppConfig, GameState, Move, Player } from "./types";

const initialState = {
  currentGameMoves: [], // All the player moves for the active game
  history: {
    currentRoundGames: [],
    allGames: [],
  },
};

/**
 * Store is (loosely) the "Model" in the MV* or MVC pattern
 *
 * Think of this as our abstraction on top of an arbitrary data store.
 * In this app, we're using localStorage, but this class should not require
 * much change if we wanted to change our storage location to an in-memory DB,
 * external location, etc. (just change #getState and #saveState methods)
 */
export default class Store extends EventTarget {
  constructor(
    private readonly storageKey: string,
    private readonly config: AppConfig
  ) {
    // Since we're extending EventTarget, need to call super() so we have ability to create custom events
    super();

    // On first load, need to refresh so localStorage state gets rendered in browser
    this.refreshStorage();
  }

  get stats() {
    const state = this.#getState();

    return state.history.currentRoundGames.reduce(
      (prev, curr) => {
        return {
          p1Wins:
            prev.p1Wins +
            (curr.status.winner?.id === this.config.player1.id ? 1 : 0),
          p2Wins:
            prev.p2Wins +
            (curr.status.winner?.id === this.config.player2.id ? 1 : 0),
          ties: prev.ties + (curr.status.winner === null ? 1 : 0),
        };
      },
      {
        p1Wins: 0,
        p2Wins: 0,
        ties: 0,
      }
    );
  }

  get game() {
    const state = this.#getState();

    /**
     * Player 1 always starts game.  If no moves yet, it is P1's turn.
     *
     * Otherwise, check who played last to determine who's turn it is.
     */
    let currentPlayer = this.config.player1;
    if (state.currentGameMoves.length) {
      const lastPlayer = state.currentGameMoves.at(-1)?.player;

      if (!lastPlayer) throw new Error("No player found");

      currentPlayer =
        lastPlayer?.id === this.config.player1.id
          ? this.config.player2
          : this.config.player1;
    }

    const winner = this.#getWinner(state.currentGameMoves);

    return {
      moves: state.currentGameMoves,
      currentPlayer,
      status: {
        isComplete: winner != null || state.currentGameMoves.length === 9,
        winner,
      },
    };
  }

  playerMove(squareId: Move["squareId"]) {
    /**
     * Never mutate state directly.  Create copy of state, edit the copy,
     * and save copy as new version of state.
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/API/structuredClone
     * @see https://redux.js.org/style-guide/#do-not-mutate-state
     */
    const { currentGameMoves } = structuredClone(this.#getState());

    currentGameMoves.push({
      player: this.game.currentPlayer,
      squareId,
    });

    this.#saveState((prev: GameState) => ({ ...prev, currentGameMoves }));
  }

  /**
   * Resets the game.
   *
   * If the current game is complete, the game is archived.
   * If the current game is NOT complete, it is deleted.
   */
  reset() {
    const stateCopy = structuredClone(this.#getState());

    // If game is complete, archive it to history object
    if (this.game.status.isComplete) {
      const { moves, status } = this.game;
      stateCopy.history.currentRoundGames.push({ moves, status });
    }

    stateCopy.currentGameMoves = [];
    this.#saveState(stateCopy);
  }

  /**
   * Resets the scoreboard (wins, losses, and ties)
   */
  newRound() {
    this.reset();

    const stateCopy = structuredClone(this.#getState());
    stateCopy.history.allGames.push(...stateCopy.history.currentRoundGames);
    stateCopy.history.currentRoundGames = [];

    this.#saveState(stateCopy);
  }

  /** When state is changed from another browser tab, state should be refreshed in current tab */
  refreshStorage() {
    this.#saveState(this.#getState());
  }

  #getWinner(moves: Move[]): Player | null {
    const p1Moves = moves
      .filter((move) => move.player.id === this.config.player1.id)
      .map((move) => +move.squareId);

    const p2Moves = moves
      .filter((move) => move.player.id === this.config.player2.id)
      .map((move) => +move.squareId);

    // Our grid starts in top-left corner and increments left=>right, top=>bottom
    const winningPatterns = [
      [1, 2, 3],
      [1, 5, 9],
      [1, 4, 7],
      [2, 5, 8],
      [3, 5, 7],
      [3, 6, 9],
      [4, 5, 6],
      [7, 8, 9],
    ];

    let winner = null;

    winningPatterns.forEach((pattern) => {
      const p1Wins = pattern.every((v) => p1Moves.includes(v));
      const p2Wins = pattern.every((v) => p2Moves.includes(v));

      if (p1Wins) winner = this.config.player1;
      if (p2Wins) winner = this.config.player2;
    });

    return winner;
  }

  /**
   * Private state reducer that transitions from the old state to the new state
   * and saves it to localStorage.  Every time state changes, a custom 'statechange'
   * event is emitted.
   *
   * @param {*} stateOrFn can be an object or callback fn
   *
   * We are not using Redux here, but it gives a good overview of some essential concepts to managing state:
   * @see https://redux.js.org/understanding/thinking-in-redux/three-principles#changes-are-made-with-pure-functions
   */
  #saveState(stateOrFn: ((prev: GameState) => GameState) | GameState) {
    const prevState = this.#getState();

    let newState;

    switch (typeof stateOrFn) {
      // When callback fn is passed, call it with the prior state and derive the new state from it
      case "function":
        newState = stateOrFn(prevState);
        break;

      // When object passed, set it directly
      case "object":
        newState = stateOrFn;
        break;
      default:
        throw new Error("Must pass object or fn to #saveState() method");
    }

    // Update state and emit event
    window.localStorage.setItem(this.storageKey, JSON.stringify(newState));
    this.dispatchEvent(new Event("statechange"));
  }

  #getState(): GameState {
    const item = window.localStorage.getItem(this.storageKey);
    return item ? JSON.parse(item) : initialState;
  }
}
