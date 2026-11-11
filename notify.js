const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// Tự động làm sạch mã Token (loại bỏ khoảng trắng thừa nếu có)
const rawToken = (process.env.ZALO_BOT_TOKEN || '').trim();
const BOT_TOKEN = rawToken.startsWith('bot') ? rawToken.slice(3) : rawToken;

// Ưu tiên lấy Chat ID từ GitHub Secrets, nếu không có thì lấy từ file data.json
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

// Hàm tự động lấy Chat ID bằng phương thức POST nếu bạn chưa nhập Chat ID
async function autoFetchChatId() {
  console.log("Đang tự động dò tìm Chat ID từ Zalo Bot (Hãy nhắn 1 tin bất kỳ cho Bot trên Zalo ngay lúc này)...");
  try {
    const url = `https://bot-api.zapps.me/bot${BOT_TOKEN}/getUpdates`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const json = await res.json();
    console.log("Dữ liệu getUpdates trả về:", JSON.stringify(json));

    if (json && json.ok && json.result) {
      // Xử lý cả trường hợp Zalo trả về 1 đối tượng hoặc 1 danh sách
      const item = Array.isArray(json.result) ? json.result[json.result.length - 1] : json.result;
      const foundId = item?.message?.chat?.id;
      if (foundId) {
        console.log("✅ Đã tìm thấy Chat ID tự động:", foundId);
        return String(foundId);
      }
    }
  } catch (err) {
    console.error("Lỗi khi tự động dò Chat ID:", err);
  }
  return '';
}

async function run() {
  if (!BOT_TOKEN) {
    console.error("❌ LỖI: Bạn chưa nhập ZALO_BOT_TOKEN trong mục Settings -> Secrets -> Actions của GitHub!");
    return;
  }

  // Nếu chưa có CHAT_ID, phần mềm tự động gọi lệnh POST getUpdates để lấy
  if (!CHAT_ID) {
    CHAT_ID = await autoFetchChatId();
    if (CHAT_ID) {
      data.chatId = CHAT_ID; // Lưu lại vào data.json để các ngày sau dùng luôn
    } else {
      console.error("⚠️ Chưa lấy được Chat ID. Bạn hãy bấm Run workflow rồi nhắn ngay chữ 'alo' cho Bot trên Zalo!");
      return;
    }
  }

  const today = getVNDate();
  const dayOfWeek = today.getDay();
  const todayStr = formatDateVN(today);

  // 1. Kiểm tra Thứ Bảy, Chủ Nhật
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    console.log(`Hôm nay là cuối tuần (${todayStr}), không phân công trực.`);
    return;
  }

  // 2. Kiểm tra ngày nghỉ lễ
  if (data.holidays && data.holidays.includes(todayStr)) {
    console.log(`Hôm nay là ngày lễ (${todayStr}), bảo lưu lượt trực sang ngày đi làm kế tiếp.`);
    return;
  }

  // 3. Tính người trực hôm nay và ngày kế tiếp
  const total = data.members.length;
  const currentIdx = data.currentIndex % total;
  const nextIdx = (currentIdx + 1) % total;

  const todayPerson = data.members[currentIdx];
  const nextPerson = data.members[nextIdx];

  // 4. Soạn nội dung tin nhắn
  let message = `🔔 [THÔNG BÁO TRỰC NHẬT - ${data.roomName.toUpperCase()}]\n`
              + `📅 Ngày: ${getDayNameVN(dayOfWeek)}, ${todayStr}\n`
              + `----------------------------------\n`
              + `👤 Cán bộ trực hôm nay: Đ/c ${todayPerson}\n`
              + `📋 Nội dung công việc:\n`;

  data.tasks.forEach((task, i) => {
    message += `   ${i + 1}. ${task}\n`;
  });

  message += `----------------------------------\n`
           + `⏭️ Trực ngày làm việc kế tiếp: Đ/c ${nextPerson}\n`
           + `🌐 Bảng theo dõi lịch trực: ${data.webAppUrl}\n`
           + `💡 Chúc cả phòng một ngày làm việc hiệu quả!`;

  // 5. Gửi tin nhắn qua Zalo Bot API bằng phương thức POST
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
    const resultText = await res.text();
    console.log("Kết quả gửi tin nhắn Zalo:", resultText);
  } catch (err) {
    console.error("Lỗi khi gửi tin nhắn Zalo:", err);
  }

  // 6. Cập nhật lượt trực mới và lưu vào data.json
  data.currentIndex = nextIdx;
  data.lastRunDate = todayStr;
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`✅ Đã chuyển chỉ số trực ngày mai sang: ${nextIdx} (${nextPerson})`);
}

run();
