const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const rawToken = (process.env.ZALO_BOT_TOKEN || '').trim();
const BOT_TOKEN = rawToken.startsWith('bot') ? rawToken.slice(3) : rawToken;
let CHAT_ID = (process.env.ZALO_CHAT_ID || '').trim();

if (!CHAT_ID && data.chatKey) {
  CHAT_ID = Buffer.from(data.chatKey, 'base64').toString('utf8');
}

function getVNDate() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (3600000 * 7));
}

function formatDateVN(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function parseVNDate(str) {
  const [d, m, y] = str.split('/').map(Number);
  return new Date(y, m - 1, d);
}

function getDayNameVN(dayIndex) {
  return ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'][dayIndex];
}

function isWorkDay(d, holidays) {
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  return !(holidays || []).includes(formatDateVN(d));
}

function diffWorkDays(d1, d2, holidays) {
  let start = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
  let end = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
  let count = 0;
  let cur = new Date(start);
  if (end >= start) {
    while (cur < end) {
      if (isWorkDay(cur, holidays)) count++;
      cur.setDate(cur.getDate() + 1);
    }
  } else {
    while (cur > end) {
      cur.setDate(cur.getDate() - 1);
      if (isWorkDay(cur, holidays)) count--;
    }
  }
  return count;
}

function getBasePersonForDate(targetDate, anchorDateStr, anchorIndex) {
  const total = data.members.length;
  const anchorDate = parseVNDate(anchorDateStr);
  const offset = diffWorkDays(anchorDate, targetDate, data.holidays);
  let idx = (anchorIndex + offset) % total;
  if (idx < 0) idx += total;
  return data.members[idx];
}

async function autoFetchChatId() {
  try {
    const url = `https://bot-api.zapps.me/bot${BOT_TOKEN}/getUpdates`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const json = await res.json();
    console.log("Phản hồi getUpdates:", JSON.stringify(json));
    if (json && json.ok && json.result) {
      const item = Array.isArray(json.result) ? json.result[json.result.length - 1] : json.result;
      const foundId = item?.message?.chat?.id;
      if (foundId) return String(foundId);
    }
  } catch (err) {
    console.error("Lỗi dò Chat ID:", err);
  }
  return '';
}

// Tạo hoặc đọc bộ nhớ đám mây để đồng bộ việc đổi ca từ Web App
async function syncCloudState() {
  let cloudState = {
    anchorDate: data.anchorDate || "12/11/2026",
    anchorIndex: data.anchorIndex || 0,
    swaps: {}
  };

  if (data.syncUrl) {
    try {
      const res = await fetch(data.syncUrl);
      if (res.ok) {
        const remote = await res.json();
        cloudState = { ...cloudState, ...remote };
        return cloudState;
      }
    } catch (e) {
      console.error("Không đọc được syncUrl:", e);
    }
  }

  // Nếu chưa có syncUrl thì tự động khởi tạo 1 kho lưu trữ đám mây miễn phí
  try {
    const res = await fetch('https://jsonblob.com/api/jsonBlob', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(cloudState)
    });
    const loc = res.headers.get('location') || res.headers.get('Location');
    if (loc) {
      data.syncUrl = loc.startsWith('http') ? loc.replace('http:', 'https:') : `https://jsonblob.com${loc}`;
      console.log("✅ Đã tạo kho đồng bộ đám mây:", data.syncUrl);
    }
  } catch (e) {
    console.error("Lỗi tạo kho đồng bộ:", e);
  }
  return cloudState;
}

