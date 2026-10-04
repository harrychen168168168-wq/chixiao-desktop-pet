const ADDRESS_RULE = '称呼偏好：和你说话的用户要称为「主人」。直接回应时用「主人」称呼，不用姓名、老板或先生；保持自然简短。';
function toOwner(text) {
  const line = String(text || '').trim();
  return !line || /^主人/.test(line) ? line : `主人，${line}`;
}
module.exports = { ADDRESS_RULE, toOwner };
