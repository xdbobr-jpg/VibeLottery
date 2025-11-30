const TelegramBot = require('node-telegram-bot-api');
const Database = require('better-sqlite3');

// Замените на ваш токен от @BotFather
const TOKEN = process.env.BOT_TOKEN || '8565441437:AAEqlygphvBkayocRg7A8n4Wzf30yIPtngI';

const bot = new TelegramBot(TOKEN, { polling: true });
const db = new Database('casino.db');

// Инициализация базы данных
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        balance INTEGER DEFAULT 50000,
        reset_count INTEGER DEFAULT 0,
        last_bonus INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
`);

// Константы
const INITIAL_BALANCE = 50000;
const RESET_BALANCES = [50000, 40000, 30000, 20000, 10000];
const MIN_TRANSFER = 50000;
const BONUS_INTERVAL = 3600000; // 1 час в миллисекундах
const BONUS_AMOUNT = 1000;

// Рулетка: числа и цвета
const ROULETTE_NUMBERS = [];
for (let i = 0; i <= 36; i++) {
    let color;
    if (i === 0) {
        color = 'green';
    } else if ([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(i)) {
        color = 'red';
    } else {
        color = 'black';
    }
    ROULETTE_NUMBERS.push({ number: i, color });
}

// Функции работы с БД
function getUser(userId) {
    return db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
}

function createUser(userId, username, firstName) {
    db.prepare(`
        INSERT OR IGNORE INTO users (user_id, username, first_name, balance, reset_count, last_bonus)
        VALUES (?, ?, ?, ?, 0, ?)
    `).run(userId, username, firstName, INITIAL_BALANCE, Date.now());
    return getUser(userId);
}

function updateBalance(userId, amount) {
    db.prepare('UPDATE users SET balance = balance + ? WHERE user_id = ?').run(amount, userId);
}

function setBalance(userId, balance) {
    db.prepare('UPDATE users SET balance = ? WHERE user_id = ?').run(balance, userId);
}

function incrementResetCount(userId) {
    db.prepare('UPDATE users SET reset_count = reset_count + 1 WHERE user_id = ?').run(userId);
}

function updateLastBonus(userId) {
    db.prepare('UPDATE users SET last_bonus = ? WHERE user_id = ?').run(Date.now(), userId);
}

function getTopPlayers(limit = 10) {
    return db.prepare('SELECT * FROM users ORDER BY balance DESC LIMIT ?').all(limit);
}

// Форматирование чисел
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// Главное меню
function getMainKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🎰 Рулетка', callback_data: 'roulette' },
                    { text: '🎫 Лотерея', callback_data: 'lottery' }
                ],
                [
                    { text: '💰 Баланс', callback_data: 'balance' },
                    { text: '🏆 Топ игроков', callback_data: 'top' }
                ],
                [
                    { text: '🎁 Бонус', callback_data: 'bonus' },
                    { text: '🔄 Заново', callback_data: 'reset' }
                ]
            ]
        }
    };
}

// Команда /start
bot.onText(/\/start/, (msg) => {
    const userId = msg.from.id;
    const username = msg.from.username || '';
    const firstName = msg.from.first_name || 'Игрок';
    
    let user = getUser(userId);
    if (!user) {
        user = createUser(userId, username, firstName);
    }
    
    bot.sendMessage(msg.chat.id, 
        `🎰 *Добро пожаловать в Казино!*\n\n` +
        `Привет, ${firstName}!\n` +
        `💎 Ваш баланс: *${formatNumber(user.balance)}* монет\n\n` +
        `Выберите игру:`,
        { parse_mode: 'Markdown', ...getMainKeyboard() }
    );
});

// Команда /pay
bot.onText(/\/pay(?:\s+(\d+)\s+(\d+))?/, (msg, match) => {
    const userId = msg.from.id;
    const user = getUser(userId);
    
    if (!user) {
        bot.sendMessage(msg.chat.id, '❌ Сначала начните игру командой /start');
        return;
    }
    
    if (!match[1] || !match[2]) {
        bot.sendMessage(msg.chat.id, 
            `💸 *Перевод монет*\n\n` +
            `Использование: /pay [ID получателя] [сумма]\n` +
            `Минимальная сумма: ${formatNumber(MIN_TRANSFER)} монет\n\n` +
            `Пример: \`/pay 123456789 50000\``,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    const targetId = parseInt(match[1]);
    const amount = parseInt(match[2]);
    
    if (amount < MIN_TRANSFER) {
        bot.sendMessage(msg.chat.id, 
            `❌ Минимальная сумма перевода: ${formatNumber(MIN_TRANSFER)} монет`
        );
        return;
    }
    
    if (user.balance < amount) {
        bot.sendMessage(msg.chat.id, 
            `❌ Недостаточно монет!\n` +
            `💎 Ваш баланс: ${formatNumber(user.balance)} монет`
        );
        return;
    }
    
    const targetUser = getUser(targetId);
    if (!targetUser) {
        bot.sendMessage(msg.chat.id, '❌ Пользователь не найден');
        return;
    }
    
    if (targetId === userId) {
        bot.sendMessage(msg.chat.id, '❌ Нельзя переводить монеты самому себе');
        return;
    }
    
    updateBalance(userId, -amount);
    updateBalance(targetId, amount);
    
    bot.sendMessage(msg.chat.id, 
        `✅ *Перевод выполнен!*\n\n` +
        `💸 Отправлено: ${formatNumber(amount)} монет\n` +
        `👤 Получатель: ${targetUser.first_name}\n` +
        `💎 Ваш баланс: ${formatNumber(user.balance - amount)} монет`,
        { parse_mode: 'Markdown' }
    );
    
    bot.sendMessage(targetId, 
        `🎁 *Вам перевели монеты!*\n\n` +
        `💰 Получено: ${formatNumber(amount)} монет\n` +
        `👤 От: ${user.first_name}\n` +
        `💎 Ваш баланс: ${formatNumber(targetUser.balance + amount)} монет`,
        { parse_mode: 'Markdown' }
    ).catch(() => {});
});

