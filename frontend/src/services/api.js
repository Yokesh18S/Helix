import axios from 'axios';

const API_BASE = '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 60000, // 60 seconds - Gemini AI calls can take time
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('helix_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('helix_token');
      localStorage.removeItem('helix_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Guest API — no auth token attached (for unauthenticated interview sessions)
const guestApi = axios.create({
  baseURL: API_BASE,
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
});

// Auth API
export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  getMe: () => api.get('/auth/me'),
  processVoiceNlp: (data) => api.post('/auth/voice-nlp', data),
  initiateOtp: (data) => guestApi.post('/auth/otp/initiate', data),
  verifyOtp: (data) => guestApi.post('/auth/otp/verify', data),
  // Claim a guest application after OTP sign-in
  claimGuestSession: (data) => api.post('/interview/claim', data),
};

// Applications API
export const applicationsAPI = {
  create: (data) => api.post('/applications', data),
  // Guest: no auth header — passes guest_token in body
  createGuest: (guestToken, projectName = null) =>
    guestApi.post('/applications', { guest_token: guestToken, project_name: projectName }),
  getAll: () => api.get('/applications'),
  getOne: (id) => api.get(`/applications/${id}`),
  update: (id, data) => api.put(`/applications/${id}`, data),
  submit: (id) => api.post(`/applications/${id}/submit`),
  delete: (id) => api.delete(`/applications/${id}`),
  upload: (id, formData) => api.post(`/applications/${id}/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  // PDF download — returns blob for browser save-as
  downloadPdf: (id, lang = null) => {
    const token = localStorage.getItem('helix_token');
    const guestToken = localStorage.getItem('helix_guest_token');
    const langParam = lang ? `&lang=${encodeURIComponent(lang)}` : '';
    const guestParam = guestToken ? `&guest_token=${encodeURIComponent(guestToken)}` : '';
    const url = `${API_BASE}/applications/${id}/pdf?${langParam}${guestParam}`;
    return fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then((res) => {
      if (!res.ok) throw new Error('PDF download failed');
      return res.blob();
    });
  },
  // Send PDF via email
  sendEmail: (id, data) => api.post(`/applications/${id}/send-email`, data || {}),
};

// Interview API (Adaptive Engine)
export const interviewAPI = {
  // Get the first dynamic question
  firstQuestion: (applicationId) => api.post(`/interview/first-question?application_id=${applicationId}`),
  firstQuestionGuest: (applicationId, guestToken) =>
    guestApi.post(`/interview/first-question?application_id=${applicationId}&guest_token=${guestToken}`),
  // Authenticated
  processVoice: (data) => api.post('/interview/process-voice', data),
  processText: (applicationId, data) => api.post(`/interview/process-text?application_id=${applicationId}`, data),
  // Guest
  processVoiceGuest: (data) => guestApi.post('/interview/process-voice', data),
  processTextGuest: (applicationId, guestToken, data) =>
    guestApi.post(`/interview/process-text?application_id=${applicationId}&guest_token=${guestToken}`, data),
  parseProfile: (data) => guestApi.post('/interview/parse-profile', data),
  getSessions: (appId) => api.get(`/interview/${appId}/sessions`),
  // Claim guest session after login/register
  claimGuestSession: (guestToken, applicationId = null) =>
    api.post('/interview/claim', { guest_token: guestToken, application_id: applicationId }),
};

// Requirements API
export const requirementsAPI = {
  generate: (data) => {
    const guestToken = localStorage.getItem('helix_guest_token');
    const payload = { ...data };
    if (guestToken && !payload.guest_token) {
      payload.guest_token = guestToken;
    }
    return api.post('/requirements/generate', payload);
  },
  generateGuest: (data) => {
    const guestToken = localStorage.getItem('helix_guest_token');
    const payload = { ...data };
    if (guestToken && !payload.guest_token) {
      payload.guest_token = guestToken;
    }
    return guestApi.post('/requirements/generate', payload);
  },
};

// Admin API
export const adminAPI = {
  getStats: () => api.get('/admin/stats'),
};

export default api;
