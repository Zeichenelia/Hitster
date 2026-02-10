<script>
  export let joinName = "";
  export let onJoin = () => {};
</script>

<div class="modal-backdrop">
  <div class="modal">
    <h2>Join lobby</h2>
    <p class="hint">Enter your name to join this room.</p>
    <label>
      Player name
      <input bind:value={joinName} placeholder="Player" />
    </label>
    <button class="primary" on:click={onJoin}>Join lobby</button>
  </div>
</div>
