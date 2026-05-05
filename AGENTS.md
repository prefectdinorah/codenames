# Codenames — party games hub

Краткая памятка для **Cursor Agent / CLI** и людей. Подробности — в каталоге [`docs/`](docs/README.md).

## Репозиторий

- **Назначение:** один сервер — комнаты по коду, WebSocket-синхронизация, несколько режимов: Codenames, Alias, Spyfall, Крокодил, Кто я?, Монополия.
- **Стек:** Node.js 20, Express (статика + JSON API админки), `ws`, опционально AWS SDK v3 + S3 (колоды/логотипы монополии, картинки Spyfall).
- **Клиент:** `public/app.js`, `public/admin.js`, `public/index.html`, `public/style.css`.

## Запуск локально

```bash
cp .env.example .env   # при необходимости поправь значения
npm install
npm start              # слушает PORT из окружения, по умолчанию 3000
```

Открой в браузере `http://localhost:3000`. Без заполненных S3-ключей монополия и админка работают в **in-memory** режиме (состояние колод не переживает перезапуск).

## Docker (локально или на сервере)

```bash
cp .env.example .env
docker compose build
docker compose up -d
```

Порт **3000** проброшен в `docker-compose.yml`. Переменные подхватываются из `.env`.

## Деплой на хост (типичный сценарий)

На машине, куда уходит `git pull` из этого репозитория:

1. Клон или уже существующий каталог с репо (например `~/dev/codenames` или `/root/dev/codenames`).
2. **`cp .env.example .env`** на сервере один раз; заполнить `S3_*` для продакшена, при необходимости `MAINTENANCE_*`, URL картинок Spyfall/Monopoly.
3. Обновление кода: **`git pull origin main`** (или ваша ветка).
4. Перезапуск:
   - **Docker:** `docker compose build --no-cache` при смене зависимостей, иначе `docker compose up -d --build`.
   - **Без Docker:** `npm ci --omit=dev && npm start` под process manager (systemd, pm2 и т.д.).

Секреты (**`.env`**) не коммитить. Пароли и ключи хранить только на сервере / в секрет-хранилище.

## Режим обслуживания

`MAINTENANCE_MODE=1` и `MAINTENANCE_PASS=<секрет>` — отдаётся `public/maintenance.html`, WebSocket отклоняется. Обход: открыть сайт с `?bypass=<MAINTENANCE_PASS>` (cookie на 30 дней). См. [`docs/05-environment-variables.md`](docs/05-environment-variables.md).

## Админка Монополии

Доступ к API: заголовок `x-admin-name` должен совпадать с allowlist в `server.js` (`SPECIAL_USER_NAMES`). UI редактора — в клиенте (кнопка для «барона» / спец-пользователя). Маршруты `/api/admin/*`.

## Где копать код

| Область | Файлы |
|--------|--------|
| Комнаты, WS, все режимы | `server.js` |
| Данные монополии (классическая доска) | `monopoly-data.js` |
| Персист колод / логотипов | `monopoly-store.js` |
| Слова / локации | `words.js`, `alias-words.js`, `spyfall-locations.js`, `crocodile-words.js` |
| Картинки Spyfall в S3 | `scripts/upload-spyfall-images.sh` |

## Документация и внешние системы

- **Канонический источник правды:** папка **`docs/`** в репозитории (Markdown, версионируется в git).
- **Obsidian:** открой корень репозитория или только `docs/` как vault — все ссылки и поиск по графу работают локально.
- **Notion:** отдельного «агента Cursor только для Notion» нет; используй **MCP Notion** в Cursor и скилл *knowledge-capture* / ручной импорт, либо держи в Notion **ссылку на GitHub** и дублируй только саммари. Чтобы не расходились тексты, правь сначала `docs/`, потом при необходимости экспортируй фрагмент в Notion.

## Правила Cursor в этом проекте

См. `.cursor/rules/game-hub.mdc` (always-on контекст по архитектуре).