async function run() {
  if (!BOT_TOKEN) {
    console.error("❌ LỖI: Chưa tìm thấy ZALO_BOT_TOKEN. Hãy kiểm tra mục Secrets trên GitHub!");
    return;
  }

  if (!CHAT_ID) {
    CHAT_ID = await autoFetchChatId();
    if (!CHAT_ID) {
      console.error("⚠️ Chưa lấy được Chat ID. Bạn hãy mở Zalo nhắn chữ 'alo' cho con Bot rồi bấm Run workflow lại ngay!");
      return;
    }
  }

  // Lưu mã kết nối đã mã hóa vào data.json để Web App có thể gọi Bot tự động
  data.botKey = Buffer.from(BOT_TOKEN, 'utf8').toString('base64');
  data.chatKey = Buffer.from(CHAT_ID, 'utf8').toString('base64');

  const cloudState = await syncCloudState();
  data.anchorDate = cloudState.anchorDate;
  data.anchorIndex = cloudState.anchorIndex;

  // Lưu lại data.json
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');

  const today = getVNDate();
  const todayZero = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dayOfWeek = todayZero.getDay();
  const todayStr = formatDateVN(todayZero);

  if (dayOfWeek === 0 || dayOfWeek === 6) {
    console.log(`Hôm nay là cuối tuần (${todayStr}), không gửi thông báo trực.`);
    return;
  }

  if (data.holidays && data.holidays.includes(todayStr)) {
    console.log(`Hôm nay là ngày lễ (${todayStr}), nghỉ trực.`);
    return;
  }

  // Tính người trực hôm nay (có kiểm tra lịch đổi ca / trực bù trên Web App)
  let todayPerson = getBasePersonForDate(todayZero, cloudState.anchorDate, cloudState.anchorIndex);
  let noteText = "";

  const swaps = cloudState.swaps || {};
  if (swaps[todayStr]) {
    todayPerson = swaps[todayStr].replacementPerson;
    noteText = `ℹ️ (Trực thay cho Đ/c ${swaps[todayStr].busyPerson} đi công tác)\n`;
  } else {
    // Kiểm tra xem hôm nay có phải là ngày trực bù của ai không
    for (const [swapDate, info] of Object.entries(swaps)) {
      if (info.makeUpDateStr === todayStr) {
        todayPerson = info.busyPerson;
        noteText = `ℹ️ (Trực bù cho Đ/c ${info.replacementPerson} đã trực thay ngày ${swapDate})\n`;
        break;
      }
    }
  }

  // Tìm người trực ngày làm việc kế tiếp
  let nextDate = new Date(todayZero);
  nextDate.setDate(nextDate.getDate() + 1);
  while (!isWorkDay(nextDate, data.holidays)) {
    nextDate.setDate(nextDate.getDate() + 1);
  }
  const nextDateStr = formatDateVN(nextDate);
  let nextPerson = getBasePersonForDate(nextDate, cloudState.anchorDate, cloudState.anchorIndex);
  if (swaps[nextDateStr]) {
    nextPerson = swaps[nextDateStr].replacementPerson;
  } else {
    for (const [, info] of Object.entries(swaps)) {
      if (info.makeUpDateStr === nextDateStr) {
        nextPerson = info.busyPerson;
        break;
      }
    }
  }

  let message = `🔔 [THÔNG BÁO TRỰC NHẬT - ${data.roomName.toUpperCase()}]\n`
              + `📅 Ngày: ${getDayNameVN(dayOfWeek)}, ${todayStr}\n`
              + `----------------------------------\n`
              + `👤 Cán bộ trực hôm nay: Đ/c ${todayPerson}\n`
              + noteText
              + `📋 Nội dung công việc:\n`;

  data.tasks.forEach((task, i) => {
    message += `   ${i + 1}. ${task}\n`;
  });

  message += `----------------------------------\n`
           + `⏭️ Dự kiến ngày làm việc kế tiếp (${getDayNameVN(nextDate.getDay())}): Đ/c ${nextPerson}\n`
           + `🔄 Nếu bận công tác, bấm vào phần mềm dưới đây để chọn người trực thay:\n`
           + `👉 ${data.webAppUrl}`;

  try {
    const sendUrl = `https://bot-api.zapps.me/bot${BOT_TOKEN}/sendMessage`;
    const res = await fetch(sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message
      })
    });
    console.log("✅ Kết quả gửi Zalo:", await res.text());
  } catch (err) {
    console.error("Lỗi gửi Zalo:", err);
  }
}

run();
