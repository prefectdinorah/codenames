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
  { type: 'parking' },                          // 20
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

module.exports = {
  groups, properties, transport, utilities,
  board, TRANSPORT_RENT,
  JAIL_INDEX, GO_TO_JAIL_INDEX, GO_SALARY, STARTING_MONEY,
};
