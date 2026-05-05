# Документация проекта Codenames (party hub)

Оглавление. Файлы в **Markdown**; основной источник для разработки, деплоя и онбординга.

| Документ | Содержание |
|----------|------------|
| [01-overview.md](01-overview.md) | Что это за проект, пользовательский сценарий |
| [02-architecture.md](02-architecture.md) | Сервер, комнаты, WebSocket, рассылка состояния |
| [03-local-development.md](03-local-development.md) | Локальный запуск, отладка |
| [04-deployment.md](04-deployment.md) | Docker и деплой на хост |
| [05-environment-variables.md](05-environment-variables.md) | Переменные `.env` / `.env.example` |
| [06-game-modes.md](06-game-modes.md) | Режимы игр, кратко о правилах в коде |
| [07-monopoly.md](07-monopoly.md) | Монополия: данные, S3, админ API, клиент |
| [08-http-api.md](08-http-api.md) | REST маршруты (публичные и админ) |
| [09-websocket-protocol.md](09-websocket-protocol.md) | Типы сообщений WS по режимам |
| [10-cursor-obsidian-notion.md](10-cursor-obsidian-notion.md) | Как стыковать доки с Cursor, Obsidian, Notion |

Корневой **[AGENTS.md](../AGENTS.md)** — сжатая выжимка для AI-агента Cursor и быстрый чеклист запуска.

## Obsidian

1. *File → Open folder as vault* → выбери клон репозитория **или** только `docs/`.
2. Внутренние ссылки `[foo](bar.md)` работают как обычно.
3. При желании включи плагин Git для коммитов из Obsidian.

## Notion

Рекомендация: в Notion хранить **оглавление + ссылку на репозиторий** (GitHub) и чеклисты релиза; детальные спеки дублировать полностью не обязательно — иначе два источника правды. Если нужен полный перенос страницы в Notion, используй MCP Notion в Cursor или экспорт MD.
