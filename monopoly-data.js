// Monopoly game data — V1.
// Prices/rents follow the classic board progression (60..400).
// Rent array: [base, 1 house, 2 houses, 3 houses, 4 houses, hotel].
// V1 only uses rent[0] (doubled if owner holds the whole group).

const groups = {
  fastfood:     { name: 'Фастфуд',       color: '#8B4513' },
  messengers:   { name: 'Мессенджеры',   color: '#AADBEB' },
  streaming:    { name: 'Стриминг',      color: '#D93A96' },
  delivery:     { name: 'Доставка',      color: '#F7941D' },
  tech:         { name: 'Бигтех',        color: '#ED1B24' },
  marketplaces: { name: 'Маркетплейсы',  color: '#FEF200' },
  banks:        { name: 'Банки',         color: '#1FB25A' },
  premium:      { name: 'Премиум',       color: '#0072BB' },
};

const properties = {
  // Fastfood (brown, 2)
  burger_king:   { name: 'Burger King',   domain: 'burgerking.com',  group: 'fastfood',     price: 60,  rent: [2, 10, 30, 90, 160, 250],    house: 50 },
  kfc:           { name: 'KFC',           domain: 'kfc.com',         group: 'fastfood',     price: 60,  rent: [4, 20, 60, 180, 320, 450],   house: 50 },
  // Messengers (light blue, 3)
  telegram:      { name: 'Telegram',      domain: 'telegram.org',    group: 'messengers',   price: 100, rent: [6, 30, 90, 270, 400, 550],   house: 50 },
  whatsapp:      { name: 'WhatsApp',      domain: 'whatsapp.com',    group: 'messengers',   price: 100, rent: [6, 30, 90, 270, 400, 550],   house: 50 },
  vk:            { name: 'ВКонтакте',     domain: 'vk.com',          group: 'messengers',   price: 120, rent: [8, 40, 100, 300, 450, 600],  house: 50 },
  // Streaming (pink, 3)
  netflix:       { name: 'Netflix',       domain: 'netflix.com',     group: 'streaming',    price: 140, rent: [10, 50, 150, 450, 625, 750], house: 100 },
  spotify:       { name: 'Spotify',       domain: 'spotify.com',     group: 'streaming',    price: 140, rent: [10, 50, 150, 450, 625, 750], house: 100 },
  youtube:       { name: 'YouTube',       domain: 'youtube.com',     group: 'streaming',    price: 160, rent: [12, 60, 180, 500, 700, 900], house: 100 },
  // Delivery (orange, 3)
  yandex_eda:    { name: 'Яндекс.Еда',    domain: 'eda.yandex.ru',   group: 'delivery',     price: 180, rent: [14, 70, 200, 550, 750, 950], house: 100 },
  delivery_club: { name: 'Delivery Club', domain: 'delivery-club.ru',group: 'delivery',     price: 180, rent: [14, 70, 200, 550, 750, 950], house: 100 },
  samokat:       { name: 'Самокат',       domain: 'samokat.ru',      group: 'delivery',     price: 200, rent: [16, 80, 220, 600, 800, 1000],house: 100 },
  // Tech (red, 3)
  google:        { name: 'Google',        domain: 'google.com',      group: 'tech',         price: 220, rent: [18, 90, 250, 700, 875, 1050],house: 150 },
  microsoft:     { name: 'Microsoft',     domain: 'microsoft.com',   group: 'tech',         price: 220, rent: [18, 90, 250, 700, 875, 1050],house: 150 },
  yandex:        { name: 'Яндекс',        domain: 'yandex.ru',       group: 'tech',         price: 240, rent: [20, 100, 300, 750, 925, 1100],house: 150 },
  // Marketplaces (yellow, 3)
  wildberries:   { name: 'Wildberries',   domain: 'wildberries.ru',  group: 'marketplaces', price: 260, rent: [22, 110, 330, 800, 975, 1150],house: 150 },
  ozon:          { name: 'Ozon',          domain: 'ozon.ru',         group: 'marketplaces', price: 260, rent: [22, 110, 330, 800, 975, 1150],house: 150 },
  amazon:        { name: 'Amazon',        domain: 'amazon.com',      group: 'marketplaces', price: 280, rent: [24, 120, 360, 850, 1025, 1200],house: 150 },
  // Banks (green, 3)
  sber:          { name: 'Сбербанк',      domain: 'sberbank.ru',     group: 'banks',        price: 300, rent: [26, 130, 390, 900, 1100, 1275],house: 200 },
  tinkoff:       { name: 'Тинькофф',      domain: 'tbank.ru',        group: 'banks',        price: 300, rent: [26, 130, 390, 900, 1100, 1275],house: 200 },
  vtb:           { name: 'ВТБ',           domain: 'vtb.ru',          group: 'banks',        price: 320, rent: [28, 150, 450, 1000, 1200, 1400],house: 200 },
  // Premium (dark blue, 2)
  apple:         { name: 'Apple',         domain: 'apple.com',       group: 'premium',      price: 350, rent: [35, 175, 500, 1100, 1300, 1500],house: 200 },
  tesla:         { name: 'Tesla',         domain: 'tesla.com',       group: 'premium',      price: 400, rent: [50, 200, 600, 1400, 1700, 2000],house: 200 },
};

