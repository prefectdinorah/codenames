# Локальная разработка

## Требования

- **Node.js 20+** (как в `Dockerfile`: `node:20-alpine`).
- Доступ в интернет для `npm install` (пакеты из npm).

## Первый запуск

```bash
git clone <url> codenames
cd codenames
cp .env.example .env
npm install
npm start
```

По умолчанию сервер слушает **`process.env.PORT || 3000`**.

## Без S3

Можно не задавать `S3_ACCESS_KEY` / `S3_SECRET_KEY`: `monopoly-store` использует in-memory состояние после старта. Для проверки загрузки логотипов и сохранения колод нужен реальный S3 или мок (не входит в репо).

## Полезные приёмы

- Логи в консоли процесса (`console.log` / ошибки S3).
- Для Spyfall картинки задаются URL-префиксом в env — без него игра работает с плейсхолдерами.
- Несколько вкладок браузера с разными именами — разные `playerId` в одной комнате.

## Стиль правок

- Новые режимы или крупные ветки в `server.js` лучше сопровождать строкой в [06-game-modes.md](06-game-modes.md) или [09-websocket-protocol.md](09-websocket-protocol.md).
