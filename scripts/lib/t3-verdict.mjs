export function assertIdle(snapshot) {
  if (snapshot.stop || snapshot.pending) throw new Error('PRECONDITION_GENERATING: Stop or pending response present');
}

export function assertAnswer({ beforeCount, afterCount, userText, word, answer, pairedAnswer, phase }) {
  if (afterCount !== beforeCount + 1 || userText !== word) throw new Error('LAST_NEW_USER_TURN_MISMATCH');
  if (phase !== 'done') throw new Error(`TALK_NOT_DONE: ${phase}`);
  if (!pairedAnswer || !answer) throw new Error('EMPTY_PAIRED_ANSWER');
  if (/超出我的能力|無法協助|無法提供|cannot (?:help|assist)|unable to/i.test(answer + pairedAnswer)) throw new Error('REFUSAL_NOT_ANSWER');
  const heading = new RegExp(`^#{1,6}\\s+${word}\\b`, 'im');
  if (!heading.test(answer)) throw new Error('ANSWER_HEADING_MISMATCH');
  if (!pairedAnswer.toLowerCase().includes(word.toLowerCase())) throw new Error('PAIRED_ANSWER_MISMATCH');
}
