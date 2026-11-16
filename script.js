"use strict";

// 「巴布 2.0」以本地條件評分推薦食物類型，沒有呼叫線上 AI。
const STORAGE_KEY = "babu-dinner-v2-history";
const HISTORY_LIMIT = 20;
const FIELDS = ["budget", "hunger", "weather", "time"];
const BUDGET_LIMIT = { low: 100, mid: 200, high: Infinity };
const LABELS = {
  budget: { low: "100 元以下", mid: "101～200 元", high: "201 元以上" },
  hunger: { light: "有點餓", normal: "普通", hungry: "超級餓" },
  weather: { hot: "炎熱", rain: "下雨", cold: "偏冷", normal: "一般" },
  time: { dinner: "晚餐", late: "宵夜" }
};

// minPrice 是可找到的「大概起價」，不是即時售價或價格保證。
const FOODS = [
  { id: "rice", name: "便當／飯類", emoji: "🍱", description: "有飯有菜，踏踏實實吃飽飽！", minPrice: 90, times: ["dinner"], weather: ["normal", "rain", "cold"], hunger: ["normal", "hungry"], fill: 3 },
  { id: "soup-noodle", name: "熱呼呼湯麵", emoji: "🍜", description: "一碗下去，整個人暖起來～", minPrice: 75, times: ["dinner", "late"], weather: ["rain", "cold", "normal"], hunger: ["normal", "hungry"], fill: 2 },
  { id: "dry-noodle", name: "香香乾麵", emoji: "🥢", description: "簡單又有味道，吸溜吸溜！", minPrice: 60, times: ["dinner", "late"], weather: ["hot", "normal"], hunger: ["light", "normal"], fill: 2 },
  { id: "hotpot", name: "暖心小火鍋", emoji: "🍲", description: "慢慢煮、慢慢吃，幸福冒泡泡！", minPrice: 150, times: ["dinner"], weather: ["rain", "cold"], hunger: ["hungry", "normal"], fill: 3 },
  { id: "luwei", name: "百搭滷味", emoji: "🍢", description: "想吃什麼自己配，巴布也想加豆干！", minPrice: 70, times: ["dinner", "late"], weather: ["rain", "cold", "normal"], hunger: ["light", "normal", "hungry"], fill: 2 },
  { id: "lightmeal", name: "清爽輕食", emoji: "🥗", description: "吃得清清爽爽，也很有滿足感～", minPrice: 85, times: ["dinner", "late"], weather: ["hot", "normal"], hunger: ["light", "normal"], fill: 1 },
  { id: "congee", name: "暖胃粥品", emoji: "🥣", description: "軟綿綿的粥，讓晚餐溫柔一點。", minPrice: 65, times: ["dinner", "late"], weather: ["rain", "cold"], hunger: ["light", "normal"], fill: 1 },
  { id: "snack", name: "宵夜小吃", emoji: "🍡", description: "嘴饞的時候，來點小確幸！", minPrice: 50, times: ["late"], weather: ["normal", "hot"], hunger: ["light", "normal"], fill: 1 },
  { id: "curry", name: "濃郁咖哩飯", emoji: "🍛", description: "香香的咖哩醬配飯，一口接一口！", minPrice: 110, times: ["dinner"], weather: ["rain", "cold", "normal"], hunger: ["normal", "hungry"], fill: 3 },
  { id: "dumpling", name: "水餃／鍋貼", emoji: "🥟", description: "一顆接一顆，份量自己決定！", minPrice: 70, times: ["dinner", "late"], weather: ["normal", "rain", "hot"], hunger: ["normal", "hungry"], fill: 2 }
];

const form = document.getElementById("dinner-form");
const formMessage = document.getElementById("form-message");
const progressText = document.getElementById("progress-text");
const progressBar = document.getElementById("progress-bar");
const resultPlaceholder = document.getElementById("result-placeholder");
const resultCard = document.getElementById("result-card");
const historyList = document.getElementById("history-list");
const clearHistoryButton = document.getElementById("clear-history");
const historyNote = document.getElementById("history-note");
const againButton = document.getElementById("again-button");

let historyRecords = readHistory();
let lastFoodId = null;
let submittedConditions = null;

