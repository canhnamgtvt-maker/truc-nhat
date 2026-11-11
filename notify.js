const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'data.json');
let data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const rawToken = (process.env.ZALO_BOT_TOKEN || '').trim();
const BOT_TOKEN = rawToken.startsWith('bot') ? rawToken.slice(3) : rawToken;
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

// Tự động lấy Chat ID từ Zalo Bot nếu lần đầu chưa có
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
      const item = Array.isArray(json.result) ? json.result[json.result.length - 1] : json.result;
      const foundId = item?.message?.chat?.id;
      if (foundId) return String(foundId);
    }
  } catch (err) {
    console.error("Lỗi khi dò Chat ID:", err);
  }
  return '';
}

// Đồng bộ dữ liệu đổi ca từ Web App về GitHub
async function syncWithCloud(todayStr) {
  if (data.syncUrl) {
    try {
      const res = await fetch(data.syncUrl);
      if (res.ok) {
        const cloudData = await res.json();
        if (cloudData && cloudData.updatedAt && (!data.updatedAt || cloudData.updatedAt > data.updatedAt)) {
          data.members = cloudData.members || data.members;
          data.currentIndex = typeof cloudData.currentIndex === 'number' ? cloudData.currentIndex : data.currentIndex;
          data.lastRunDate = cloudData.lastRunDate || data.lastRunDate;
          data.swappedInfo = cloudData.swappedInfo || null;
          data.updatedAt = cloudData.updatedAt;
          console.log("✅ Đã đồng bộ lịch đổi ca mới nhất từ Web App!");
        }
      }
    } catch (e) {
      console.log("Bỏ qua bước đọc đám mây:", e.message);
    }
  } else {
    // Tự động tạo kho lưu trữ đám mây miễn phí lần đầu để Web App ghi nhận đổi ca
    try {
      const res = await fetch('https://jsonblob.com/api/jsonBlob', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          members: data.members,
          currentIndex: data.currentIndex,
          lastRunDate: data.lastRunDate,
          updatedAt: Date.now()
        })
      });
      const loc = res.headers.get('location') || res.headers.get('Location');
      if (loc) {
        data.syncUrl = loc.startsWith('http') ? loc.replace('http:', 'https:') : `https://jsonblob.com${loc}`;
        console.log("✅ Đã khởi tạo kênh đồng bộ hai chiều cho Web App:", data.syncUrl);
      }
    } catch (e) {
      console.log("Không tạo được syncUrl:", e.message);
    }
  }
}

async function updateCloud() {
  if (!data.syncUrl) return;
  try {
    await fetch(data.syncUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        members: data.members,
        currentIndex: data.currentIndex,
        lastRunDate: data.lastRunDate,
        swappedInfo: data.swappedInfo || null,
        updatedAt: data.updatedAt
      })
    });
  } catch (e) {}
}

async function run() {
  if (!BOT_TOKEN) {
    console.error("❌ LỖI: Chưa tìm thấy ZALO_BOT_TOKEN trong mục Settings -> Secrets -> Actions!");
    return;
  }

  if (!CHAT_ID) {
    CHAT_ID = await autoFetchChatId();
    if (CHAT_ID) {
      data.chatId = CHAT_ID;
      console.log("✅ Đã tự động bắt được Chat ID:", CHAT_ID);
    } else {
      console.error("⚠️ Chưa lấy được Chat ID. Hãy mở Zalo nhắn chữ 'alo' cho con Bot rồi bấm Run workflow lại!");
      return;
    }
  }

  const today = getVNDate();
  const dayOfWeek = today.getDay();
  const todayStr = formatDateVN(today);

  // Đồng bộ xem trên Web App có ai bấm đổi ca không
  await syncWithCloud(todayStr);

  // Kiểm tra Thứ Bảy (6) và Chủ Nhật (0)
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    console.log(`Hôm nay là cuối tuần (${todayStr}), nghỉ trực.`);
    return;
  }

  // Kiểm tra ngày lễ
  if (data.holidays && data.holidays.includes(todayStr)) {
    console.log(`Hôm nay là ngày nghỉ lễ (${todayStr}), bảo lưu lượt trực.`);
    return;
  }

  const total = data.members.length;

  // Nếu bước sang ngày làm việc mới thì mới nhảy sang người kế tiếp
  if (data.lastRunDate && data.lastRunDate !== todayStr) {
    data.currentIndex = (data.currentIndex + 1) % total;
    data.swappedInfo = null; // Xóa trạng thái đổi ca của ngày cũ
  }

  const currentIdx = data.currentIndex % total;
  const nextIdx = (currentIdx + 1) % total;

  const todayPerson = data.members[currentIdx];
  const nextPerson = data.members[nextIdx];

  // Soạn tin nhắn gửi lên Zalo
  let message = `🔔 [THÔNG BÁO TRỰC NHẬT - ${data.roomName.toUpperCase()}]\n`
              + `📅 Ngày: ${getDayNameVN(dayOfWeek)}, ${todayStr}\n`
              + `----------------------------------\n`
              + `👤 Cán bộ trực hôm nay: Đ/c ${todayPerson}\n`
              + `📋 Nội dung công việc:\n`;

  data.tasks.forEach((task, i) => {
    message += `   ${i + 1}. ${task}\n`;
  });

  message += `----------------------------------\n`
           + `⏭️ Dự kiến ngày làm việc kế tiếp: Đ/c ${nextPerson}\n`
           + `🔄 Nếu bận công tác, bấm vào đây để đổi người trực thay:\n${data.webAppUrl}`;

  // Gửi tin nhắn qua Zalo Bot
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
    console.log("Kết quả gửi tin nhắn Zalo:", await res.text());
  } catch (err) {
    console.error("Lỗi khi gửi Zalo:", err);
  }

  // Lưu mã kết nối đã mã hóa vào data.json để Web App có thể tự gọi Bot khi có người bấm đổi ca
  data.chatId = CHAT_ID;
  data.botKey = Buffer.from(BOT_TOKEN).toString('base64');
  data.lastRunDate = todayStr;
  data.updatedAt = Date.now();

  await updateCloud();
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`✅ Đã ghi nhận người trực hôm nay (${todayStr}): ${todayPerson}`);
}

run();
