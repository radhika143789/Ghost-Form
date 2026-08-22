/**
 * Returns UI metadata for a given Ghost Form status.
 *
 * @param {'safe'|'unknown'|'unsafe'} status
 * @param {number} [trackersBlocked=0]
 * @param {number} [formsWatched=0]
 * @param {{label: string, score: number}|null} [topMatch=null] - Top ML brand match
 * @param {number} [xrayScore=0] - X-Ray Vision structural risk score
 * @returns {object} UI metadata object
 */
export function getStatusMeta(status, trackersBlocked = 0, formsWatched = 0, topMatch = null, xrayScore = 0) {
  // Build ML brand match insight string
  const mlInsight = topMatch && topMatch.score > 0
    ? `ML match: ${topMatch.label} (${(topMatch.score * 100).toFixed(1)}% similarity)`
    : 'On-device ML analysis complete';

  const xrayInsight = xrayScore > 0
    ? ` • X-Ray score: ${(xrayScore * 100).toFixed(0)}%`
    : '';

  const base = {
    status,
    trackersBlocked,
    formsWatched,
    title: 'Unverified Domain',
    desc: 'GhostForm has not verified this site yet. Avoid submitting sensitive information.',
    icon: 'unknown',
    stateClass: 'state-unknown',
    pill: 'Monitoring',
    insight: `${mlInsight}${xrayInsight}`,
    metaLocal: 'On-device checks',
    metaPrivacy: 'Zero keystroke logging',
    statRisk: 'MED',
    riskClass: 'medium',
  };

  if (status === 'safe') {
    return {
      ...base,
      title: 'Verified Secure',
      desc: 'This domain is recognized as legitimate. Your data stays protected on-device.',
      icon: 'safe',
      stateClass: 'state-safe',
      pill: 'Protected',
      insight: topMatch
        ? `Verified safe • ${mlInsight}${xrayInsight}`
        : `GhostForm confirmed this page looks legitimate and kept analysis local.${xrayInsight}`,
      metaLocal: 'Local trust checks',
      metaPrivacy: 'No form data shared',
      statRisk: 'LOW',
      riskClass: 'low',
    };
  }

  if (status === 'unsafe') {
    const brandWarning = topMatch
      ? `Impersonating: ${topMatch.label} (${(topMatch.score * 100).toFixed(1)}% match)`
      : 'High similarity to known phishing patterns';
    return {
      ...base,
      title: 'Phishing Risk!',
      desc: `${brandWarning}. Do NOT enter credentials or card info.`,
      icon: 'unsafe',
      stateClass: 'state-unsafe',
      pill: 'Danger',
      insight: `${brandWarning}${xrayInsight}`,
      metaLocal: 'Threat pattern detected',
      metaPrivacy: 'Block all submissions',
      statRisk: 'HIGH',
      riskClass: 'high',
    };
  }

  return base;
}