function getConditions() {
  const conditions = {};
  for (const field of FIELDS) {
    const checked = form.querySelector(`input[name="${field}"]:checked`);
    if (checked) conditions[field] = checked.value;
  }
  return conditions;
}

function updateProgress() {
  const conditions = getConditions();
  const completed = FIELDS.filter((field) => conditions[field]).length;
  progressText.textContent = `${completed} / 4 已完成`;
  progressBar.style.width = `${completed * 25}%`;
  if (completed === 4) formMessage.textContent = "";
}

function scoreFood(food, conditions) {
  let score = 1;
  if (food.weather.includes(conditions.weather)) score += 4;
  if (food.hunger.includes(conditions.hunger)) score += 3;
  if (conditions.hunger === "hungry") score += food.fill;
  if (conditions.hunger === "light") score += 4 - food.fill;
  if (conditions.time === "late" && food.id === "snack") score += 2;
  if (conditions.weather === "hot" && food.id === "lightmeal") score += 2;
  if (conditions.weather === "cold" && food.id === "hotpot") score += 2;
  return score;
}

function getCandidates(conditions) {
  const budgetCap = BUDGET_LIMIT[conditions.budget];
  let candidates = FOODS.filter((food) => food.minPrice <= budgetCap && food.times.includes(conditions.time));
  // 防禦性備選：如果日後食物資料改動到沒有符合者，依序放寬條件。
  if (!candidates.length) candidates = FOODS.filter((food) => food.minPrice <= budgetCap);
  if (!candidates.length) candidates = [...FOODS];
  return candidates;
}

function pickFood(conditions, previousId) {
  const ranked = getCandidates(conditions)
    .map((food) => ({ food, score: scoreFood(food, conditions) }))
    .sort((a, b) => b.score - a.score);
  const bestScore = ranked[0].score;
  let nearBest = ranked.filter((item) => item.score >= bestScore - 3);
  if (previousId && nearBest.length > 1) {
    nearBest = nearBest.filter((item) => item.food.id !== previousId);
  } else if (previousId && nearBest.length === 1 && ranked.length > 1) {
    // 再推薦時至少提供另一個符合預算／時段的備選，不讓人一直抽到同一種。
    nearBest = ranked.filter((item) => item.food.id !== previousId).slice(0, 3);
  }
  const selected = nearBest[Math.floor(Math.random() * nearBest.length)];
  return selected.food;
}

function buildReason(food, conditions) {
  const weatherWords = {
    hot: food.weather.includes("hot") ? "天氣熱熱的，吃這個比較合現在的心情" : "天氣有點熱，記得搭配喜歡的飲料",
    rain: food.weather.includes("rain") ? "下雨天來一份這個，感覺特別療癒" : "下雨天也要好好吃一餐",
    cold: food.weather.includes("cold") ? "冷冷的時候，這份餐點很有溫暖感" : "天氣偏冷，吃飽就有精神啦",
    normal: "今天的天氣剛剛好，來點喜歡的味道"
  };
  const hungerWords = {
    light: food.fill === 1 ? "肚子只是有點餓，份量剛好可以慢慢享受" : "有點餓的話，可以先選小份量",
    normal: "一般的食量，這個選擇很可以",
    hungry: food.fill >= 2 ? "你都超級餓了，來點有飽足感的吧" : "超級餓的話，記得加點主食才夠吃喔"
  };
  const budgetWords = {
    low: "預算抓在 100 元內，可以找平價的搭配",
    mid: "預算 101～200 元，選擇很有彈性",
    high: "今天預算比較寬裕，可以吃得開心一點"
  };
  const timeWords = conditions.time === "late" ? "宵夜時間" : "晚餐時間";
  return `巴布想說：${timeWords}，${weatherWords[conditions.weather]}！${hungerWords[conditions.hunger]}。${budgetWords[conditions.budget]}。♡`;
}

