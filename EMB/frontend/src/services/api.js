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

// Auth API
export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  getMe: () => api.get('/auth/me'),
};

// Applications API
export const applicationsAPI = {
  create: (data) => api.post('/applications', data),
  getAll: () => api.get('/applications'),
  getOne: (id) => api.get(`/applications/${id}`),
  update: (id, data) => api.put(`/applications/${id}`, data),
  submit: (id) => api.post(`/applications/${id}/submit`),
  delete: (id) => api.delete(`/applications/${id}`),
  upload: (id, formData) => api.post(`/applications/${id}/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
};

// Interview API
export const interviewAPI = {
  getQuestions: () => api.get('/interview/questions'),
  processVoice: (data) => api.post('/interview/process-voice', data),
  processText: (applicationId, data) => api.post(`/interview/process-text?application_id=${applicationId}`, data),
  getSessions: (appId) => api.get(`/interview/${appId}/sessions`),
};

// Requirements API
export const requirementsAPI = {
  generate: (data) => api.post('/requirements/generate', data),
};

// Admin API
export const adminAPI = {
  getStats: () => api.get('/admin/stats'),
};

export default api;

