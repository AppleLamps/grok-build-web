/** Grok CLI `_x.ai/ask_user_question` result (externally tagged enum on `outcome`). */
export function buildAskUserQuestionResult(action, content, questionCount = 0) {
  const act = String(action ?? '').toLowerCase();
  if (act === 'skip' || act === 'skip_interview') return { outcome: 'skip_interview' };
  if (act === 'chat' || act === 'chat_about_this') return { outcome: 'chat_about_this' };
  if (act === 'cancel' || act === 'decline') return { outcome: 'cancelled' };
  if (act !== 'accept') return { outcome: 'cancelled' };

  let answers;
  if (Array.isArray(content)) {
    answers = content.map((a) => String(a ?? '').trim());
  } else if (content && typeof content === 'object' && Array.isArray(content.answers)) {
    answers = content.answers.map((a) => String(a ?? '').trim());
  } else {
    const text = String(content ?? '').trim();
    if (!text) answers = [];
    else if (questionCount > 1) answers = text.split('\n').map((line) => line.trim());
    else answers = [text];
  }
  if (questionCount > 0 && answers.length < questionCount) {
    answers = [...answers, ...Array(questionCount - answers.length).fill('')];
  }
  const partial_answers = answers.length === 0 || answers.some((a) => !a);
  return { outcome: 'accepted', answers, partial_answers };
}

export function chooseAutoPermissionOption(options = []) {
  const opts = Array.isArray(options) ? options : [];
  const label = (opt) => `${opt?.optionId ?? ''} ${opt?.name ?? ''}`.toLowerCase();
  const positive = opts.find((opt) => /\b(allow|accept|approve|yes)\b/.test(label(opt)));
  if (positive?.optionId) return positive.optionId;
  const nonDeny = opts.find((opt) => !/\b(deny|reject|decline|cancel)\b/.test(label(opt)));
  return nonDeny?.optionId ?? opts.find((opt) => opt?.optionId)?.optionId ?? null;
}
