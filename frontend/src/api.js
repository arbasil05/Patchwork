const API_BASE_URL = 'http://localhost:8000';

const cache = new Map();

export async function fetchFrameworkChallenges(framework) {
  if (cache.has(framework)) {
    return cache.get(framework);
  }

  const response = await fetch(`${API_BASE_URL}/ticket/challenge/${framework}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch problems for ${framework}`);
  }

  const data = await response.json();
  cache.set(framework, data.challenges || []);
  return data.challenges || [];
}

export async function fetchChallengeDetails(framework, challengeId) {
  const response = await fetch(`${API_BASE_URL}/ticket/challenge/${framework}/${challengeId}`);
  if (!response.ok) {
    throw new Error('Challenge not found');
  }
  return await response.json();
}