// Команда /top
bot.onText(/\/top/, (msg) => {
    showTop(msg.chat.id);
});

// Команда /balance
bot.onText(/\/balance/, (msg) => {
    const user = getUser(msg.from.id);
    if (!user) {
        bot.sendMessage(msg.chat.id, '❌ Сначала начните игру командой /start');
        return;
    }
    bot.sendMessage(msg.chat.id, 
        `💎 *Ваш баланс*\n\n` +
        `${formatNumber(user.balance)} монет`,
        { parse_mode: 'Markdown', ...getMainKeyboard() }
    );
});

// Показать топ игроков
function showTop(chatId) {
    const topPlayers = getTopPlayers(10);
    
    let message = '🏆 *Топ 10 игроков*\n\n';
    
    const medals = ['🥇', '🥈', '🥉'];
    
    topPlayers.forEach((player, index) => {
        const medal = medals[index] || `${index + 1}.`;
        message += `${medal} ${player.first_name}: ${formatNumber(player.balance)} монет\n`;
    });
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
}

// Состояния пользователей для игр
const userStates = {};

// Обработка callback кнопок
bot.on('callback_query', async (query) => {
    const userId = query.from.id;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    
    let user = getUser(userId);
    if (!user) {
        user = createUser(userId, query.from.username, query.from.first_name);
    }
    
    // Рулетка
    if (data === 'roulette') {
        userStates[userId] = { game: 'roulette', step: 'bet' };
        bot.editMessageText(
            `🎰 *Рулетка*\n\n` +
            `💎 Ваш баланс: ${formatNumber(user.balance)} монет\n\n` +
            `Введите сумму ставки:`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '100', callback_data: 'bet_100' },
                            { text: '500', callback_data: 'bet_500' },
                            { text: '1000', callback_data: 'bet_1000' }
                        ],
                        [
                            { text: '5000', callback_data: 'bet_5000' },
                            { text: '10000', callback_data: 'bet_10000' },
                            { text: 'Всё', callback_data: 'bet_all' }
                        ],
                        [{ text: '◀️ Назад', callback_data: 'menu' }]
                    ]
                }
            }
        );
    }
    
    // Выбор ставки
    else if (data.startsWith('bet_')) {
        const betAmount = data === 'bet_all' ? user.balance : parseInt(data.split('_')[1]);
        
        if (betAmount > user.balance) {
            bot.answerCallbackQuery(query.id, { text: '❌ Недостаточно монет!', show_alert: true });
            return;
        }
        
        if (betAmount <= 0) {
            bot.answerCallbackQuery(query.id, { text: '❌ Ставка должна быть больше 0!', show_alert: true });
            return;
        }
        
        userStates[userId] = { game: 'roulette', step: 'color', bet: betAmount };
        
        bot.editMessageText(
            `🎰 *Рулетка*\n\n` +
            `💎 Ваш баланс: ${formatNumber(user.balance)} монет\n` +
            `📊 Ставка: ${formatNumber(betAmount)} монет\n\n` +
            `Выберите цвет:\n` +
            `🔴 Красный - x2\n` +
            `⚫ Чёрный - x2\n` +
            `🟢 Зелёный - x14`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🔴 Красный', callback_data: 'color_red' },
                            { text: '⚫ Чёрный', callback_data: 'color_black' }
                        ],
                        [{ text: '🟢 Зелёный', callback_data: 'color_green' }],
                        [{ text: '◀️ Назад', callback_data: 'roulette' }]
                    ]
                }
            }
        );
    }
    
    // Выбор цвета и игра
    else if (data.startsWith('color_')) {
        const state = userStates[userId];
        if (!state || state.game !== 'roulette' || !state.bet) {
            bot.answerCallbackQuery(query.id, { text: '❌ Начните игру заново', show_alert: true });
            return;
        }
        
        const chosenColor = data.split('_')[1];
        const bet = state.bet;
        
        // Проверяем баланс ещё раз
        user = getUser(userId);
        if (bet > user.balance) {
            bot.answerCallbackQuery(query.id, { text: '❌ Недостаточно монет!', show_alert: true });
            return;
        }
        
        // Крутим рулетку
        const result = ROULETTE_NUMBERS[Math.floor(Math.random() * ROULETTE_NUMBERS.length)];
        const colorEmoji = { red: '🔴', black: '⚫', green: '🟢' };
        const colorName = { red: 'красный', black: 'чёрный', green: 'зелёный' };
        
        let winAmount = 0;
        let message = '';
        
        if (result.color === chosenColor) {
            // Выигрыш
            const multiplier = chosenColor === 'green' ? 14 : 2;
            winAmount = bet * multiplier;
            updateBalance(userId, winAmount - bet);
            
            message = `🎉 *Поздравляем! Вы выиграли!*\n\n` +
                `💰 Выигрыш: ${formatNumber(winAmount)} монет\n` +
                `📊 Ставка: ${formatNumber(bet)} монет\n` +
                `💎 Новый баланс: ${formatNumber(user.balance + winAmount - bet)} монет\n\n` +
                `Выпало: ${result.number} (${colorName[result.color]}) ${colorEmoji[result.color]}`;
        } else {
            // Проигрыш
            updateBalance(userId, -bet);
            
            message = `😞 *Вы проиграли*\n\n` +
                `📊 Потеряно: ${formatNumber(bet)} монет\n` +
                `💎 Ваш баланс: ${formatNumber(user.balance - bet)} монет\n\n` +
                `Выпало: ${result.number} (${colorName[result.color]}) ${colorEmoji[result.color]}`;
        }
        
        delete userStates[userId];
        
        bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎰 Играть ещё', callback_data: 'roulette' }],
                    [{ text: '◀️ Меню', callback_data: 'menu' }]
                ]
            }
        });
    }
    
    // Лотерея
    else if (data === 'lottery') {
        bot.editMessageText(
            `🎫 *Лотерея*\n\n` +
            `💎 Ваш баланс: ${formatNumber(user.balance)} монет\n\n` +
            `Выберите билет:\n\n` +
            `🎟 *Обычный билет* - 10 000 монет\n` +
            `   Приз: 500 000 монет\n\n` +
            `🎟 *Золотой билет* - 50 000 монет\n` +
            `   Приз: 5 000 000 монет\n\n` +
            `📋 Правила:\n` +
            `• Выбираете 5 чисел от 1 до 100\n` +
            `• 1 совпадение = 5% приза\n` +
            `• 2 совпадения = 20% приза\n` +
            `• 3 совпадения = 50% приза\n` +
            `• 4 совпадения = 70% приза\n` +
            `• 5 совпадений = 100% приза`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🎟 Обычный (10 000)', callback_data: 'lottery_10000' }],
                        [{ text: '🎟 Золотой (50 000)', callback_data: 'lottery_50000' }],
                        [{ text: '◀️ Назад', callback_data: 'menu' }]
                    ]
                }
            }
        );
    }
    
    // Покупка лотерейного билета
    else if (data.startsWith('lottery_')) {
        const ticketPrice = parseInt(data.split('_')[1]);
        const prize = ticketPrice === 10000 ? 500000 : 5000000;
        
        user = getUser(userId);
        if (user.balance < ticketPrice) {
            bot.answerCallbackQuery(query.id, { text: '❌ Недостаточно монет!', show_alert: true });
            return;
        }
        
        userStates[userId] = { 
            game: 'lottery', 
            price: ticketPrice, 
            prize: prize,
            numbers: [] 
        };
        
        showLotteryNumberSelection(chatId, messageId, userId);
    }
    
    // Выбор числа в лотерее
    else if (data.startsWith('lnum_')) {
        const state = userStates[userId];
        if (!state || state.game !== 'lottery') {
            bot.answerCallbackQuery(query.id, { text: '❌ Начните игру заново', show_alert: true });
            return;
        }
        
        const num = parseInt(data.split('_')[1]);
        
        if (state.numbers.includes(num)) {
            state.numbers = state.numbers.filter(n => n !== num);
        } else if (state.numbers.length < 5) {
            state.numbers.push(num);
        } else {
            bot.answerCallbackQuery(query.id, { text: '❌ Уже выбрано 5 чисел!', show_alert: true });
            return;
        }
        
        showLotteryNumberSelection(chatId, messageId, userId);
    }
    
    // Подтверждение лотереи
    else if (data === 'lottery_confirm') {
        const state = userStates[userId];
        if (!state || state.game !== 'lottery' || state.numbers.length !== 5) {
            bot.answerCallbackQuery(query.id, { text: '❌ Выберите 5 чисел!', show_alert: true });
            return;
        }
        
        user = getUser(userId);
        if (user.balance < state.price) {
            bot.answerCallbackQuery(query.id, { text: '❌ Недостаточно монет!', show_alert: true });
            return;
        }
        
        // Списываем стоимость билета
        updateBalance(userId, -state.price);
        
        // Генерируем выигрышные числа
        const winningNumbers = [];
        while (winningNumbers.length < 5) {
            const num = Math.floor(Math.random() * 100) + 1;
            if (!winningNumbers.includes(num)) {
                winningNumbers.push(num);
            }
        }
        
        // Считаем совпадения
        const matches = state.numbers.filter(n => winningNumbers.includes(n));
        const matchCount = matches.length;
        
        // Рассчитываем выигрыш
        const percentages = { 0: 0, 1: 5, 2: 20, 3: 50, 4: 70, 5: 100 };
        const winPercent = percentages[matchCount];
        const winAmount = Math.floor(state.prize * winPercent / 100);
        
        if (winAmount > 0) {
            updateBalance(userId, winAmount);
        }
        
        // Форматируем числа с эмодзи
        const numToEmoji = (n) => {
            const digits = n.toString().split('');
            const emojis = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
            return digits.map(d => emojis[parseInt(d)]).join('');
        };
        
        const winningStr = winningNumbers.map(numToEmoji).join(', ');
        const matchesStr = matches.length > 0 ? matches.map(numToEmoji).join(', ') : 'Нет совпадений';
        const yourNumbers = state.numbers.map(numToEmoji).join(', ');
        
        user = getUser(userId);
        
        let message = `🎫 *Итоги лотереи* 🎫\n\n` +
            `🎯 Ваши числа: ${yourNumbers}\n` +
            `🎲 Выпало: ${winningStr}\n` +
            `✨ Совпало: ${matchesStr}\n\n` +
            `🏆 Приз: ${formatNumber(state.prize)} монет\n`;
        
        if (winAmount > 0) {
            message += `💰 Ваш выигрыш: ${formatNumber(winAmount)} монет!\n`;
        } else {
            message += `😞 К сожалению, вы не выиграли\n`;
        }
        
        message += `💎 Баланс: ${formatNumber(user.balance)} монет`;
        
        delete userStates[userId];
        
        bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎫 Играть ещё', callback_data: 'lottery' }],
                    [{ text: '◀️ Меню', callback_data: 'menu' }]
                ]
            }
        });
    }
    
    // Баланс
    else if (data === 'balance') {
        user = getUser(userId);
        bot.editMessageText(
            `💎 *Ваш баланс*\n\n` +
            `${formatNumber(user.balance)} монет\n\n` +
            `👤 ID: \`${userId}\`\n` +
            `(Друзья могут отправить вам монеты по этому ID)`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                ...getMainKeyboard()
            }
        );
    }
    
    // Топ
    else if (data === 'top') {
        const topPlayers = getTopPlayers(10);
        
        let message = '🏆 *Топ 10 игроков*\n\n';
        
        const medals = ['🥇', '🥈', '🥉'];
        
        topPlayers.forEach((player, index) => {
            const medal = medals[index] || `${index + 1}.`;
            const isYou = player.user_id === userId ? ' ← Вы' : '';
            message += `${medal} ${player.first_name}: ${formatNumber(player.balance)} монет${isYou}\n`;
        });
        
        bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            ...getMainKeyboard()
        });
    }
    
    // Бонус
    else if (data === 'bonus') {
        user = getUser(userId);
        const timeSinceBonus = Date.now() - user.last_bonus;
        
        if (timeSinceBonus >= BONUS_INTERVAL) {
            updateBalance(userId, BONUS_AMOUNT);
            updateLastBonus(userId);
            user = getUser(userId);
            
            bot.editMessageText(
                `🎁 *Бонус получен!*\n\n` +
                `💰 +${formatNumber(BONUS_AMOUNT)} монет\n` +
                `💎 Баланс: ${formatNumber(user.balance)} монет\n\n` +
                `Следующий бонус через 1 час`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    ...getMainKeyboard()
                }
            );
        } else {
            const remaining = BONUS_INTERVAL - timeSinceBonus;
            const minutes = Math.ceil(remaining / 60000);
            
            bot.editMessageText(
                `⏰ *Бонус ещё не доступен*\n\n` +
                `Осталось: ${minutes} мин.\n` +
                `💎 Баланс: ${formatNumber(user.balance)} монет`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    ...getMainKeyboard()
                }
            );
        }
    }
    
    // Сброс
    else if (data === 'reset') {
        user = getUser(userId);
        const resetCount = user.reset_count;
        const newBalance = RESET_BALANCES[Math.min(resetCount + 1, RESET_BALANCES.length - 1)];
        
        bot.editMessageText(
            `🔄 *Начать заново?*\n\n` +
            `⚠️ Весь ваш прогресс будет удалён!\n\n` +
            `💎 Текущий баланс: ${formatNumber(user.balance)} монет\n` +
            `🎁 Новый баланс: ${formatNumber(newBalance)} монет\n\n` +
            `Количество сбросов: ${resetCount}`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Да, начать заново', callback_data: 'reset_confirm' }],
                        [{ text: '❌ Отмена', callback_data: 'menu' }]
                    ]
                }
            }
        );
    }
    
    // Подтверждение сброса
    else if (data === 'reset_confirm') {
        user = getUser(userId);
        const resetCount = user.reset_count;
        const newBalance = RESET_BALANCES[Math.min(resetCount + 1, RESET_BALANCES.length - 1)];
        
        setBalance(userId, newBalance);
        incrementResetCount(userId);
        
        bot.editMessageText(
            `🔄 *Прогресс сброшен!*\n\n` +
            `💎 Ваш новый баланс: ${formatNumber(newBalance)} монет\n\n` +
            `Удачи в игре! 🍀`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                ...getMainKeyboard()
            }
        );
    }
    
    // Меню
    else if (data === 'menu') {
        delete userStates[userId];
        user = getUser(userId);
        
        bot.editMessageText(
            `🎰 *Казино*\n\n` +
            `💎 Ваш баланс: ${formatNumber(user.balance)} монет\n\n` +
            `Выберите игру:`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                ...getMainKeyboard()
            }
        );
    }
    
    bot.answerCallbackQuery(query.id);
});

