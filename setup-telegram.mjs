import { createHash } from "node:crypto";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token || !process.argv[2]) throw new Error("Set TELEGRAM_BOT_TOKEN and supply the Worker HTTPS URL.");
const worker = new URL(process.argv[2]);
if (worker.protocol !== "https:" || worker.username || worker.password) {
  throw new Error("Supply a public HTTPS Worker URL without credentials.");
}
const secret = createHash("sha256").update("event-radar:webhook:v1:" + token).digest("hex");
async function telegram(method, payload) {
  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify(payload),
  }).catch(() => { throw new Error("Telegram connection failed"); });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(method + " failed with HTTP " + response.status);
  return result.result;
}
const commands = [
  ["scan", "Свежий дайджест"], ["kaist", "События KAIST"],
  ["korea", "Южная Корея"], ["kz", "Казахстан"], ["online", "Онлайн"],
  ["hackathons", "Хакатоны"], ["startups", "Стартап-возможности"],
  ["deadlines", "Дедлайны подачи"], ["help", "Показать кнопки"],
];
await telegram("setWebhook", {url: new URL("/telegram", worker).href, secret_token: secret, allowed_updates: ["message", "callback_query"]});
await telegram("setMyCommands", {
  scope: {type: "all_private_chats"},
  commands: commands.map(([command, description]) => ({command, description})),
});
console.log("Telegram webhook and command menu configured.");
