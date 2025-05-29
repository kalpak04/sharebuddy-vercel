import React, { useState, useEffect } from 'react';
import fileService from '../services/fileService';

const FileList = () => {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadFiles();
  }, []);

  const loadFiles = async () => {
    try {
      const fileList = await fileService.listFiles();
      setFiles(fileList);
      setError(null);
    } catch (err) {
      setError('Failed to load files');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (fileKey, fileName) => {
    try {
      const url = await fileService.getDownloadUrl(fileKey);
      
      // Create a temporary link to trigger download
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      setError('Failed to download file');
    }
  };

  const handleDelete = async (fileKey) => {
    if (!window.confirm('Are you sure you want to delete this file?')) {
      return;
    }

    try {
      await fileService.deleteFile(fileKey);
      setFiles(files.filter(file => file.key !== fileKey));
    } catch (err) {
      setError('Failed to delete file');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-100 text-red-700 rounded-lg">
        {error}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="text-center p-8 text-gray-500">
        No files uploaded yet
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Name
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Size
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Type
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Uploaded
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {files.map((file) => (
            <tr key={file.id}>
              <td className="px-6 py-4 whitespace-nowrap">
                {file.original_name}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                {fileService.formatFileSize(file.size)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                {file.content_type}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                {new Date(file.created_at).toLocaleDateString()}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                <button
                  onClick={() => handleDownload(file.key, file.original_name)}
                  className="text-blue-600 hover:text-blue-900 mr-4"
                >
                  Download
                </button>
                <button
                  onClick={() => handleDelete(file.key)}
                  className="text-red-600 hover:text-red-900"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default FileList; 