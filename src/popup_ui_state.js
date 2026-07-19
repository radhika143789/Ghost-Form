export function getStatusMeta(status, trackersBlocked = 0, formsWatched = 0) {
  const base = {
    status,
    trackersBlocked,
    formsWatched,
    title: 'Unverified Domain',
    desc: 'GhostForm has not verified this site yet. Avoid submitting sensitive information.',
    icon: 'unknown',
    stateClass: 'state-unknown',
    pill: 'Monitoring',
    insight: 'This site is being checked locally with on-device analysis.',
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
      insight: 'GhostForm confirmed this page looks legitimate and kept analysis local.',
      metaLocal: 'Local trust checks',
      metaPrivacy: 'No form data shared',
      statRisk: 'LOW',
      riskClass: 'low',
    };
  }

  if (status === 'unsafe') {
    return {
      ...base,
      title: 'Phishing Risk!',
      desc: 'High similarity to known phishing patterns. Do NOT enter credentials or card info.',
      icon: 'unsafe',
      stateClass: 'state-unsafe',
      pill: 'Attention',
      insight: 'Suspicious behavior was detected, so this site should be treated as high risk.',
      metaLocal: 'Threat pattern scan',
      metaPrivacy: 'Sensitive fields stay local',
      statRisk: 'HIGH',
      riskClass: 'high',
    };
  }

  return base;
}
