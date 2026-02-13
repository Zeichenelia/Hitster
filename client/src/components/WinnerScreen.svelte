<script>
  import { createEventDispatcher } from "svelte";

  export let winnerName = "";
  export let winnerPlayers = [];
  export let playerColors = {};

  const dispatch = createEventDispatcher();

  function handlePlayAgain() {
    dispatch("playAgain");
  }
</script>

<div class="winner-overlay">
  <div class="confetti-container">
    {#each Array(150) as _}
      <div
        class="confetto"
        style="
          --left: {Math.random() * 100}vw;
          --hue: {Math.random() * 360};
          --delay: {Math.random() * 5}s;
          --duration: {3 + Math.random() * 2}s;
        "
      ></div>
    {/each}
  </div>

  <div class="winner-content">
    <p class="winner-tag">Winner</p>
    <h1 class="winner-name">{winnerName}</h1>
        {#if winnerPlayers.length > 0}
      <div class="winner-players">
        {#each winnerPlayers as player}
          <span
            class="winner-player"
            style={`--player-glow: ${playerColors[player.id] || "#3df0ff"}`}
          >
            {player.name}
          </span>
        {/each}
      </div>
    {/if}
    <p class="win-message">hat Hitster gewonnen!</p>
    <button class="play-again-btn primary" on:click={handlePlayAgain}>Nochmal spielen</button>
  </div>
</div>

<style>
  .winner-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 10000;
    display: flex;
    justify-content: center;
    align-items: center;
    background: radial-gradient(circle at top, rgba(26, 16, 38, 0.96) 0%, rgba(11, 11, 15, 0.98) 55%, rgba(6, 6, 7, 1) 100%);
    color: var(--text, #f5f5f8);
    text-align: center;
    font-family: "Sora", sans-serif;
    overflow: hidden;
  }

  .winner-overlay::before {
    content: "";
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 30% 20%, rgba(255, 122, 230, 0.18), transparent 55%),
      radial-gradient(circle at 70% 30%, rgba(61, 240, 255, 0.12), transparent 60%);
    pointer-events: none;
  }

  .winner-content {
    animation: fadeInContent 1.6s ease-out forwards;
    z-index: 2;
    background: rgba(16, 16, 24, 0.7);
    border: 1px solid rgba(255, 122, 230, 0.35);
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45), 0 0 30px rgba(255, 122, 230, 0.2);
    border-radius: 22px;
    padding: clamp(24px, 5vw, 40px);
    min-width: min(520px, 90vw);
  }

  @keyframes fadeInContent {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.96);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .winner-tag {
    margin: 0 0 8px;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    font-size: 12px;
    color: var(--muted, #a7a8b4);
    font-family: "Space Mono", monospace;
  }

  .winner-name {
    font-size: clamp(2.8rem, 8vw, 5.2rem);
    margin: 0.2rem 0 0.6rem;
    color: #ffd9f0;
    text-shadow: 0 0 18px rgba(255, 122, 230, 0.45);
  }

  .win-message {
    font-size: clamp(1rem, 3vw, 1.3rem);
    margin: 0;
    color: var(--muted, #a7a8b4);
  }

  .winner-players {
    margin-top: 16px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
  }

  .winner-player {
    padding: 6px 12px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--player-glow, #3df0ff), #0b0b0f 82%);
    border: 1px solid color-mix(in srgb, var(--player-glow, #3df0ff), #ffffff 18%);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--player-glow, #3df0ff), #000000 55%),
      0 0 14px color-mix(in srgb, var(--player-glow, #3df0ff), transparent 35%);
    color: #f5f5f8;
    font-size: 13px;
  }

  .play-again-btn {
    font-size: 1.1rem;
    padding: 0.75rem 2.4rem;
    margin-top: 2rem;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }

  .play-again-btn:hover {
    transform: translateY(-1px) scale(1.02);
  }

  .confetti-container {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 1;
  }

  .confetto {
    position: absolute;
    width: 10px;
    height: 20px;
    background-color: hsl(var(--hue), 100%, 65%);
    top: -20px;
    left: var(--left);
    animation-name: fall;
    animation-timing-function: linear;
    animation-iteration-count: infinite;
    animation-delay: var(--delay);
    animation-duration: var(--duration);
  }

  @keyframes fall {
    0% {
      transform: translateY(0vh) rotate(0deg);
      opacity: 1;
    }
    100% {
      transform: translateY(105vh) rotate(720deg);
      opacity: 0;
    }
  }
</style>
