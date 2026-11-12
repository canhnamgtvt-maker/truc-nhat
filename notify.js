const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'data.json');
let data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const rawToken = (process.env.ZALO_BOT_TOKEN || '').trim();
const BOT_TOKEN = rawToken.startsWith('bot') ? rawToken.slice(3) : rawToken;
const GH_TOKEN = (process.env.GH_TOKEN || '').trim();
const GITHUB_REPO = (process.env.GITHUB_REPO || 'canhnamgtvt-maker/truc-nhat').trim();

const ACTION_MODE = (process.env.ACTION_MODE || 'normal').trim();
const BUSY_PERSON = (process.env.BUSY_PERSON || '').trim();
const REPLACEMENT_PERSON = (process.env.REPLACEMENT_PERSON || '').trim();

let CHAT_ID = (process.env.ZALO_CHAT_ID || data.chatId || '').trim();

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

function getDayNameVN(dayIndex) {
  return ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'][dayIndex];
}

// Mã hóa khóa kết nối an toàn để lưu vào data.json cho Web App sử dụng
function encodeSecret(str) {
  if (!str) return '';
  const shifted = str.split('').reverse().map(c => String.fromCharCode(c.charCodeAt(0) + 2)).join('');
  return Buffer.from(shifted, 'utf8').toString('base64');
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
    if (json && json.ok && json.result) {
      const items = Array.isArray(json.result) ? json.result : [json.result];
      for (let k = items.length - 1; k >= 0; k--) {
        const chat = items[k]?.message?.chat;
        if (chat && chat.id) return String(chat.id);
      }
    }
  } catch (err) {
    console.error("Lỗi khi dò Chat ID:", err);
  }
  return '';
}

async function run() {
  if (!BOT_TOKEN) {
    console.error("❌ LỖI: Chưa có ZALO_BOT_TOKEN trong mục Secrets!");
    return;
  }

  if (!CHAT_ID) {
    CHAT_ID = await autoFetchChatId();
    if (CHAT_ID) {
      data.chatId = CHAT_ID;
    } else {
      console.error("⚠️ Chưa lấy được Chat ID.");
      return;
    }
  }

  const today = getVNDate();
  const dayOfWeek = today.getDay();
  const todayStr = formatDateVN(today);
  const total = data.members.length;

  let message = '';

  // TRƯỜNG HỢP 1: CÓ NGƯỜI BẤM ĐỔI CA TRỰC TIẾP TRÊN WEB APP
  if (ACTION_MODE === 'swap' && BUSY_PERSON && REPLACEMENT_PERSON) {
    const currentIdx = data.currentIndex % total;

    // Sắp xếp lại danh sách: Đưa người trực thay lên hôm nay, đẩy người bận xuống ngày kế tiếp để trực bù
    let queue = [];
    for (let i = 0; i < total; i++) {
      queue.push(data.members[(currentIdx + i) % total]);
    }

    const repPos = queue.indexOf(REPLACEMENT_PERSON);
    if (repPos > 0) {
      queue.splice(repPos, 1);
      queue.unshift(REPLACEMENT_PERSON);
      for (let i = 0; i < total; i++) {
        data.members[(currentIdx + i) % total] = queue[i];
      }
    }

    data.swappedInfo = {
      dateStr: todayStr,
      busyPerson: BUSY_PERSON,
      replacementPerson: REPLACEMENT_PERSON
    };

    const nextPerson = data.members[(currentIdx + 1) % total];

    message = `🔄 [THÔNG BÁO ĐỔI NGƯỜI TRỰC THAY - ${data.roomName.toUpperCase()}]\n`
            + `📅 Ngày: ${getDayNameVN(dayOfWeek)}, ${todayStr}\n`
            + `----------------------------------\n`
            + `ℹ️ Đ/c ${BUSY_PERSON} báo bận trên hệ thống.\n`
            + `👤 Cán bộ trực thay hôm nay: Đ/c ${REPLACEMENT_PERSON}\n`
            + `📋 Nội dung công việc:\n`;

    data.tasks.forEach((task, i) => {
      message += `   ${i + 1}. ${task}\n`;
    });

    message += `----------------------------------\n`
             + `⏭️ Trực bù vào ngày làm việc kế tiếp: Đ/c ${nextPerson}\n`
             + `🌐 Xem bảng lịch cập nhật: ${data.webAppUrl}`;

  } else {
    // TRƯỜNG HỢP 2: CHẠY TỰ ĐỘNG MỖI SÁNG
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      console.log(`Hôm nay là cuối tuần (${todayStr}), nghỉ trực.`);
      return;
    }
    if (data.holidays && data.holidays.includes(todayStr)) {
      console.log(`Hôm nay là ngày lễ (${todayStr}), bảo lưu lượt trực.`);
      return;
    }

    // Nếu sang ngày làm việc mới thì nhảy sang người tiếp theo
    if (data.lastRunDate && data.lastRunDate !== todayStr) {
      data.currentIndex = (data.currentIndex + 1) % total;
      data.swappedInfo = null;
    }

    const currentIdx = data.currentIndex % total;
    const nextIdx = (currentIdx + 1) % total;
    const todayPerson = data.members[currentIdx];
    const nextPerson = data.members[nextIdx];

    message = `🔔 [THÔNG BÁO TRỰC NHẬT - ${data.roomName.toUpperCase()}]\n`
            + `📅 Ngày: ${getDayNameVN(dayOfWeek)}, ${todayStr}\n`
            + `----------------------------------\n`
            + `👤 Cán bộ trực hôm nay: Đ/c ${todayPerson}\n`
            + `📋 Nội dung công việc:\n`;

    data.tasks.forEach((task, i) => {
      message += `   ${i + 1}. ${task}\n`;
    });

    message += `----------------------------------\n`
             + `⏭️ Dự kiến ngày làm việc kế tiếp: Đ/c ${nextPerson}\n`
             + `🔄 Nếu bận, bấm vào đây để chọn người trực thay:\n${data.webAppUrl}`;
  }

  // Gửi tin nhắn vào Nhóm Zalo
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
    console.log("Kết quả gửi Zalo:", await res.text());
  } catch (err) {
    console.error("Lỗi gửi Zalo:", err);
  }

  // Lưu thông tin kết nối vào data.json để Web App điều khiển được Bot
  data.chatId = CHAT_ID;
  data.repo = GITHUB_REPO;
  if (GH_TOKEN) {
    data.ghKey = encodeSecret(GH_TOKEN);
  }
  data.lastRunDate = todayStr;
  data.updatedAt = Date.now();

  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
  console.log("✅ Đã lưu data.json thành công!");
}

run();
