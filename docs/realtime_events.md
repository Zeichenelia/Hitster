# Realtime Events (MVP)

This list defines the minimal socket events and payloads for the multiplayer loop.

## Lobby

- room:create
  - payload: { hostName }
  - response: { roomCode, hostId }

- room:join
  - payload: { roomCode, playerName }
  - response: { playerId, roomState }

- room:leave
  - payload: { roomCode, playerId }

- team:join
  - payload: { roomCode, playerId, teamId }

- team:randomize
  - payload: { roomCode }

- rules:update
  - payload: { roomCode, rules }
  - rules: { packs, teams, winTarget, guessMode, timerEnabled, timerSeconds }

## Game

- game:start
  - payload: { roomCode }
  - response: { gameState }

- game:next-turn
  - payload: { roomCode }
  - response: { activeTeamId, cardId }

- game:play-card
  - payload: { roomCode, teamId, cardId, placementIndex }
  - response: { result, updatedTimeline, remainingCards }

- game:reveal-card
  - payload: { roomCode, cardId }
  - response: { card }

- game:end-round
  - payload: { roomCode }
  - response: { standings, isSuddenDeath }

## Sync

- state:sync
  - payload: { roomCode }
  - response: { roomState, gameState }

- timer:start
  - payload: { roomCode, teamId, seconds }

- timer:stop
  - payload: { roomCode }

## System

- error
  - payload: { code, message }

- ping
  - payload: { t }

- pong
  - payload: { t }
