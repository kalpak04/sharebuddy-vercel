import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

class FileService {
  constructor() {
    this.api = axios.create({
      baseURL: `${API_URL}/api/files`
    });
  }

  setAuthToken(token) {
    this.api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

  async uploadFile(file, onProgress) {
    const formData = new FormData();
    formData.append('file', file);

    const response = await this.api.post('/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      onUploadProgress: (progressEvent) => {
        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        onProgress?.(percentCompleted);
      }
    });

    return response.data;
  }

  async getDownloadUrl(fileKey) {
    const response = await this.api.get(`/download/${fileKey}`);
    return response.data.downloadUrl;
  }

  async deleteFile(fileKey) {
    const response = await this.api.delete(`/${fileKey}`);
    return response.data;
  }

  async listFiles() {
    const response = await this.api.get('/list');
    return response.data;
  }

  // Helper method to format file size
  static formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

export default new FileService(); 