# HTTP API

Базовый префикс JSON-тела для админки: клиент шлёт **`Content-Type: application/json`** где применимо. Загрузка логотипа — `multipart/form-data` с полем файла.

## Публичные

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/monopoly/decks` | `{ decks: string[] }` — id колод для UI. |

Статика: весь **`public/`** (в т.ч. `admin.js`, но вызовы админ API требуют заголовка).

## Админ (заголовок `x-admin-name`)

Все ниже возвращают **403**, если имя не в allowlist.

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/admin/state` | Сводка: колоды, логотипы, флаг `s3Enabled`. |
| GET | `/api/admin/decks` | Список id. |
| GET | `/api/admin/decks/:id` | Полная колода. |
| PUT | `/api/admin/decks/:id` | Сохранить колоду (тело — объект колоды). |
| DELETE | `/api/admin/decks/:id` | Удалить колоду. |
| POST | `/api/admin/decks/:id/duplicate` | Дубликат с новым id/именем. |
| GET | `/api/admin/logos` | Список логотипов. |
| POST | `/api/admin/logos` | Загрузка файла (+ поля формы `name`, `tags`). |
| DELETE | `/api/admin/logos/:id` | Удалить логотип. |
| GET | `/api/admin/logos/:id/usage` | Где используется логотип. |

Точные поля тел ответов смотри в обработчиках **`server.js`** (секция ADMIN API).
