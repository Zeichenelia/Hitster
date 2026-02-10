# Hitster Multiplayer Game Rules (MVP)

## Setup

- The host chooses one or more packs to play.
- The host defines:
  - Number of teams.
  - Win condition: number of correct cards required to win.
  - Guess mode:
    - Year only (always required),
    - Year + Artist,
    - Year + Artist + Title.
  - Optional timer: enabled or disabled, plus time per turn (seconds).

## Lobby

- A lobby is created with an invite link.
- Players join the lobby and select a team.
- The host can trigger random team assignment (balanced: 3v3, 2v2, 3v2, etc.).

## Game Start

- A single shared draw pile is built from the selected packs.
- Each team receives exactly one face-up reference card.
- The reference song is played until the host ends the intro round.
- After all teams have a reference card, normal turns begin.

## Turn Flow

1. The active team draws one hidden card from the shared draw pile.
2. The song is played.
3. The team places the card into its timeline relative to its existing cards.
4. The team locks in its placement.
5. The card is revealed.
6. If the placement and all required fields are correct, the card stays on the timeline.
7. If incorrect, the card is removed from the game.

## Validation

- Year is always required and must be correct for the placement to be valid.
- If guess mode includes Artist and/or Title, those fields must also match.
- There are no partial points.

## Winning

- A team wins when it reaches the required number of correct cards.
- If multiple teams reach the target in the same round, the game continues.
- Sudden death continues until one team finishes a round with a higher total than the others.

## Notes

- There is always exactly one reference card per team.
- The draw pile is shared across all teams.
