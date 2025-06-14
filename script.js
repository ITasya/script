const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// 🧩 Настройки
const webhook = 'https://trudex.bitrix24.ru/rest/1/8m4dc7w0sw792wd8/';
const sourceStageId = 'UC_UX6XY1';
const targetStageId = 'UC_X03LAW';
const batchSize = 3;
const dailyLimit = 30;
const startHour = 12; // ⏰ С какого часа разрешено начинать запуск

const logFilePath = path.join(__dirname, 'deal-transfer.log');
const counterFilePath = path.join(__dirname, 'daily-counter.json');

// 📄 Запись в лог
function writeLog(message) {
  const timestamp = new Date().toISOString();
  const fullMessage = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(logFilePath, fullMessage, 'utf8');
  console.log(message);
}

// 📦 Сохраняем и загружаем счётчик
function getTodayKey() {
  const now = new Date();
  return now.toISOString().split('T')[0]; // формат YYYY-MM-DD
}

function loadCounter() {
  if (!fs.existsSync(counterFilePath)) return {};
  const raw = fs.readFileSync(counterFilePath, 'utf8');
  return JSON.parse(raw);
}

function saveCounter(counter) {
  fs.writeFileSync(counterFilePath, JSON.stringify(counter, null, 2), 'utf8');
}

// 📤 Обновление стадии сделки
async function updateDealStage(dealId, newStageId) {
  const url = `${webhook}crm.deal.update.json`;
  const params = {
    id: dealId,
    fields: { STAGE_ID: newStageId },
  };

  try {
    const response = await axios.post(url, null, { params });
    if (response.data.result) {
      writeLog(`✅ Сделка ${dealId} перемещена в стадию ${newStageId}`);
    } else {
      writeLog(`❌ Ошибка при обновлении сделки ${dealId}: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    writeLog(`❌ Ошибка запроса сделки ${dealId}: ${error.message}`);
  }
}

// 📥 Получение сделок
async function getDealsFromStage(stageId, limit) {
  const url = `${webhook}crm.deal.list.json`;
  const params = {
    order: { ID: 'ASC' },
    filter: { STAGE_ID: stageId },
    select: ['ID'],
    start: -1,
  };

  try {
    const response = await axios.get(url, { params });
    return response.data.result.slice(0, limit);
  } catch (error) {
    writeLog(`❌ Ошибка получения сделок: ${error.message}`);
    return [];
  }
}

function isTimeAllowed() {
  const now = new Date();
  return now.getHours() >= startHour;
}

async function processDeals() {
  if (!isTimeAllowed()) {
    writeLog(`🕒 Сейчас раньше ${startHour}:00. Ждём начала запуска...`);
    return;
  }

  const counter = loadCounter();
  const todayKey = getTodayKey();

  if (!counter[todayKey]) {
    counter[todayKey] = 0;
    writeLog('🆕 Новый день: счётчик сброшен');
  }

  if (counter[todayKey] >= dailyLimit) {
    writeLog(`📛 Достигнут лимит ${dailyLimit} сделок на сегодня`);
    return;
  }

  const remaining = dailyLimit - counter[todayKey];
  const countToProcess = Math.min(batchSize, remaining);

  const deals = await getDealsFromStage(sourceStageId, countToProcess);
  if (!deals.length) {
    writeLog('ℹ️ Нет сделок для переноса');
    return;
  }

  for (const deal of deals) {
    await updateDealStage(deal.ID, targetStageId);
    counter[todayKey]++;
  }

  saveCounter(counter);
  writeLog(`✅ Перенесено ${deals.length} сделок, всего сегодня: ${counter[todayKey]}`);
}

// ⏱ Запуск каждые 10 минут
cron.schedule('*/10 * * * *', () => {
  writeLog(`⏰ Задача каждые 10 минут`);
  processDeals();
});

// 💡 Для теста — раскомментируйте это:
// processDeals();
