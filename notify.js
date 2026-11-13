const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'data.json');
let data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const rawToken = (process.env.ZALO_BOT_TOKEN || '').trim();
const BOT_TOKEN = rawToken.startsWith('bot') ? rawToken.slice(3) : rawToken;
const GH_TOKEN = (process.env.GH_TOKEN || '').trim();
const GITHUB_REPO = (process.env.GITHUB_REPO || 'canhnamgtvt-maker/truc-nhat').trim();

const SCHEDULE_CRON = (process.env.SCHEDULE_CRON || '').trim();
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

// ================= BỘ TỰ ĐỘNG TÍNH NGÀY LỄ & NGHỈ BÙ VĨNH VIỄN MỌI NĂM =================
const holidayCache = {};

function getLunarInfo(date) {
  try {
    const fmt = new Intl.DateTimeFormat('en-u-ca-chinese', { month: 'numeric', day: 'numeric' });
    const parts = fmt.formatToParts(date);
    const mVal = parts.find(p => p.type === 'month')?.value || '1';
    const dVal = parts.find(p => p.type === 'day')?.value || '1';
    return {
      month: parseInt(mVal, 10),
      isLeap: isNaN(Number(mVal)),
      day: parseInt(dVal, 10)
    };
  } catch (e) {
    return { month: 0, isLeap: false, day: 0 };
  }
}

function getAutoHolidaysForYear(year) {
  if (holidayCache[year]) return holidayCache[year];
  const holidaySet = new Set();

  function addHolidayPeriod(datesArray) {
    let weekendCount = 0;
    datesArray.forEach(d => {
      holidaySet.add(formatDateVN(d));
      const dow = d.getDay();
      if (dow === 0 || dow === 6) weekendCount++;
    });

    if (weekendCount > 0) {
      let cursor = new Date(datesArray[datesArray.length - 1]);
      while (weekendCount > 0) {
        cursor.setDate(cursor.getDate() + 1);
        const dow = cursor.getDay();
        const dStr = formatDateVN(cursor);
        if (dow !== 0 && dow !== 6 && !holidaySet.has(dStr)) {
          holidaySet.add(dStr);
          weekendCount--;
        }
      }
    }
  }

  addHolidayPeriod([new Date(year, 0, 1)]);

  let tetNewYearDate = null;
  let gioToDate = null;
  for (let m = 0; m <= 5; m++) {
    for (let d = 1; d <= 31; d++) {
      const cur = new Date(year, m, d);
      if (cur.getMonth() !== m) continue;
      const lunar = getLunarInfo(cur);
      if (lunar.month === 1 && !lunar.isLeap && lunar.day === 1 && !tetNewYearDate) {
        tetNewYearDate = cur;
      }
      if (lunar.month === 3 && !lunar.isLeap && lunar.day === 10 && !gioToDate) {
        gioToDate = cur;
      }
    }
  }

  if (tetNewYearDate) {
    const tetDays = [];
    for (let offset = -1; offset <= 3; offset++) {
      const td = new Date(tetNewYearDate);
      td.setDate(td.getDate() + offset);
      tetDays.push(td);
    }
    addHolidayPeriod(tetDays);
  }

  if (gioToDate) {
    addHolidayPeriod([gioToDate]);
  }

  addHolidayPeriod([new Date(year, 3, 30), new Date(year, 4, 1)]);

  const qkMain = new Date(year, 8, 2);
  const qkAdj = (qkMain.getDay() === 2) ? new Date(year, 8, 1) : new Date(year, 8, 3);
  const qkPeriod = [qkMain, qkAdj].sort((a, b) => a - b);
  addHolidayPeriod(qkPeriod);

  holidayCache[year] = holidaySet;
  return holidaySet;
}

function isHoliday(dateObj, manualHolidays) {
  const dStr = formatDateVN(dateObj);
  if (Array.isArray(manualHolidays) && manualHolidays.includes(dStr)) return true;
  return getAutoHolidaysForYear(dateObj.getFullYear()).has(dStr);
}
// ======================================================================================

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

