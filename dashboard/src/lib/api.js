const BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

export const auth = {
  get token() { return localStorage.getItem('jf_token'); },
  set token(v) { v ? localStorage.setItem('jf_token', v) : localStorage.removeItem('jf_token'); },
  get user() { try { return JSON.parse(localStorage.getItem('jf_user')); } catch { return null; } },
  set user(v) { v ? localStorage.setItem('jf_user', JSON.stringify(v)) : localStorage.removeItem('jf_user'); },
};

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function request(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: form || (body ? JSON.stringify(body) : undefined),
  });

  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    auth.token = null;
    auth.user = null;
    // A hard redirect clears every stale component state at once.
    if (!location.pathname.startsWith('/sign-in')) location.href = '/sign-in';
  }
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
  return data;
}

export const api = {
  register: (b) => request('/auth/register', { method: 'POST', body: b }),
  login: (b) => request('/auth/login', { method: 'POST', body: b }),
  me: () => request('/auth/me'),
  updateSettings: (b) => request('/auth/settings', { method: 'PATCH', body: b }),

  profile: () => request('/profile'),
  saveProfile: (b) => request('/profile', { method: 'PUT', body: b }),
  addTo: (list, b) => request(`/profile/${list}`, { method: 'POST', body: b }),
  removeFrom: (list, i) => request(`/profile/${list}/${i}`, { method: 'DELETE' }),

  resumes: () => request('/resumes'),
  uploadResume: (form) => request('/resumes', { method: 'POST', form }),
  patchResume: (id, b) => request(`/resumes/${id}`, { method: 'PATCH', body: b }),
  deleteResume: (id) => request(`/resumes/${id}`, { method: 'DELETE' }),

  answers: (q) => request(`/answers${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  patchAnswer: (id, b) => request(`/answers/${id}`, { method: 'PATCH', body: b }),
  deleteAnswer: (id) => request(`/answers/${id}`, { method: 'DELETE' }),

  applications: () => request('/applications'),
  stats: () => request('/applications/stats'),
  patchApplication: (id, b) => request(`/applications/${id}`, { method: 'PATCH', body: b }),

  coverLetter: (b) => request('/autofill/cover-letter', { method: 'POST', body: b }),
};