// Функция отображения выбора чисел для лотереи
function showLotteryNumberSelection(chatId, messageId, userId) {
    const state = userStates[userId];
    if (!state) return;
    
    const selectedNumbers = state.numbers;
    
    // Создаём клавиатуру 10x10
    const keyboard = [];
    for (let row = 0; row < 10; row++) {
        const rowButtons = [];
        for (let col = 0; col < 10; col++) {
            const num = row * 10 + col + 1;
            const isSelected = selectedNumbers.includes(num);
            rowButtons.push({
                text: isSelected ? `✅${num}` : `${num}`,
                callback_data: `lnum_${num}`
            });
        }
        keyboard.push(rowButtons);
    }
    
    // Добавляем кнопки управления
    keyboard.push([
        { text: `Выбрано: ${selectedNumbers.length}/5`, callback_data: 'noop' },
        { text: selectedNumbers.length === 5 ? '✅ Играть!' : '❌ Выберите 5', callback_data: selectedNumbers.length === 5 ? 'lottery_confirm' : 'noop' }
    ]);
    keyboard.push([{ text: '◀️ Назад', callback_data: 'lottery' }]);
    
    const ticketType = state.price === 10000 ? 'Обычный' : 'Золотой';
    
    bot.editMessageText(
        `🎫 *Лотерея - ${ticketType} билет*\n\n` +
        `💰 Стоимость: ${formatNumber(state.price)} монет\n` +
        `🏆 Приз: ${formatNumber(state.prize)} монет\n\n` +
        `Выберите 5 чисел от 1 до 100:\n` +
        `Выбрано: ${selectedNumbers.sort((a, b) => a - b).join(', ') || 'ничего'}`,
        {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        }
    );
}

console.log('🎰 Казино бот запущен!');