// Transport: rent scales with how many of 4 you own.
const transport = {
  aeroflot:  { name: 'Аэрофлот',  domain: 'aeroflot.ru', price: 200 },
  s7:        { name: 'S7',        domain: 's7.ru',       price: 200 },
  rzd:       { name: 'РЖД',       domain: 'rzd.ru',      price: 200 },
  yandex_go: { name: 'Yandex Go', domain: 'taxi.yandex.ru', price: 200 },
};
const TRANSPORT_RENT = [25, 50, 100, 200]; // owned 1..4

// Utilities: if both owned, rent = 10× dice; otherwise 4× dice.
const utilities = {
  gazprom:  { name: 'Газпром',  domain: 'gazprom.ru',  price: 150 },
  rosneft:  { name: 'Роснефть', domain: 'rosneft.com', price: 150 },
};

// Board: 40 squares, clockwise from GO.
const board = [
  { type: 'go' },                               // 0
  { type: 'property', slug: 'burger_king' },    // 1
  { type: 'chest' },                            // 2
  { type: 'property', slug: 'kfc' },            // 3
  { type: 'tax',      amount: 200, name: 'Подоходный налог' }, // 4
  { type: 'transport', slug: 'aeroflot' },      // 5
  { type: 'property', slug: 'telegram' },       // 6
  { type: 'chance' },                           // 7
  { type: 'property', slug: 'whatsapp' },       // 8
  { type: 'property', slug: 'vk' },             // 9
  { type: 'jail' },                             // 10
  { type: 'property', slug: 'netflix' },        // 11
  { type: 'utility',  slug: 'gazprom' },        // 12
  { type: 'property', slug: 'spotify' },        // 13
  { type: 'property', slug: 'youtube' },        // 14
  { type: 'transport', slug: 's7' },            // 15
  { type: 'property', slug: 'yandex_eda' },     // 16
  { type: 'chest' },                            // 17
  { type: 'property', slug: 'delivery_club' },  // 18
  { type: 'property', slug: 'samokat' },        // 19
  { type: 'casino' },                           // 20
  { type: 'property', slug: 'google' },         // 21
  { type: 'chance' },                           // 22
  { type: 'property', slug: 'microsoft' },      // 23
  { type: 'property', slug: 'yandex' },         // 24
  { type: 'transport', slug: 'rzd' },           // 25
  { type: 'property', slug: 'wildberries' },    // 26
  { type: 'property', slug: 'ozon' },           // 27
  { type: 'utility',  slug: 'rosneft' },        // 28
  { type: 'property', slug: 'amazon' },         // 29
  { type: 'go_to_jail' },                       // 30
  { type: 'property', slug: 'sber' },           // 31
  { type: 'property', slug: 'tinkoff' },        // 32
  { type: 'chest' },                            // 33
  { type: 'property', slug: 'vtb' },            // 34
  { type: 'transport', slug: 'yandex_go' },     // 35
  { type: 'chance' },                           // 36
  { type: 'property', slug: 'apple' },          // 37
  { type: 'tax',      amount: 100, name: 'Роскошный налог' }, // 38
  { type: 'property', slug: 'tesla' },          // 39
];

const JAIL_INDEX = 10;
const GO_TO_JAIL_INDEX = 30;
const GO_SALARY = 200;
const STARTING_MONEY = 1500;

