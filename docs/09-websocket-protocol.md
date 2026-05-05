# WebSocket: типы сообщений

Клиент шлёт JSON `{ type: '...', ... }`. Сервер отвечает **`{ type: 'state', ... }`** (полное состояние для текущего игрока), плюс для крокодила — отдельные **`croc-draw`** / **`croc-clear`** без обёртки `state`. Ошибки: **`{ type: 'error', message }`**.

## Общие (любой режим после входа в комнату)

| `type` | Назначение |
|--------|------------|
| `create-room` | Создать комнату; поля: `name`, `gameMode`. |
| `join-room` | Войти по коду: `code`, `name`. |
| `change-name` | Сменить имя. |
| `pick-team` | Команда / роль / выход в зрителей (`team`, `role` по режиму). |
| `toggle-pause` | Пауза (только хост). |

## Codenames

`update-settings`, `give-clue`, `vote-card`, `end-turn`, `new-game`, `shuffle-players`.

## Alias

`update-settings`, `start-turn`, `word-correct`, `word-skip`, `toggle-word-result`, `confirm-turn`, `new-game`, `shuffle-players`.

## Spyfall

`update-settings`, `start-game`, `next-turn`, `accuse`, `vote-accuse`, `cancel-accusation`, `spy-guess`, `new-game`.

## Крокодил

`update-settings`, `start-turn`, `croc-guess`, `croc-skip`, `new-game`, `shuffle-players`, плюс relay: **`croc-draw`**, **`croc-clear`**.

## Кто я?

`update-settings`, `assign-word`, `start-game`, `save-notebook`, `guess-word`, `skip-turn`, `new-game`.

## Монополия

`update-settings`, `start-game`, `roll-dice`, `buy-property`, `skip-buy`, `auction-bid`, `auction-pass`, `casino-bet`, `casino-skip`, `end-turn`, `pay-jail`, `pay-debt`, `build-house`, `sell-house`, `mortgage-property`, `unmortgage-property`, `trade-propose`, `trade-cancel`, `trade-respond`, `new-game`.

Серверное состояние Монополии также отдаёт `animationSeq` / `animationEvents` для поэтапного проигрывания: кубики → перемещение → карточка → эффект карточки.

---

Параметры полей (`index`, `count`, id игроков и т.д.) **не дублируются здесь** — смотри вызовы `send({...})` в **`public/app.js`** и проверки в **`handle*Msg` / `handleMonopolyMsg`** в **`server.js`**. При добавлении нового типа сообщения обнови эту таблицу.