async function sendZaloMessage(text) {
  try {
    const sendUrl = `https://bot-api.zapps.me/bot${BOT_TOKEN}/sendMessage`;
    const res = await fetch(sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: text
      })
    });
    console.log("Kết quả gửi Zalo:", await res.text());
  } catch (err) {
    console.error("Lỗi gửi Zalo:", err);
  }
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
  const currentHour = today.getHours();
  const dayOfMonth = today.getDate();
  const monthOfYear = today.getMonth() + 1;
  const dayOfWeek = today.getDay();
  const todayStr = formatDateVN(today);
  const currentMonthKey = `${monthOfYear}/${today.getFullYear()}`;
  const total = data.members.length;

  let isDataChanged = false;

  // Nhận diện khung giờ nhắc Đảng phí (từ 8h30 sáng ngày 05 hàng tháng trở đi)
  const isPartyFeeTime = (SCHEDULE_CRON === '53 1 5 * *') || (SCHEDULE_CRON === '7 2 5 * *') || (dayOfMonth === 5 && currentHour >= 8);

  // =========================================================================
  // LUỒNG 1: NHẮC NỘP ĐẢNG PHÍ (KHOẢNG 09h00 SÁNG NGÀY 05 HÀNG THÁNG)
  // =========================================================================
  if ((ACTION_MODE === 'normal' && isPartyFeeTime && data.lastPartyFeeMonth !== currentMonthKey) || ACTION_MODE === 'test_party_fee') {
    const danhSachCauNhac = [
      "Có lương rồi à, đóng Đảng phí luôn đi!",
      "Nộp Đảng phí đi không quên mất đấy!",
      "Nộp tiền Đảng phí chưa, hoàn thành ngay nhé!",
      "Ting ting! Đầu tháng rủng rỉnh, đóng Đảng phí luôn thôi các đồng chí ơi!",
      "Tranh thủ lúc ví còn dày, hoàn thành ngay Đảng phí tháng này nhé!",
      "Alo alo, đến hẹn lại lên, nộp Đảng phí thôi anh chị em ơi!",
      "Góc nhắc nhẹ: Các đồng chí đã đóng Đảng phí tháng này chưa nhỉ?",
      "Lương đã về bản, mời các đồng chí hoàn thành nghĩa vụ Đảng phí nhé!"
    ];

    const partyFeeMsg = danhSachCauNhac[Math.floor(Math.random() * danhSachCauNhac.length)];
    await sendZaloMessage(partyFeeMsg);
    console.log("✅ Đã gửi tin nhắn nhắc nộp Đảng phí:", partyFeeMsg);

    if (ACTION_MODE === 'normal') {
      data.lastPartyFeeMonth = currentMonthKey;
      isDataChanged = true;
    } else if (ACTION_MODE === 'test_party_fee') {
      return;
    }
  }

  // =========================================================================
  // LUỒNG 2: PHÂN CÔNG TRỰC NHẬT (SÁNG HÀNG NGÀY HOẶC KHI BẤM ĐỔI CA)
  // =========================================================================
  let message = '';

  if (ACTION_MODE === 'swap' && BUSY_PERSON && REPLACEMENT_PERSON) {
    const currentIdx = data.currentIndex % total;

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

    await sendZaloMessage(message);
    isDataChanged = true;

  } else {
    // Chốt khóa: Nếu hôm nay đã gửi thông báo trực nhật rồi thì dừng ngay
    if (ACTION_MODE === 'normal' && data.lastRunDate === todayStr) {
      console.log(`⛔ Hôm nay (${todayStr}) Bot đã gửi thông báo trực nhật lúc sáng rồi. Tự động chặn gửi lặp lại!`);
      if (isDataChanged) {
        data.updatedAt = Date.now();
        fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
      }
      return;
    }

    // Kiểm tra Thứ Bảy, Chủ Nhật hoặc Ngày lễ
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      console.log(`Hôm nay là cuối tuần (${todayStr}), bỏ qua phần trực nhật.`);
      if (isDataChanged) {
        data.updatedAt = Date.now();
        fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
      }
      return;
    }

    if (isHoliday(today, data.holidays)) {
      console.log(`Hôm nay là ngày nghỉ lễ/nghỉ bù (${todayStr}), tự động bảo lưu lượt trực.`);
      if (isDataChanged) {
        data.updatedAt = Date.now();
        fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
      }
      return;
    }

    // Bước sang ngày làm việc mới -> Nhảy sang người kế tiếp
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

    await sendZaloMessage(message);
    data.lastRunDate = todayStr;
    isDataChanged = true;
  }

  if (isDataChanged) {
    data.chatId = CHAT_ID;
    data.repo = GITHUB_REPO;
    if (GH_TOKEN) {
      data.ghKey = encodeSecret(GH_TOKEN);
    }
    data.updatedAt = Date.now();

    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
    console.log("✅ Đã lưu trạng thái vào data.json thành công!");
  }
}

run();
