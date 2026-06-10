const HEX_BYTE_PATTERN = /^[0-9a-fA-F]{2}$/;

function asCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

function expectedCountOf(motionWindow) {
  const valid = asCount(motionWindow?.valid);
  if (valid !== null) return valid;
  return asCount(motionWindow?.count);
}

export function decodeMotionWindowScores(motionWindow) {
  const scoresHex = typeof motionWindow?.scores_hex === 'string'
    ? motionWindow.scores_hex.trim()
    : '';

  const expectedCount = expectedCountOf(motionWindow);
  const result = {
    decodedScores: [],
    sampleQuality: 'missing_scores',
    countMismatch: expectedCount !== null && expectedCount !== 0,
  };

  if (!scoresHex) {
    return result;
  }

  if (scoresHex.length % 2 !== 0) {
    return {
      ...result,
      sampleQuality: 'odd_hex_length',
    };
  }

  const decodedScores = [];
  for (let i = 0; i < scoresHex.length; i += 2) {
    const pair = scoresHex.slice(i, i + 2);
    if (!HEX_BYTE_PATTERN.test(pair)) {
      return {
        ...result,
        sampleQuality: 'invalid_hex',
      };
    }
    decodedScores.push(Number.parseInt(pair, 16));
  }

  const countMismatch = expectedCount !== null && decodedScores.length !== expectedCount;

  return {
    decodedScores,
    sampleQuality: countMismatch ? 'count_mismatch' : 'ok',
    countMismatch,
  };
}

export default decodeMotionWindowScores;