// Chance ("Шанс") cards. Effects:
//   pay-bank N      — player pays N to bank
//   collect-bank N  — player collects N from bank
//   move-to-index I — advance to board index I, passing GO if needed
//   move-by N       — move forward N (negative = back, no GO bonus)
//   go-to-jail      — straight to jail
//   pay-each N      — pay each other non-bankrupt player N
//   collect-each N  — collect N from each other non-bankrupt player
const chanceCards = [
  { id: 'ch-1',  text: 'Двигайтесь к Старту. Получите ₽200',                effect: { type: 'move-to-index', target: 0 } },
  { id: 'ch-2',  text: 'Идите в тюрьму. Налоговая нагрянула',                effect: { type: 'go-to-jail' } },
  { id: 'ch-3',  text: 'Налоговая проверка. Заплатите ₽150',                 effect: { type: 'pay-bank', amount: 150 } },
  { id: 'ch-4',  text: 'Бонус от инвестора. Получите ₽200',                  effect: { type: 'collect-bank', amount: 200 } },
  { id: 'ch-5',  text: 'Возврат на 3 клетки',                                effect: { type: 'move-by', steps: -3 } },
  { id: 'ch-6',  text: 'Дивиденды. Каждый игрок платит вам ₽50',             effect: { type: 'collect-each', amount: 50 } },
  { id: 'ch-7',  text: 'Штраф за переработку. Заплатите каждому игроку ₽25', effect: { type: 'pay-each', amount: 25 } },
  { id: 'ch-8',  text: 'Премия за стартап. Получите ₽150',                   effect: { type: 'collect-bank', amount: 150 } },
  { id: 'ch-9',  text: 'Расходы на офис. Заплатите ₽100',                    effect: { type: 'pay-bank', amount: 100 } },
  { id: 'ch-10', text: 'Двигайтесь на 5 клеток вперёд',                      effect: { type: 'move-by', steps: 5 } },
  { id: 'ch-11', text: 'Корпоративный спор. Заплатите ₽50',                  effect: { type: 'pay-bank', amount: 50 } },
  { id: 'ch-12', text: 'IPO успешно. Получите ₽300',                         effect: { type: 'collect-bank', amount: 300 } },
];

// Community Chest ("Казна") cards.
const chestCards = [
  { id: 'cs-1',  text: 'Возврат налогов. Получите ₽200',           effect: { type: 'collect-bank', amount: 200 } },
  { id: 'cs-2',  text: 'Дивиденды от акций. Получите ₽50',         effect: { type: 'collect-bank', amount: 50 } },
  { id: 'cs-3',  text: 'Совет директоров. Пройдите на «Старт»',    effect: { type: 'move-to-index', target: 0 } },
  { id: 'cs-4',  text: 'Аудит. Заплатите ₽50',                     effect: { type: 'pay-bank', amount: 50 } },
  { id: 'cs-5',  text: 'Корпоративный штраф. Заплатите ₽100',      effect: { type: 'pay-bank', amount: 100 } },
  { id: 'cs-6',  text: 'День рождения. Каждый игрок платит вам ₽10', effect: { type: 'collect-each', amount: 10 } },
  { id: 'cs-7',  text: 'Ошибка банка в вашу пользу. Получите ₽100', effect: { type: 'collect-bank', amount: 100 } },
  { id: 'cs-8',  text: 'Юридический сбор. Заплатите ₽50',           effect: { type: 'pay-bank', amount: 50 } },
  { id: 'cs-9',  text: 'Ежегодная премия. Получите ₽25',           effect: { type: 'collect-bank', amount: 25 } },
  { id: 'cs-10', text: 'Аренда офиса. Заплатите ₽75',               effect: { type: 'pay-bank', amount: 75 } },
  { id: 'cs-11', text: 'Возврат страховки. Получите ₽100',          effect: { type: 'collect-bank', amount: 100 } },
  { id: 'cs-12', text: 'Корпоративные взносы. Заплатите ₽50',       effect: { type: 'pay-bank', amount: 50 } },
];

module.exports = {
  groups, properties, transport, utilities,
  board, TRANSPORT_RENT,
  chanceCards, chestCards,
  JAIL_INDEX, GO_TO_JAIL_INDEX, GO_SALARY, STARTING_MONEY,
};
