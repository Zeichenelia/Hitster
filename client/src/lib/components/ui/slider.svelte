<script>
  import { createEventDispatcher } from "svelte";

  export let type = "single";
  export let value = 0;
  export let min = 0;
  export let max = 100;
  export let step = 1;
  export let orientation = "horizontal";
  export let ariaLabel = "";
  export let disabled = false;
  export let className = "";

  const dispatch = createEventDispatcher();

  const handleInput = (event) => {
    const nextValue = Number(event.currentTarget.value);
    value = Number.isNaN(nextValue) ? 0 : nextValue;
    dispatch("value", value);
    dispatch("input", value);
  };
</script>

<input
  type="range"
  class={`ui-slider ${orientation === "vertical" ? "ui-slider-vertical" : ""} ${className}`}
  {min}
  {max}
  {step}
  {disabled}
  value={value}
  aria-label={ariaLabel || "Slider"}
  on:input={handleInput}
/>