function showRecommendation(food, conditions) {
  document.getElementById("food-emoji").textContent = food.emoji;
  document.getElementById("food-name").textContent = food.name;
  document.getElementById("food-description").textContent = food.description;
  const reason = buildReason(food, conditions);
  document.getElementById("food-reason").textContent = reason;
  document.getElementById("result-note").textContent = "價格僅供概略參考，實際請以店家為準。";
  resultPlaceholder.hidden = true;
  resultCard.hidden = false;
  lastFoodId = food.id;
  submittedConditions = { ...conditions };
  const saved = addHistory({ id: food.id, name: food.name, emoji: food.emoji, reason, conditions: { ...conditions }, time: new Date().toISOString() });
  if (!saved) historyNote.textContent = "瀏覽器無法儲存紀錄；目前的紀錄僅在本頁暫存，重新整理後可能消失。";
  renderHistory();
  document.getElementById("result").scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function makeRecommendation(allowRepeat) {
  const conditions = getConditions();
  const missing = FIELDS.filter((field) => !conditions[field]);
  if (missing.length) {
    formMessage.textContent = `還差 ${missing.length} 個選項喔！巴布想先了解你的心情 ♡`;
    const missingField = form.querySelector(`[data-question="${missing[0]}"] input`);
    if (missingField) missingField.focus();
    return;
  }
  formMessage.textContent = "";
  const previousId = allowRepeat ? lastFoodId : null;
  showRecommendation(pickFood(conditions, previousId), conditions);
}

function readHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.name === "string" && typeof item.reason === "string" && item.conditions && typeof item.conditions === "object" && typeof item.time === "string").slice(0, HISTORY_LIMIT);
  } catch (error) {
    console.warn("巴布無法讀取本機推薦紀錄", error);
    return [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(historyRecords));
    return true;
  } catch (error) {
    console.warn("巴布無法寫入本機推薦紀錄", error);
    return false;
  }
}

function addHistory(record) {
  historyRecords.unshift(record);
  historyRecords = historyRecords.slice(0, HISTORY_LIMIT);
  return saveHistory();
}

function makeElement(tagName, className, textValue) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (textValue !== undefined) element.textContent = textValue;
  return element;
}

function renderHistory() {
  historyList.replaceChildren();
  clearHistoryButton.disabled = historyRecords.length === 0;
  if (!historyRecords.length) {
    historyList.append(makeElement("div", "history-empty", "還沒有推薦紀錄，今天來吃點好吃的吧 ♡"));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const record of historyRecords) {
    const item = makeElement("article", "history-item");
    item.append(makeElement("span", "history-icon", record.emoji || "🍽️"));
    const content = makeElement("div", "history-content");
    const top = makeElement("div", "history-top");
    top.append(makeElement("strong", "", record.name));
    const timestamp = new Date(record.time);
    const timeLabel = Number.isNaN(timestamp.getTime()) ? "時間不詳" : timestamp.toLocaleString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
    top.append(makeElement("time", "history-time", timeLabel));
    content.append(top, makeElement("p", "history-reason", record.reason));
    const tags = makeElement("div", "history-tags");
    for (const field of FIELDS) {
      const tag = LABELS[field][record.conditions[field]];
      if (tag) tags.append(makeElement("span", "history-tag", tag));
    }
    content.append(tags);
    item.append(content);
    fragment.append(item);
  }
  historyList.append(fragment);
}

form.addEventListener("change", () => {
  updateProgress();
  // 更新條件後隱藏舊結果，以免讓人誤以為它對應最新的選項。
  if (submittedConditions) {
    const current = getConditions();
    const changed = FIELDS.some((field) => current[field] !== submittedConditions[field]);
    if (changed) {
      resultCard.hidden = true;
      resultPlaceholder.hidden = false;
      lastFoodId = null;
      submittedConditions = null;
    }
  }
});

form.addEventListener("submit", (event) => { event.preventDefault(); makeRecommendation(false); });
againButton.addEventListener("click", () => makeRecommendation(true));
clearHistoryButton.addEventListener("click", () => {
  if (!historyRecords.length) return;
  if (!window.confirm("確定要清除全部推薦紀錄嗎？清除後就不能復原囉！")) return;
  const oldHistory = historyRecords;
  historyRecords = [];
  if (saveHistory()) {
    historyNote.textContent = "紀錄已清除。新推薦會繼續保存在這個瀏覽器。";
    renderHistory();
  } else {
    historyRecords = oldHistory;
    historyNote.textContent = "清除失敗，瀏覽器暫時無法修改儲存資料，請稍後再試。";
    renderHistory();
  }
});

updateProgress();
renderHistory();
